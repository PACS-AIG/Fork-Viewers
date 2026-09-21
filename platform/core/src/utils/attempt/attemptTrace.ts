/**
 * Viewer attempt trace — the pure half (no DOM, no globals).
 *
 * One "attempt" is one deliberate study open, from the launcher's click to a
 * matching image on screen. It survives the OIDC redirect (the document loads
 * twice on a cold sign-in), so the state lives in whatever storage the caller
 * hands in, keyed by attemptId. A "generation" counts study switches inside
 * one document (A→B while A is still loading), so a stale callback from A
 * cannot be read as B's success.
 *
 * Events are shaped exactly like the build package's
 * viewer_attempt_event.schema.json (R13 addendum, B01): additionalProperties
 * is false there, so nothing else goes on an event. No PHI: studyRef is a hash
 * of the StudyInstanceUID, never the UID; error.code is a code, never text.
 */

export const ATTEMPT_STAGES = [
  'launch',
  'auth_ready',
  'config_ready',
  'runtime_ready',
  'engine_created',
  'container_sized',
  'metadata_loaded',
  'first_pixels',
  'image_rendered_matching_study',
  'tools_ready',
  'retry_requested',
  'cancelled',
  'failed',
] as const;

export type AttemptStage = (typeof ATTEMPT_STAGES)[number];

/** Stages that must all be ok before image_rendered_matching_study may count. */
export const READINESS_STAGES: readonly AttemptStage[] = ATTEMPT_STAGES.slice(0, 8);

/** Stages that may legitimately be recorded more than once per document. */
const REPEATABLE: ReadonlySet<AttemptStage> = new Set<AttemptStage>(['failed', 'retry_requested']);

export type CacheState = 'cold' | 'warm' | 'unknown';

export interface AttemptError {
  code: string;
  stackRef?: string;
}

export interface AttemptEvent {
  attemptId: string;
  generation: number;
  stage: AttemptStage;
  tMs: number;
  ok: boolean;
  error?: AttemptError;
  buildVersion: string;
  workstationId: string;
  studyRef: string;
  cacheState?: CacheState;
  containerSize?: [number, number];
}

export interface AttemptTraceState {
  attemptId: string;
  /** Epoch ms of the launcher's click (or of the first document if unknown). */
  t0: number;
  generation: number;
  studyRef: string;
  cacheState: CacheState;
  /** How many documents have loaded for this attempt (cold sign-in = 2). */
  documentLoads: number;
  events: AttemptEvent[];
}

export interface AttemptTraceDeps {
  now: () => number;
  buildVersion: string;
  workstationId: string;
  load: () => AttemptTraceState | null;
  save: (state: AttemptTraceState) => void;
}

export interface AttemptTraceInit {
  attemptId: string;
  t0: number;
  studyRef: string;
  cacheState: CacheState;
}

export const ERROR_CODE = /^[A-Z0-9_]{3,40}$/;

/** UTF-8 bytes without TextEncoder (jsdom lacks it; the browser and node agree). */
function utf8Bytes(input: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let cp = input.codePointAt(i) as number;
    if (cp > 0xffff) {
      i++; // surrogate pair consumed
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return out;
}

/** FNV-1a 64-bit as 16 hex chars. Deterministic, reproducible by the harness. */
export function fnv1a64Hex(input: string): string {
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  const mask = BigInt('0xffffffffffffffff');
  const bytes = utf8Bytes(input);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Opaque study reference: a hash of the UID, or 'none' when nothing was asked for. */
export function studyRefFor(studyInstanceUid: string | null | undefined): string {
  const uid = (studyInstanceUid ?? '').trim();
  return uid ? `fnv1a64:${fnv1a64Hex(uid)}` : 'none';
}

export interface ReadinessVerdict {
  ok: boolean;
  /** Readiness stages with no ok=true event in this generation. */
  missing: AttemptStage[];
  /** Readiness stages whose latest event in this generation is ok=false. */
  failed: AttemptStage[];
  rendered: boolean;
}

/**
 * The schema's rule: image_rendered_matching_study may only follow every
 * earlier stage with ok=true for the same attemptId and generation. Stages
 * need not be serialized (V01), so this checks presence and polarity, not
 * order. The latest event per stage wins, which lets a document that redid a
 * stage (config on the second load) supersede the first.
 */
export function validateReadiness(
  events: readonly AttemptEvent[],
  attemptId: string,
  generation: number
): ReadinessVerdict {
  const latest = new Map<AttemptStage, AttemptEvent>();
  for (const e of events) {
    if (e.attemptId !== attemptId || e.generation !== generation) {
      continue;
    }
    latest.set(e.stage, e);
  }
  const missing: AttemptStage[] = [];
  const failed: AttemptStage[] = [];
  for (const stage of READINESS_STAGES) {
    const e = latest.get(stage);
    if (!e) {
      missing.push(stage);
    } else if (!e.ok) {
      failed.push(stage);
    }
  }
  const renderedEvent = latest.get('image_rendered_matching_study');
  const rendered = !!renderedEvent && renderedEvent.ok;
  return { ok: rendered && missing.length === 0 && failed.length === 0, missing, failed, rendered };
}

export class AttemptTrace {
  private readonly deps: AttemptTraceDeps;
  private state: AttemptTraceState;
  private readonly listeners = new Set<(e: AttemptEvent) => void>();

  constructor(deps: AttemptTraceDeps, init: AttemptTraceInit) {
    this.deps = deps;
    const stored = safeLoad(deps);
    if (stored && stored.attemptId === init.attemptId) {
      this.state = {
        ...stored,
        // A caller that knows the study wins over a stored 'none' (the
        // callback document has no query string).
        studyRef: init.studyRef !== 'none' ? init.studyRef : stored.studyRef,
        cacheState: stored.cacheState === 'unknown' ? init.cacheState : stored.cacheState,
        documentLoads: stored.documentLoads + 1,
        events: Array.isArray(stored.events) ? stored.events.slice() : [],
      };
    } else {
      this.state = {
        attemptId: init.attemptId,
        t0: init.t0,
        generation: 1,
        studyRef: init.studyRef,
        cacheState: init.cacheState,
        documentLoads: 1,
        events: [],
      };
    }
    this.persist();
  }

  get attemptId(): string {
    return this.state.attemptId;
  }

  get generation(): number {
    return this.state.generation;
  }

  get studyRef(): string {
    return this.state.studyRef;
  }

  get documentLoads(): number {
    return this.state.documentLoads;
  }

  /**
   * A new study inside the same document starts a new generation. Same study:
   * no-op, so a re-entered mode does not inflate the count.
   */
  begin(studyRef: string): number {
    if (studyRef === 'none' || studyRef === this.state.studyRef) {
      return this.state.generation;
    }
    if (this.state.studyRef === 'none') {
      // The first document did not know the study (callback URL); fill it in.
      this.state.studyRef = studyRef;
    } else {
      // A different study in the same document: a new generation, so a stale
      // callback from the previous study cannot count as this one's success.
      this.state.generation += 1;
      this.state.studyRef = studyRef;
    }
    this.persist();
    return this.state.generation;
  }

  has(stage: AttemptStage, generation: number = this.state.generation): boolean {
    return this.state.events.some(
      e => e.stage === stage && e.generation === generation && e.ok
    );
  }

  /** Record an ok=true stage. Once per stage, generation and document load. */
  mark(stage: AttemptStage, extra: Pick<AttemptEvent, 'containerSize'> = {}): AttemptEvent | null {
    if (!REPEATABLE.has(stage) && this.recordedInThisDocument(stage)) {
      return null;
    }
    return this.record({ stage, ok: true, ...extra });
  }

  /** Record an ok=false stage with a schema-shaped error code. */
  fail(
    code: string,
    stage: AttemptStage = 'failed',
    extra: Pick<AttemptEvent, 'containerSize'> & { stackRef?: string } = {}
  ): AttemptEvent | null {
    const safeCode = ERROR_CODE.test(code) ? code : 'UNSPECIFIED_ERROR';
    if (!REPEATABLE.has(stage) && this.recordedInThisDocument(stage, false)) {
      return null;
    }
    const { stackRef, ...rest } = extra;
    const error: AttemptError = stackRef ? { code: safeCode, stackRef } : { code: safeCode };
    return this.record({ stage, ok: false, error, ...rest });
  }

  /**
   * The reader pressed Retry: record it and open a new dedupe window, so the
   * stages the retry re-runs (engine, container, first pixels, render, tools)
   * can be recorded again in the same generation. The readiness rule takes
   * the latest event per stage, so a retried stage supersedes the red one.
   */
  retry(): AttemptEvent {
    const event = this.record({ stage: 'retry_requested', ok: true });
    this.eventsAtConstruct = this.state.events.length;
    return event;
  }

  events(): readonly AttemptEvent[] {
    return this.state.events;
  }

  snapshot(): AttemptTraceState & { readiness: ReadinessVerdict; complete: boolean } {
    const readiness = validateReadiness(this.state.events, this.state.attemptId, this.state.generation);
    return {
      ...this.state,
      events: this.state.events.slice(),
      readiness,
      complete: readiness.ok,
    };
  }

  subscribe(listener: (e: AttemptEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private recordedInThisDocument(stage: AttemptStage, ok = true): boolean {
    // Events carry no document index (the schema forbids extra fields), so
    // the per-document window is the events appended since this construct.
    return this.state.events
      .slice(this.eventsAtConstruct)
      .some(e => e.stage === stage && e.generation === this.state.generation && e.ok === ok);
  }

  private eventsAtConstruct = 0;

  private record(
    partial: Pick<AttemptEvent, 'stage' | 'ok'> & Partial<Pick<AttemptEvent, 'error' | 'containerSize'>>
  ): AttemptEvent {
    if (this.eventsAtConstruct === 0 && this.state.events.length > 0 && this.state.documentLoads > 1) {
      // First record in a resumed document: everything stored so far belongs
      // to earlier documents.
      this.eventsAtConstruct = this.state.events.length;
    }
    const tMs = Math.max(0, Math.round(this.deps.now() - this.state.t0));
    const event: AttemptEvent = {
      attemptId: this.state.attemptId,
      generation: this.state.generation,
      stage: partial.stage,
      tMs,
      ok: partial.ok,
      buildVersion: this.deps.buildVersion,
      workstationId: this.deps.workstationId,
      studyRef: this.state.studyRef,
      cacheState: this.state.cacheState,
    };
    if (partial.error) {
      event.error = partial.error;
    }
    if (partial.containerSize) {
      event.containerSize = partial.containerSize;
    }
    this.state.events.push(event);
    this.persist();
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (_) {
        /* a listener must never break the viewer */
      }
    }
    return event;
  }

  private persist(): void {
    try {
      this.deps.save(this.state);
    } catch (_) {
      /* storage may be unavailable; the in-memory trace still works */
    }
  }
}

function safeLoad(deps: AttemptTraceDeps): AttemptTraceState | null {
  try {
    return deps.load();
  } catch (_) {
    return null;
  }
}
