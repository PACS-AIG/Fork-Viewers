/**
 * pacsai.embed/1 — the viewer's half of the cross-frame session (Rev 11
 * milestone 6 part 2), as a pure state machine. The contract is the app repo's
 * docs/rev11/m6-embed-protocol.md, §2 "The viewer".
 *
 * Everything the browser provides is injected — the parent window and its
 * origin, the allow-list, the attempt trace, the in-document study switch and
 * the clock — so every rule is tested without a frame; browser.ts is the thin
 * adapter over the real ones.
 *
 * The session in one paragraph: the viewer says hello (to an exact origin,
 * never '*') until the shell answers with its nonce and case generation; the
 * shell then names the case's study, which is either the one the attempt trace
 * is already opening (the case generation is bound to that attempt
 * generation), or another study on one of this document's gateways (the viewer
 * switches in the document, and binds once the trace has begun it), or not
 * openable here (STUDY_GATEWAY_MISMATCH). `viewer.ready` and `viewer.error`
 * come only from the trace's events of the BOUND attempt generation in THIS
 * document, so a late callback from a study the shell has moved away from, or
 * an earlier document's render (the trace resumes across a reload), can never
 * be reported as the new case's result.
 */
import {
  buildEmbedMessage,
  parseEmbedMessage,
  isEmbedAttemptId,
  isEmbedErrorCode,
  isEmbedId,
  isEmbedStage,
  EMBED_FOREIGN_REASONS,
  type EmbedParseReason,
  type EmbedStage,
  type EmbedVisibility,
  type ShellHelloMessage,
  type ShellStudyMessage,
  type ShellVisibilityMessage,
  type ToShellMessage,
} from './embedProtocol';

/** Delays between hello posts; the last one repeats. */
export const EMBED_HELLO_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];
export const EMBED_HELLO_MAX_POSTS = 12;

const RENDER_STAGE: EmbedStage = 'image_rendered_matching_study';
/** A mode exit before the render (MODE_EXIT_BEFORE_RENDER): not a failure of the case. */
const CANCELLED_STAGE: EmbedStage = 'cancelled';
/** The trace's own fallback for a code that breaks its rule. */
const FALLBACK_CODE = 'UNSPECIFIED_ERROR';

export type EmbedVisibilityState = EmbedVisibility;

export type EmbedInactiveReason =
  | 'not-framed'
  | 'no-allowed-origins'
  | 'bad-document-id'
  | 'install-failed';

export type EmbedDropReason =
  | Exclude<EmbedParseReason, 'not-object' | 'wrong-protocol'>
  | 'bad-source'
  | 'bad-origin'
  | 'not-bound'
  | 'unknown-document'
  | 'nonce-mismatch'
  | 'stale-generation'
  | 'generation-reuse';

/** One attempt trace event, as much of it as the bridge reads. */
export interface EmbedAttemptEvent {
  attemptId: string;
  generation: number;
  stage: string;
  ok: boolean;
  error?: { code: string };
}

export interface EmbedAttemptSnapshot {
  attemptId: string;
  generation: number;
  studyRef: string;
  events: readonly EmbedAttemptEvent[];
}

/** A read-only view of the attempt recorder (platform/core utils/attempt). */
export interface EmbedAttemptView {
  subscribe(listener: (event: EmbedAttemptEvent) => void): () => void;
  snapshot(): EmbedAttemptSnapshot | null;
}

export interface EmbedScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What the bridge reads off a MessageEvent. */
export interface EmbedInboundEvent {
  source: unknown;
  origin: string;
  data: unknown;
}

export interface EmbedBridgeDeps {
  /** Exact origins, already normalized (normalizeEmbedOrigins). */
  allowedOrigins: readonly string[];
  framed: boolean;
  /** window.parent.postMessage(message, targetOrigin); the origin is always exact. */
  post(message: ToShellMessage, targetOrigin: string): void;
  /** source === window.parent */
  isParent(source: unknown): boolean;
  /** Where the hello goes before binding (the adapter's ancestorOrigins → referrer → all allowed). */
  candidateParentOrigins(): readonly string[];
  documentId: string;
  attempt: EmbedAttemptView;
  /** The trace's own studyRefFor (FNV-1a of the UID). */
  studyRefFor(studyInstanceUid: string): string;
  /** The gatewayAET values on this document's URL. */
  documentGateways(): readonly string[];
  /** Open another study inside this document (URL + router). */
  switchStudy(studyInstanceUid: string, gatewayAet: string): void;
  scheduler: EmbedScheduler;
}

export interface EmbedErrorRecord {
  code: string;
  stage: EmbedStage;
}

export interface EmbedBridgeState {
  active: boolean;
  inactiveReason: EmbedInactiveReason | null;
  documentId: string | null;
  bound: boolean;
  parentOrigin: string | null;
  allowedOrigins: string[];
  caseGeneration: number;
  boundAttemptGeneration: number | null;
  suspended: boolean;
  /** Hello rounds so far (one round may post to several candidate origins). */
  helloPosts: number;
  /** postMessage calls, per type. */
  sent: Record<string, number>;
  /** Accepted messages, per type (a no-op repeat counts; a dropped one does not). */
  received: Record<string, number>;
  dropped: Record<string, number>;
  /** Foreign traffic: not an object, or not this protocol. */
  ignored: number;
  lastReady: {
    caseGeneration: number;
    attemptId: string;
    attemptGeneration: number;
    shown: boolean;
  } | null;
  lastError: (EmbedErrorRecord & { caseGeneration: number }) | null;
  /** Errors waiting for the shell's hello (they need its nonce and case generation). */
  pendingErrors: EmbedErrorRecord[];
}

export interface EmbedBridge {
  /** Hand every `message` event of the window to this (the adapter does, only while active). */
  receive(event: EmbedInboundEvent): void;
  /**
   * The auth paths (§3): sign-in is needed and the frame will not navigate to
   * it. `code` is AUTH_REQUIRED, or AUTH_UNAVAILABLE when the identity provider
   * did not answer the frame's silent sign-in; a viewer.error on auth_ready,
   * queued and deduped like every other.
   */
  authRequired(code?: string): void;
  /**
   * Suspend/resume. A listener added while parked is told 'parked' at once (a
   * visibility that arrived before its owner booted is not lost), then every
   * change; returns an unsubscribe.
   */
  onVisibilityChange(listener: (state: EmbedVisibilityState) => void): () => void;
  getState(): EmbedBridgeState;
  /** Stop the hello, the trace subscription and the listeners (tests; a document never needs it). */
  dispose(): void;
}

/** The state of a bridge that never became active. */
export function inertEmbedState(
  reason: EmbedInactiveReason,
  allowedOrigins: readonly string[] = []
): EmbedBridgeState {
  return {
    active: false,
    inactiveReason: reason,
    documentId: null,
    bound: false,
    parentOrigin: null,
    allowedOrigins: allowedOrigins.slice(),
    caseGeneration: 0,
    boundAttemptGeneration: null,
    suspended: false,
    helloPosts: 0,
    sent: {},
    received: {},
    dropped: {},
    ignored: 0,
    lastReady: null,
    lastError: null,
    pendingErrors: [],
  };
}

function inactiveReasonFor(deps: EmbedBridgeDeps): EmbedInactiveReason | null {
  if (!deps.framed) {
    return 'not-framed';
  }
  if (!deps.allowedOrigins || deps.allowedOrigins.length === 0) {
    return 'no-allowed-origins';
  }
  if (!isEmbedId(deps.documentId)) {
    return 'bad-document-id';
  }
  return null;
}

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** The trace's attempt id is the launcher's; keep a post valid whatever it put on the URL. */
function safeAttemptId(id: unknown): string {
  if (isEmbedAttemptId(id)) {
    return id;
  }
  return String(id ?? '').replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 128) || 'unknown';
}

export function createEmbedBridge(deps: EmbedBridgeDeps): EmbedBridge {
  const inactiveReason = inactiveReasonFor(deps);
  const allowed: readonly string[] = (deps.allowedOrigins ?? []).slice();
  if (inactiveReason) {
    // Inert: no listener, no post, no subscription.
    return {
      receive: () => undefined,
      authRequired: () => undefined,
      onVisibilityChange: () => () => undefined,
      getState: () => inertEmbedState(inactiveReason, allowed),
      dispose: () => undefined,
    };
  }

  const { documentId, scheduler } = deps;

  let disposed = false;
  let binding: { parentOrigin: string; nonce: string } | null = null;
  /**
   * Where this document's events start in the trace's list. The trace resumes
   * from sessionStorage across the documents of one attempt (the OIDC
   * callback, a reload), so the list can hold an earlier document's render or
   * AUTH_REQUIRED; every replay reads from here on. Set once the trace
   * subscription is made (the recorder resolves the attempt on subscribe).
   */
  let eventBaseline = 0;
  let caseGeneration = 0;
  /** The study the shell named for the current case generation. */
  let caseStudy: { studyInstanceUid: string; gatewayAet: string } | null = null;
  let boundAttemptGeneration: number | null = null;
  /** studyRef of a study switched to in this document that the trace has not begun yet. */
  let pendingStudyRef: string | null = null;
  let suspended = false;
  let readyPosted = false;
  /** `code|stage` already posted in this case generation since the last ready. */
  const postedErrors = new Set<string>();
  let queuedErrors: EmbedErrorRecord[] = [];

  let helloPosts = 0;
  let helloTimer: unknown = null;
  const sent: Record<string, number> = {};
  const received: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  let ignored = 0;
  let lastReady: EmbedBridgeState['lastReady'] = null;
  let lastError: EmbedBridgeState['lastError'] = null;
  const visibilityListeners = new Set<(state: EmbedVisibilityState) => void>();

  const drop = (reason: EmbedDropReason): void => bump(dropped, reason);

  const postTo = (message: ToShellMessage, targetOrigin: string): boolean => {
    try {
      deps.post(message, targetOrigin);
      bump(sent, message.type);
      return true;
    } catch (_) {
      return false;
    }
  };

  /** Build (with the session nonce) and post to the bound parent; false when unbound or invalid. */
  const send = (build: (nonce: string) => ToShellMessage): boolean => {
    if (!binding) {
      return false;
    }
    let message: ToShellMessage;
    try {
      message = build(binding.nonce);
    } catch (_) {
      return false;
    }
    return postTo(message, binding.parentOrigin);
  };

  const snapshot = (): EmbedAttemptSnapshot | null => {
    try {
      return deps.attempt.snapshot();
    } catch (_) {
      return null;
    }
  };

  // --- hello ---------------------------------------------------------------

  const helloTargets = (): string[] => {
    let candidates: readonly string[] = [];
    try {
      candidates = deps.candidateParentOrigins() ?? [];
    } catch (_) {
      candidates = [];
    }
    // Never trust the candidates beyond the allow-list; none left → each allowed origin.
    const exact = candidates.filter((o, i) => allowed.includes(o) && candidates.indexOf(o) === i);
    return exact.length > 0 ? exact : allowed.slice();
  };

  const stopHello = (): void => {
    if (helloTimer !== null) {
      scheduler.clearTimeout(helloTimer);
      helloTimer = null;
    }
  };

  const sayHello = (): void => {
    helloTimer = null;
    if (disposed || binding || helloPosts >= EMBED_HELLO_MAX_POSTS) {
      return;
    }
    helloPosts += 1;
    const hello = buildEmbedMessage('viewer.hello', {
      nonce: null,
      caseGeneration: 0,
      payload: { documentId },
    });
    for (const origin of helloTargets()) {
      postTo(hello, origin);
    }
    if (helloPosts < EMBED_HELLO_MAX_POSTS) {
      const delay =
        EMBED_HELLO_DELAYS_MS[Math.min(helloPosts - 1, EMBED_HELLO_DELAYS_MS.length - 1)];
      helloTimer = scheduler.setTimeout(sayHello, delay);
    }
  };

  // --- ready / error -------------------------------------------------------

  const announceReady = (attemptId: string): void => {
    if (readyPosted || boundAttemptGeneration === null) {
      return;
    }
    const payload = {
      documentId,
      attemptId: safeAttemptId(attemptId),
      attemptGeneration: boundAttemptGeneration,
      shown: !suspended,
    };
    if (!send(nonce => buildEmbedMessage('viewer.ready', { nonce, caseGeneration, payload }))) {
      return;
    }
    readyPosted = true;
    postedErrors.clear();
    lastReady = {
      caseGeneration,
      attemptId: payload.attemptId,
      attemptGeneration: payload.attemptGeneration,
      shown: payload.shown,
    };
  };

  const reportError = (rawCode: unknown, rawStage: unknown): void => {
    const error: EmbedErrorRecord = {
      code: isEmbedErrorCode(rawCode) ? rawCode : FALLBACK_CODE,
      stage: isEmbedStage(rawStage) ? rawStage : 'failed',
    };
    if (!binding) {
      // No nonce or case generation yet: deliver once the shell's hello binds.
      if (!queuedErrors.some(q => q.code === error.code && q.stage === error.stage)) {
        queuedErrors.push(error);
      }
      return;
    }
    const key = `${error.code}|${error.stage}`;
    if (postedErrors.has(key)) {
      return;
    }
    const payload = { documentId, code: error.code, stage: error.stage };
    if (!send(nonce => buildEmbedMessage('viewer.error', { nonce, caseGeneration, payload }))) {
      return;
    }
    postedErrors.add(key);
    // A later matching render (Retry viewer recovered) is reported again.
    readyPosted = false;
    lastError = { caseGeneration, ...error };
  };

  /** One trace event of the bound attempt generation. */
  const consider = (event: EmbedAttemptEvent): void => {
    if (event.ok) {
      if (event.stage === RENDER_STAGE) {
        announceReady(event.attemptId);
      }
      return;
    }
    if (event.stage === CANCELLED_STAGE) {
      return;
    }
    reportError(event.error?.code, event.stage);
  };

  /**
   * Bind the current case generation to the trace's current attempt
   * generation, and replay this document's events of that generation in
   * order: a render (or a failure) that happened before the handshake is
   * reported now; an earlier document's is not.
   */
  const bindAttemptGeneration = (snap: EmbedAttemptSnapshot): void => {
    boundAttemptGeneration = snap.generation;
    const events = snap.events ?? [];
    for (let i = eventBaseline; i < events.length; i++) {
      if (events[i].generation === snap.generation) {
        consider(events[i]);
      }
    }
  };

  /** A study switched to in this document is bound once the trace has begun it. */
  const tryBindPending = (): boolean => {
    if (pendingStudyRef === null) {
      return false;
    }
    const snap = snapshot();
    if (!snap || snap.studyRef !== pendingStudyRef) {
      return false;
    }
    pendingStudyRef = null;
    bindAttemptGeneration(snap);
    return true;
  };

  const onAttemptEvent = (event: EmbedAttemptEvent): void => {
    if (disposed || !binding) {
      return;
    }
    if (pendingStudyRef !== null && tryBindPending()) {
      return; // the replay included this event
    }
    if (boundAttemptGeneration === null || event.generation !== boundAttemptGeneration) {
      return;
    }
    consider(event);
  };

  // --- inbound -------------------------------------------------------------

  const onShellHello = (message: ShellHelloMessage, origin: string): void => {
    if (message.payload.documentId !== documentId) {
      drop('unknown-document');
      return;
    }
    if (!binding) {
      binding = { parentOrigin: origin, nonce: message.nonce };
      caseGeneration = message.caseGeneration;
      bump(received, message.type);
      stopHello();
      const queued = queuedErrors;
      queuedErrors = [];
      queued.forEach(error => reportError(error.code, error.stage));
      return;
    }
    if (message.nonce !== binding.nonce) {
      drop('nonce-mismatch');
      return;
    }
    if (message.caseGeneration < caseGeneration) {
      drop('stale-generation');
      return;
    }
    bump(received, message.type); // a hello re-sent before ours arrived: idempotent
  };

  const startCaseGeneration = (generation: number): void => {
    caseGeneration = generation;
    caseStudy = null;
    boundAttemptGeneration = null;
    readyPosted = false;
    postedErrors.clear();
  };

  const routeStudy = (studyInstanceUid: string, gatewayAet: string): void => {
    const ref = deps.studyRefFor(studyInstanceUid);
    const snap = snapshot();
    if (pendingStudyRef === null && snap && snap.studyRef === ref) {
      bindAttemptGeneration(snap);
      return;
    }
    if (pendingStudyRef === ref) {
      tryBindPending(); // already on its way to this study
      return;
    }
    let gateways: readonly string[] = [];
    try {
      gateways = deps.documentGateways() ?? [];
    } catch (_) {
      gateways = [];
    }
    if (!gateways.includes(gatewayAet)) {
      // Not openable in this document: the shell reloads the frame instead.
      pendingStudyRef = null;
      reportError('STUDY_GATEWAY_MISMATCH', 'launch');
      return;
    }
    pendingStudyRef = ref;
    try {
      deps.switchStudy(studyInstanceUid, gatewayAet);
    } catch (_) {
      pendingStudyRef = null;
      reportError('STUDY_SWITCH_FAILED', 'launch');
      return;
    }
    tryBindPending();
  };

  const onShellStudy = (message: ShellStudyMessage): void => {
    const { studyInstanceUid, gatewayAet } = message.payload;
    if (message.caseGeneration === caseGeneration && caseStudy) {
      if (caseStudy.studyInstanceUid === studyInstanceUid && caseStudy.gatewayAet === gatewayAet) {
        bump(received, message.type); // the same study again: a no-op
        return;
      }
      drop('generation-reuse'); // a new study needs a new generation
      return;
    }
    bump(received, message.type);
    if (message.caseGeneration > caseGeneration) {
      startCaseGeneration(message.caseGeneration);
    }
    caseStudy = { studyInstanceUid, gatewayAet };
    routeStudy(studyInstanceUid, gatewayAet);
  };

  const onShellVisibility = (message: ShellVisibilityMessage): void => {
    bump(received, message.type);
    const parked = message.payload.state === 'parked';
    if (parked === suspended) {
      return;
    }
    suspended = parked;
    const state: EmbedVisibilityState = parked ? 'parked' : 'visible';
    for (const listener of Array.from(visibilityListeners)) {
      try {
        listener(state);
      } catch (_) {
        /* a listener must never break the bridge */
      }
    }
  };

  const receive = (event: EmbedInboundEvent): void => {
    if (disposed) {
      return;
    }
    const parsed = parseEmbedMessage(event.data, 'toViewer');
    if (parsed.ok === false && EMBED_FOREIGN_REASONS.includes(parsed.reason)) {
      ignored += 1;
      return;
    }
    if (!deps.isParent(event.source)) {
      drop('bad-source');
      return;
    }
    const origin = event.origin;
    if (!allowed.includes(origin) || (binding !== null && origin !== binding.parentOrigin)) {
      drop('bad-origin');
      return;
    }
    if (parsed.ok === false) {
      drop(parsed.reason as EmbedDropReason);
      return;
    }
    const message = parsed.message;
    if (message.type === 'shell.hello') {
      onShellHello(message, origin);
      return;
    }
    if (!binding) {
      drop('not-bound');
      return;
    }
    if (message.nonce !== binding.nonce) {
      drop('nonce-mismatch');
      return;
    }
    if (message.caseGeneration < caseGeneration) {
      drop('stale-generation');
      return;
    }
    if (message.type === 'shell.study') {
      onShellStudy(message);
    } else {
      onShellVisibility(message);
    }
  };

  let unsubscribeAttempt: (() => void) | null = null;
  try {
    unsubscribeAttempt = deps.attempt.subscribe(onAttemptEvent);
  } catch (_) {
    unsubscribeAttempt = null;
  }
  eventBaseline = snapshot()?.events?.length ?? 0;
  sayHello();

  return {
    receive,
    authRequired: (code = 'AUTH_REQUIRED') => {
      if (!disposed) {
        reportError(code, 'auth_ready');
      }
    },
    onVisibilityChange: listener => {
      if (disposed) {
        return () => undefined;
      }
      visibilityListeners.add(listener);
      if (suspended) {
        try {
          listener('parked');
        } catch (_) {
          /* a listener must never break the bridge */
        }
      }
      return () => {
        visibilityListeners.delete(listener);
      };
    },
    getState: () => ({
      active: true,
      inactiveReason: null,
      documentId,
      bound: binding !== null,
      parentOrigin: binding?.parentOrigin ?? null,
      allowedOrigins: allowed.slice(),
      caseGeneration,
      boundAttemptGeneration,
      suspended,
      helloPosts,
      sent: { ...sent },
      received: { ...received },
      dropped: { ...dropped },
      ignored,
      lastReady: lastReady ? { ...lastReady } : null,
      lastError: lastError ? { ...lastError } : null,
      pendingErrors: queuedErrors.map(error => ({ ...error })),
    }),
    dispose: () => {
      disposed = true;
      stopHello();
      unsubscribeAttempt?.();
      unsubscribeAttempt = null;
      visibilityListeners.clear();
    },
  };
}
