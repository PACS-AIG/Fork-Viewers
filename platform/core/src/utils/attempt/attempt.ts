/**
 * Viewer attempt trace — the browser half.
 *
 * Wires AttemptTrace to the document: attempt id and click time from the
 * launcher's URL parameters, state in sessionStorage (survives the OIDC
 * redirect), a per-device workstation id in localStorage, the build version
 * from the bundle, WebGL context-loss listeners, and a read-only
 * `window.__pacsaiAttempt` for the harness. Every method is safe to call
 * before init() and outside a browser: it then does nothing.
 *
 * Sink: none yet. Events stay in the page (and in performance.mark). The
 * plan's sink is dapi's study_events (milestone 4); until then the harness
 * reads window.__pacsaiAttempt.getTrace().
 */
import {
  AttemptTrace,
  AttemptEvent,
  AttemptStage,
  AttemptTraceState,
  CacheState,
  studyRefFor,
} from './attemptTrace';

const KEY_CURRENT = 'pacsai.attempt.current';
const KEY_PREFIX = 'pacsai.attempt.';
const KEY_WORKSTATION = 'pacsai.workstationId';
const KEY_DEBUG = 'pacsai.attempt.debug';

type ContainerExtra = Pick<AttemptEvent, 'containerSize'>;

export interface AttemptRecorder {
  /** Resolve the attempt for this document and record `launch`. Idempotent. */
  init(): void;
  /** Tell the trace which study this document is opening (a switch = new generation). */
  begin(studyInstanceUid?: string | null): number;
  mark(stage: AttemptStage, extra?: ContainerExtra): AttemptEvent | null;
  fail(code: string, stage?: AttemptStage, extra?: ContainerExtra & { stackRef?: string }): AttemptEvent | null;
  has(stage: AttemptStage): boolean;
  /** True when the uid hashes to the study this attempt asked for. */
  matchesRequested(studyInstanceUid: string | null | undefined): boolean;
  /** Record container_sized (now, or when the element first gets a size) and watch its WebGL context. */
  observeContainer(element: Element | null | undefined): void;
  /** Watch the rendering engine's offscreen canvas for context loss. */
  observeEngine(engine: unknown): void;
  /** Record `cancelled` unless the matching image already rendered. */
  cancelIfIncomplete(code: string): void;
  snapshot(): (AttemptTraceState & { readiness: unknown; complete: boolean }) | null;
  subscribe(listener: (e: AttemptEvent) => void): () => void;
}

const hasWindow = () => typeof window !== 'undefined' && typeof document !== 'undefined';

function randomId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) {
      return c.randomUUID();
    }
  } catch (_) {
    /* fall through */
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch (_) {
    return null;
  }
}

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

function workstationId(): string {
  const store = local();
  try {
    const existing = store?.getItem(KEY_WORKSTATION);
    if (existing) {
      return existing;
    }
    const id = `ws-${randomId()}`;
    store?.setItem(KEY_WORKSTATION, id);
    return id;
  } catch (_) {
    return 'ws-unknown';
  }
}

function buildVersion(): string {
  let version = '';
  let commit = '';
  try {
    // Replaced by webpack's DefinePlugin at build time (see .webpack/webpack.base.js).
    version = (process.env.VERSION_NUMBER || '').trim();
    commit = (process.env.COMMIT_HASH || '').trim().slice(0, 9);
  } catch (_) {
    /* not a webpack build (tests) */
  }
  return [version || 'unknown', commit].filter(Boolean).join('+');
}

function readParams(): {
  attempt: string | null;
  t0: number | null;
  cache: CacheState;
  studyUid: string | null;
} {
  const params = new URLSearchParams(window.location.search);
  const t0Raw = params.get('attemptT0');
  const t0 = t0Raw && /^\d+$/.test(t0Raw) ? Number(t0Raw) : null;
  const cacheRaw = params.get('attemptCache');
  const cache: CacheState = cacheRaw === 'cold' || cacheRaw === 'warm' ? cacheRaw : 'unknown';
  const studyUid = params.get('StudyInstanceUIDs')?.split(',')[0]?.trim() || null;
  return { attempt: params.get('attempt'), t0, cache, studyUid };
}

function debugEnabled(): boolean {
  try {
    return local()?.getItem(KEY_DEBUG) === '1';
  } catch (_) {
    return false;
  }
}

class BrowserAttemptRecorder implements AttemptRecorder {
  private trace: AttemptTrace | null = null;
  private observedElements = new WeakSet<Element>();
  private observedEngines = new WeakSet<object>();
  private resizeObservers = new Map<Element, ResizeObserver>();

  init(): void {
    if (this.trace || !hasWindow()) {
      return;
    }
    const store = session();
    const { attempt: fromUrl, t0: t0FromUrl, cache, studyUid } = readParams();
    let attemptId: string;
    if (fromUrl) {
      attemptId = fromUrl;
    } else if (studyUid) {
      // A viewer URL that names a study but carries no attempt id is a new
      // deliberate open (typed or bookmarked), never a resume.
      attemptId = `att-${randomId()}`;
    } else {
      // No study and no id: the OIDC callback document, or the study list.
      attemptId = store?.getItem(KEY_CURRENT) || `att-${randomId()}`;
    }
    try {
      store?.setItem(KEY_CURRENT, attemptId);
    } catch (_) {
      /* ignore */
    }
    const key = `${KEY_PREFIX}${attemptId}`;
    const deps = {
      now: () => Date.now(),
      buildVersion: buildVersion(),
      workstationId: workstationId(),
      load: (): AttemptTraceState | null => {
        const raw = store?.getItem(key);
        return raw ? (JSON.parse(raw) as AttemptTraceState) : null;
      },
      save: (state: AttemptTraceState) => {
        store?.setItem(key, JSON.stringify(state));
      },
    };
    const documentStart =
      typeof performance !== 'undefined' && performance.timeOrigin
        ? Math.round(performance.timeOrigin)
        : Date.now();
    this.trace = new AttemptTrace(deps, {
      attemptId,
      t0: t0FromUrl ?? documentStart,
      studyRef: studyRefFor(studyUid),
      cacheState: cache,
    });
    this.pruneOtherAttempts(store, key);
    this.trace.subscribe(e => this.onEvent(e));
    if (!this.trace.has('launch', 1)) {
      this.trace.mark('launch');
    }
    this.installWindowApi();
  }

  begin(studyInstanceUid?: string | null): number {
    this.init();
    return this.trace ? this.trace.begin(studyRefFor(studyInstanceUid)) : 0;
  }

  mark(stage: AttemptStage, extra: ContainerExtra = {}): AttemptEvent | null {
    this.init();
    return this.trace ? this.trace.mark(stage, extra) : null;
  }

  fail(
    code: string,
    stage: AttemptStage = 'failed',
    extra: ContainerExtra & { stackRef?: string } = {}
  ): AttemptEvent | null {
    this.init();
    return this.trace ? this.trace.fail(code, stage, extra) : null;
  }

  has(stage: AttemptStage): boolean {
    return !!this.trace && this.trace.has(stage);
  }

  matchesRequested(studyInstanceUid: string | null | undefined): boolean {
    if (!this.trace || !studyInstanceUid) {
      return false;
    }
    const ref = this.trace.studyRef;
    return ref !== 'none' && studyRefFor(studyInstanceUid) === ref;
  }

  observeContainer(element: Element | null | undefined): void {
    this.init();
    if (!this.trace || !element || !(element instanceof Element)) {
      return;
    }
    if (!this.observedElements.has(element)) {
      this.observedElements.add(element);
      // Capture phase: webglcontextlost is dispatched on the canvas and does
      // not bubble, but capture listeners on an ancestor still see it.
      element.addEventListener(
        'webglcontextlost',
        () => this.fail('WEBGL_CONTEXT_LOST'),
        true
      );
    }
    const size: [number, number] = [element.clientWidth | 0, element.clientHeight | 0];
    if (size[0] > 0 && size[1] > 0) {
      this.mark('container_sized', { containerSize: size });
      return;
    }
    if (typeof ResizeObserver === 'undefined' || this.resizeObservers.has(element)) {
      return;
    }
    const ro = new ResizeObserver(() => {
      const now: [number, number] = [element.clientWidth | 0, element.clientHeight | 0];
      if (now[0] > 0 && now[1] > 0) {
        this.mark('container_sized', { containerSize: now });
        ro.disconnect();
        this.resizeObservers.delete(element);
      }
    });
    this.resizeObservers.set(element, ro);
    ro.observe(element);
  }

  observeEngine(engine: unknown): void {
    this.init();
    if (!this.trace || !engine || typeof engine !== 'object' || this.observedEngines.has(engine)) {
      return;
    }
    this.observedEngines.add(engine);
    try {
      const e = engine as {
        offscreenMultiRenderWindow?: {
          getOpenGLRenderWindow?: () => { getCanvas?: () => HTMLCanvasElement | null } | null;
        };
      };
      const canvas = e.offscreenMultiRenderWindow?.getOpenGLRenderWindow?.()?.getCanvas?.();
      canvas?.addEventListener?.('webglcontextlost', () =>
        this.fail('WEBGL_CONTEXT_LOST_OFFSCREEN')
      );
    } catch (_) {
      /* the engine's internals are not ours; observing them is best effort */
    }
  }

  cancelIfIncomplete(code: string): void {
    if (!this.trace || this.trace.has('image_rendered_matching_study')) {
      return;
    }
    this.trace.fail(code, 'cancelled');
  }

  snapshot() {
    return this.trace ? this.trace.snapshot() : null;
  }

  subscribe(listener: (e: AttemptEvent) => void): () => void {
    this.init();
    return this.trace ? this.trace.subscribe(listener) : () => undefined;
  }

  private onEvent(e: AttemptEvent): void {
    try {
      performance?.mark?.(`pacsai.attempt.${e.stage}`);
    } catch (_) {
      /* ignore */
    }
    if (debugEnabled()) {
      // eslint-disable-next-line no-console
      console.debug('[pacsai.attempt]', e.stage, e.ok ? 'ok' : e.error?.code, `${e.tMs}ms`, e);
    }
  }

  private installWindowApi(): void {
    const api = {
      version: 1,
      getTrace: () => this.snapshot(),
      getEvents: () => (this.trace ? this.trace.events().slice() : []),
      subscribe: (listener: (e: AttemptEvent) => void) => this.subscribe(listener),
    };
    (window as unknown as { __pacsaiAttempt?: typeof api }).__pacsaiAttempt = api;
  }

  private pruneOtherAttempts(store: Storage | null, keep: string): void {
    if (!store) {
      return;
    }
    try {
      const stale: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(KEY_PREFIX) && k !== keep && k !== KEY_CURRENT) {
          stale.push(k);
        }
      }
      stale.forEach(k => store.removeItem(k));
    } catch (_) {
      /* ignore */
    }
  }
}

export const attempt: AttemptRecorder = new BrowserAttemptRecorder();
