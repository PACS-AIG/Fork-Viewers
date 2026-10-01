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
 * never '*') until the shell answers with its nonce and case generation, and
 * answers each hello it accepts with its capabilities (`viewer.caps`: it
 * switches cases inside the document); the shell then names the case's study,
 * which is either the one the document's URL and the attempt trace are already
 * on (the case generation is bound to that attempt generation), or another
 * study on one of this document's gateways (the viewer switches in the
 * document, and binds once the trace has begun it in a generation opened
 * after the switch), or not openable here (STUDY_GATEWAY_MISMATCH).
 * `viewer.ready` and `viewer.error` come only from the trace's events of the
 * BOUND attempt generation in THIS document, so a late callback from a study
 * the shell has moved away from, or an earlier document's render (the trace
 * resumes across a reload), can never be reported as the new case's result.
 *
 * Slice 2 (the app's docs/rev11/m6-case-switch.md §6) adds the switch target
 * (routeTarget, requestedAtGeneration) so a switch back A → B → A never binds
 * A's old generation; STUDY_SWITCH_TIMEOUT for a switch the trace never
 * begins; and, while a switch is unbound, this document's own boot failures
 * (the sign-in above all) answered at the new case generation.
 */
import {
  buildEmbedMessage,
  parseEmbedMessage,
  isEmbedAttemptId,
  isEmbedErrorCode,
  isEmbedId,
  isEmbedStage,
  EMBED_FOREIGN_REASONS,
  type EmbedCap,
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

/** What this viewer advertises in `viewer.caps`: it switches cases inside the document. */
export const EMBED_VIEWER_CAPS: readonly EmbedCap[] = ['case-switch'];

/**
 * A switch the trace has not begun this long after the later of the request
 * and this document's first ok runtime_ready is answered with
 * STUDY_SWITCH_TIMEOUT (stage launch), so the shell can reload the frame. The
 * boot (silent sign-in, config, modules) is not counted: a slow but healthy
 * boot must not cost a cold remount.
 */
export const STUDY_SWITCH_TIMEOUT_MS = 20000;

const RENDER_STAGE: EmbedStage = 'image_rendered_matching_study';
/** A mode exit before the render (MODE_EXIT_BEFORE_RENDER): not a failure of the case. */
const CANCELLED_STAGE: EmbedStage = 'cancelled';
const RETRY_STAGE: EmbedStage = 'retry_requested';
const RUNTIME_STAGE: EmbedStage = 'runtime_ready';
/** The trace's own fallback for a code that breaks its rule. */
const FALLBACK_CODE = 'UNSPECIFIED_ERROR';
const SWITCH_TIMEOUT_CODE = 'STUDY_SWITCH_TIMEOUT';
/** The auth paths' codes (AUTH_REQUIRED, AUTH_UNAVAILABLE): the shell shows its sign-in card. */
const AUTH_CODE = /^AUTH_/;
/**
 * The document's own stages: a failure there (the sign-in, the config, the
 * runtime) means this document cannot open any case, so an unbound switch
 * carries it to the new case generation. A failure at a case stage (a
 * viewport's load, the engine, a lost context) belongs to the study it was
 * recorded under, and is never presented as the next case's.
 */
const DOCUMENT_STAGES: ReadonlySet<string> = new Set<EmbedStage>([
  'launch',
  'auth_ready',
  'config_ready',
  'runtime_ready',
]);

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

/** A view of the attempt recorder (platform/core utils/attempt). */
export interface EmbedAttemptView {
  subscribe(listener: (event: EmbedAttemptEvent) => void): () => void;
  snapshot(): EmbedAttemptSnapshot | null;
  /** The next mode entry opens a new generation, even for the study the trace names (a switch). */
  requestFreshGeneration(): void;
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
  /** The study this document's URL names (its first StudyInstanceUIDs); read once, at install. */
  routeStudyUid(): string | null;
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
  /** What `viewer.caps` advertises; none when inert. */
  caps: EmbedCap[];
  /** studyRef the document's URL is heading to: the URL's at install, then each switch's. */
  routeTarget: string | null;
  /** The trace's generation at the latest switchStudy; 0 when there has been none. */
  requestedAtGeneration: number;
  /** studyRef the current case generation waits for the trace to begin. */
  pendingStudyRef: string | null;
  /** STUDY_SWITCH_TIMEOUT: not running, waiting for this document's runtime_ready, or counting. */
  switchTimeout: 'off' | 'awaiting-runtime' | 'armed';
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
    caps: [],
    routeTarget: null,
    requestedAtGeneration: 0,
    pendingStudyRef: null,
    switchTimeout: 'off',
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
  /** studyRef of the case's study, which the trace has not begun yet (in a generation it may bind). */
  let pendingStudyRef: string | null = null;
  /**
   * The switch target (§6): the studyRef this document's URL is heading to.
   * The URL's at install; then set only after a switchStudy that did not
   * throw. A gateway mismatch or a refused switch leaves it.
   */
  let routeTarget: string | null = (() => {
    try {
      const uid = deps.routeStudyUid();
      return uid ? deps.studyRefFor(uid) : null;
    } catch (_) {
      return null;
    }
  })();
  /**
   * The trace's generation at the latest switchStudy (0: none in this
   * document, or no trace yet). A case binds only a generation above it: one
   * a mode entry opened after the URL moved, never one from before.
   */
  let requestedAtGeneration = 0;
  let switchTimer: unknown = null;
  /** The switch's clock starts at this document's first runtime_ready, which has not come yet. */
  let awaitingRuntime = false;
  /** An AUTH_* was posted in this case generation: the shell's sign-in card owns it, no timeout. */
  let authPosted = false;
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
    if (AUTH_CODE.test(error.code)) {
      // The shell answers with its sign-in card; a switch timeout would only
      // remount the frame under a reader who may be signing in.
      authPosted = true;
      stopSwitchTimeout();
    }
  };

  // --- the switch's deadline (STUDY_SWITCH_TIMEOUT) -----------------------

  const stopSwitchTimeout = (): void => {
    awaitingRuntime = false;
    if (switchTimer !== null) {
      scheduler.clearTimeout(switchTimer);
      switchTimer = null;
    }
  };

  const onSwitchTimeout = (): void => {
    switchTimer = null;
    if (disposed || pendingStudyRef === null) {
      return;
    }
    // A mode entry records no event: the trace may have begun the study with
    // nothing since to bind on. Begun → bound now, and nothing is posted.
    if (tryBindPending()) {
      return;
    }
    reportError(SWITCH_TIMEOUT_CODE, 'launch');
  };

  const startSwitchClock = (): void => {
    awaitingRuntime = false;
    switchTimer = scheduler.setTimeout(onSwitchTimeout, STUDY_SWITCH_TIMEOUT_MS);
  };

  /** This document's first ok runtime_ready (an earlier document's does not count). */
  const runtimeReadyInThisDocument = (): boolean => {
    const events = snapshot()?.events ?? [];
    for (let i = eventBaseline; i < events.length; i++) {
      if (events[i].stage === RUNTIME_STAGE && events[i].ok) {
        return true;
      }
    }
    return false;
  };

  /** 20 s from the later of now (the request) and this document's first runtime_ready. */
  const armSwitchTimeout = (): void => {
    stopSwitchTimeout();
    if (authPosted) {
      return;
    }
    if (runtimeReadyInThisDocument()) {
      startSwitchClock();
    } else {
      awaitingRuntime = true;
    }
  };

  /** One trace event of the bound attempt generation. */
  const consider = (event: EmbedAttemptEvent): void => {
    if (event.ok) {
      if (event.stage === RENDER_STAGE) {
        announceReady(event.attemptId);
      } else if (event.stage === RETRY_STAGE) {
        // Retry viewer opens a new episode: the render it brings is reported
        // even when another pane was ready before it, and a failure after it
        // is reported again although its code is the same.
        readyPosted = false;
        postedErrors.clear();
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

  /**
   * The case's study is bound once the trace has begun it in a generation
   * above requestedAtGeneration: one a mode entry opened after the URL moved
   * there. The trace naming the study in an older generation is not enough —
   * after A → B → A that is A's own old generation, rendered and gone.
   */
  const tryBindPending = (): boolean => {
    if (pendingStudyRef === null) {
      return false;
    }
    const snap = snapshot();
    if (!snap || snap.studyRef !== pendingStudyRef || !(snap.generation > requestedAtGeneration)) {
      return false;
    }
    pendingStudyRef = null;
    stopSwitchTimeout();
    bindAttemptGeneration(snap);
    return true;
  };

  /** A failure of the document itself, carried to the case generation that waits on it. */
  const forwardDocumentFailure = (event: EmbedAttemptEvent): void => {
    if (!event.ok && DOCUMENT_STAGES.has(event.stage)) {
      reportError(event.error?.code, event.stage);
    }
  };

  const onAttemptEvent = (event: EmbedAttemptEvent): void => {
    if (disposed || !binding) {
      return;
    }
    if (pendingStudyRef !== null) {
      if (tryBindPending()) {
        return; // the replay included this event
      }
      if (awaitingRuntime && event.ok && event.stage === RUNTIME_STAGE) {
        startSwitchClock();
      }
      // Unbound: only what stops this document opening ANY case is the new case's.
      forwardDocumentFailure(event);
      return;
    }
    if (boundAttemptGeneration === null || event.generation !== boundAttemptGeneration) {
      return;
    }
    consider(event);
  };

  // --- inbound -------------------------------------------------------------

  /** After each accepted shell.hello: this document switches cases in place (§6). */
  const postCaps = (): void => {
    send(nonce =>
      buildEmbedMessage('viewer.caps', {
        nonce,
        caseGeneration,
        payload: { documentId, caps: EMBED_VIEWER_CAPS.slice() },
      })
    );
  };

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
      postCaps();
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
    postCaps();
  };

  const startCaseGeneration = (generation: number): void => {
    caseGeneration = generation;
    caseStudy = null;
    boundAttemptGeneration = null;
    readyPosted = false;
    postedErrors.clear();
    // A superseded request's deadline never fires; the new one arms its own.
    stopSwitchTimeout();
    authPosted = false;
  };

  /**
   * Wait for the trace to begin the case's study (the switch target): bound
   * at once when it already has; otherwise this document's boot failures so
   * far are answered at the case generation, and the deadline is armed.
   */
  const awaitStudy = (ref: string): void => {
    pendingStudyRef = ref;
    if (tryBindPending()) {
      return;
    }
    const events = snapshot()?.events ?? [];
    for (let i = eventBaseline; i < events.length; i++) {
      forwardDocumentFailure(events[i]);
    }
    armSwitchTimeout();
  };

  const routeStudy = (studyInstanceUid: string, gatewayAet: string): void => {
    const ref = deps.studyRefFor(studyInstanceUid);
    if (ref === routeTarget) {
      // The URL is already this study's. Bind at once only a generation of it
      // the trace opened after the latest switch (or with none in this
      // document: the study the document was opened with); else wait.
      const snap = snapshot();
      if (snap && snap.studyRef === ref && snap.generation > requestedAtGeneration) {
        pendingStudyRef = null;
        stopSwitchTimeout();
        bindAttemptGeneration(snap);
        return;
      }
      awaitStudy(ref);
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
      stopSwitchTimeout();
      reportError('STUDY_GATEWAY_MISMATCH', 'launch');
      return;
    }
    // Another study — the trace may still name it (the switch back A → B → A):
    // switch anyway, and bind only a generation opened after this request.
    const atGeneration = snapshot()?.generation ?? 0;
    try {
      deps.switchStudy(studyInstanceUid, gatewayAet);
    } catch (_) {
      pendingStudyRef = null;
      stopSwitchTimeout();
      reportError('STUDY_SWITCH_FAILED', 'launch');
      return;
    }
    routeTarget = ref;
    requestedAtGeneration = atGeneration;
    try {
      deps.attempt.requestFreshGeneration();
    } catch (_) {
      /* a trace that cannot take it still binds a different study's new generation */
    }
    awaitStudy(ref);
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
      caps: EMBED_VIEWER_CAPS.slice(),
      routeTarget,
      requestedAtGeneration,
      pendingStudyRef,
      switchTimeout: switchTimer !== null ? 'armed' : awaitingRuntime ? 'awaiting-runtime' : 'off',
    }),
    dispose: () => {
      disposed = true;
      stopHello();
      stopSwitchTimeout();
      unsubscribeAttempt?.();
      unsubscribeAttempt = null;
      visibilityListeners.clear();
    },
  };
}
