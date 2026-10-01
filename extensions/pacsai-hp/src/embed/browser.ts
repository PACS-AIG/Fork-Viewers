/**
 * pacsai.embed/1 — the browser adapter for the viewer's bridge (Rev 11
 * milestone 6 part 2). The rules are all in embedBridge.ts; this file only
 * hands it the real window, trace, router and clock.
 *
 * platform/app's index.js installs it at the very top of the main bundle,
 * before the sign-in, so the hello goes out while the viewer is still booting
 * and an AUTH_REQUIRED from preInitSignIn has a bridge to tell. So this file
 * imports nothing heavy: '@ohif/core' utils (already in the main bundle), the
 * two pure modules and the priors' role registry (module state, no imports) —
 * never Cornerstone.
 *
 * One bridge per document: the instance is kept on a module variable AND a
 * non-enumerable window property, so the main bundle and the extension's chunk
 * (or two copies of this module) share it. The harness reads the read-only
 * `window.__pacsaiEmbed.getState()`, which never exposes the nonce, and whose
 * `caseView` shows what the viewer holds for the case as study refs, never UIDs.
 */
import { utils } from '@ohif/core';
import { EMBED_VERSION, mintEmbedId, normalizeEmbedOrigins } from './embedProtocol';
import {
  createEmbedBridge,
  inertEmbedState,
  type EmbedAttemptView,
  type EmbedBridgeState,
  type EmbedInactiveReason,
  type EmbedVisibilityState,
} from './embedBridge';
import {
  getAvailablePriors,
  getPriorUIDs,
  getSessionStudies,
  getSiblingUIDs,
} from '../priors/roleRegistry';

export type { EmbedBridgeState, EmbedVisibilityState };

/**
 * What the viewer holds for the case now, as FNV-1a study refs (the attempt
 * trace's studyRefFor), for the harness's wrong-patient checks
 * (m6-case-switch.md §6): the display sets' studies, the toolbar's session
 * studies, the comparison roles, and the hanging protocol's active study.
 */
export interface EmbedCaseView {
  /** The bridge's case generation when this was read. */
  caseGeneration: number;
  /** DisplaySetService's active display sets: their studies, distinct, sorted. */
  displaySetStudies: string[];
  /** getSessionStudies(), in display order. */
  sessionStudies: string[];
  /** The role registry: the hung priors and siblings (sorted), and the offered priors (in order). */
  roles: { priors: string[]; siblings: string[]; availablePriors: string[] };
  /** HangingProtocolService's active study. */
  activeStudy: string | null;
}

/** The hook's state: the bridge's, plus the case view. */
export type EmbedHookState = EmbedBridgeState & { caseView: EmbedCaseView };

export interface EmbedBridgeHandle {
  /**
   * The auth paths: sign-in is needed and the framed viewer will not navigate
   * to it. AUTH_REQUIRED unless `code` says otherwise (AUTH_UNAVAILABLE).
   */
  authRequired(code?: string): void;
  /** Told 'parked' at once when already parked, then on every change; returns an unsubscribe. */
  onVisibilityChange(listener: (state: EmbedVisibilityState) => void): () => void;
  getState(): EmbedBridgeState;
}

interface InstalledBridge {
  /** Null when the bridge is inert (not framed, or no allowed origin). */
  handle: EmbedBridgeHandle | null;
  getState(): EmbedBridgeState;
}

const INSTANCE_KEY = '__pacsaiEmbedBridgeInstance';
const HOOK_KEY = '__pacsaiEmbed';

type EmbedWindow = Window & {
  PACSAI_EMBED_ORIGINS?: unknown;
  [INSTANCE_KEY]?: InstalledBridge;
};

let installed: InstalledBridge | null = null;

/** window.self !== window.top; a throw (a cross-origin top that refuses the read) means framed. */
export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch (_) {
    return true;
  }
}

function shared(): InstalledBridge | null {
  try {
    const found = (window as EmbedWindow)[INSTANCE_KEY];
    return found && typeof found.getState === 'function' ? found : null;
  } catch (_) {
    return null;
  }
}

function defineReadOnly(key: string, value: unknown, enumerable: boolean): void {
  try {
    Object.defineProperty(window, key, { value, writable: false, enumerable, configurable: false });
  } catch (_) {
    /* another copy defined it first */
  }
}

/** Where the hello goes before binding: the parent's origin when it is known and allowed. */
function candidateParentOrigins(allowed: readonly string[]): string[] {
  try {
    const ancestors = window.location.ancestorOrigins;
    const first = ancestors && ancestors.length > 0 ? String(ancestors[0]).toLowerCase() : '';
    if (first && allowed.includes(first)) {
      return [first];
    }
  } catch (_) {
    /* not supported (Firefox) */
  }
  try {
    const referrer = document.referrer ? new URL(document.referrer).origin.toLowerCase() : '';
    if (referrer && allowed.includes(referrer)) {
      return [referrer];
    }
  } catch (_) {
    /* no referrer, or not a URL */
  }
  return allowed.slice();
}

/** The params a switch keeps from the document's query: the attempt's own (§6). */
const KEPT_ATTEMPT_PARAMS = ['attempt', 'attemptT0'];

/**
 * Open another study inside this document: the query is REBUILT for the case
 * — StudyInstanceUIDs, the document's gatewayAET values (the data sources
 * were built for them), attempt and attemptT0, nothing else, so the previous
 * case's SeriesInstanceUIDs, initial series or image, hanging protocol, stage
 * and token never reach the next one — then a popstate lets react-router's
 * BrowserRouter re-read the location, so the Mode route re-enters the mode and
 * onModeEnter's attempt.begin opens a new generation. Before the boot there is
 * no router yet; the boot opens the new URL.
 */
function switchStudy(
  studyInstanceUid: string,
  gatewayAet: string,
  documentGateways: readonly string[]
): void {
  const url = new URL(window.location.href);
  const query = new URLSearchParams();
  query.set('StudyInstanceUIDs', studyInstanceUid);
  const gateways = documentGateways.includes(gatewayAet)
    ? documentGateways
    : [...documentGateways, gatewayAet];
  gateways.forEach(gateway => query.append('gatewayAET', gateway));
  for (const key of KEPT_ATTEMPT_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      query.set(key, value);
    }
  }
  url.search = query.toString();
  // Keep the router's own history state (idx, key), so it reads this as a
  // same-entry pop, not a jump.
  window.history.replaceState(window.history.state, '', url.toString());
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
}

/** The study the document's URL names now: its first StudyInstanceUIDs, as attempt.init reads it. */
function routeStudyUid(): string | null {
  const uids = new URLSearchParams(window.location.search).get('StudyInstanceUIDs');
  return uids?.split(',')[0]?.trim() || null;
}

const attemptView: EmbedAttemptView = {
  subscribe: listener => utils.attempt.subscribe(listener),
  snapshot: () => {
    const trace = utils.attempt.snapshot();
    return trace
      ? {
          attemptId: trace.attemptId,
          generation: trace.generation,
          studyRef: trace.studyRef,
          events: trace.events,
        }
      : null;
  },
  requestFreshGeneration: () => utils.attempt.requestFreshGeneration(),
};

type CaseServices = {
  displaySetService?: {
    getActiveDisplaySets?: () => ReadonlyArray<{ StudyInstanceUID?: unknown }>;
  };
  hangingProtocolService?: {
    activeStudy?: { StudyInstanceUID?: unknown } | null;
    getState?: () => { activeStudyUID?: unknown } | undefined;
  };
};

/** Each read on its own: a service that is not there yet, or throws, gives nothing. */
function readSafely<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value ?? fallback;
  } catch (_) {
    return fallback;
  }
}

const refsOf = (uids: readonly unknown[]): string[] =>
  uids.flatMap(uid => (typeof uid === 'string' && uid ? [utils.studyRefFor(uid)] : []));
const distinctSorted = (refs: string[]): string[] => Array.from(new Set(refs)).sort();

/**
 * The case view, read lazily on every call from window.services (published by
 * the Cornerstone extension's init) and the role registry. Refs only.
 */
function readCaseView(state: EmbedBridgeState): EmbedCaseView {
  const services = readSafely(
    () => (window as unknown as { services?: CaseServices }).services,
    undefined
  );
  const displaySetUids = readSafely(() => {
    const displaySets = services?.displaySetService?.getActiveDisplaySets?.() ?? [];
    return Array.from(displaySets, ds => ds?.StudyInstanceUID);
  }, []);
  const hp = services?.hangingProtocolService;
  const activeUid = readSafely(
    () => hp?.activeStudy?.StudyInstanceUID ?? hp?.getState?.()?.activeStudyUID,
    undefined
  );
  return {
    caseGeneration: state.caseGeneration,
    displaySetStudies: distinctSorted(refsOf(displaySetUids)),
    sessionStudies: refsOf(readSafely(() => getSessionStudies().map(s => s.uid), [])),
    roles: {
      priors: distinctSorted(refsOf(readSafely(getPriorUIDs, []))),
      siblings: distinctSorted(refsOf(readSafely(getSiblingUIDs, []))),
      availablePriors: refsOf(readSafely(() => getAvailablePriors().map(p => p.uid), [])),
    },
    activeStudy: refsOf([activeUid])[0] ?? null,
  };
}

/** The harness hook's state; the case view can never break it. */
function hookState(record: InstalledBridge): EmbedHookState {
  const state = record.getState();
  return { ...state, caseView: readCaseView(state) };
}

function inert(reason: EmbedInactiveReason, allowed: readonly string[] = []): InstalledBridge {
  return { handle: null, getState: () => inertEmbedState(reason, allowed) };
}

function create(): InstalledBridge {
  const allowedOrigins = normalizeEmbedOrigins((window as EmbedWindow).PACSAI_EMBED_ORIGINS);
  const framed = isFramed();
  // This document's gateways, as it was opened (a switch keeps them).
  const gateways = new URLSearchParams(window.location.search).getAll('gatewayAET');
  const bridge = createEmbedBridge({
    allowedOrigins,
    framed,
    // Minted only for a bridge that will talk; an inert one reports no id.
    documentId: framed && allowedOrigins.length > 0 ? mintEmbedId() : '',
    post: (message, targetOrigin) => window.parent.postMessage(message, targetOrigin),
    isParent: source => source === window.parent,
    candidateParentOrigins: () => candidateParentOrigins(allowedOrigins),
    attempt: attemptView,
    studyRefFor: uid => utils.studyRefFor(uid),
    routeStudyUid,
    documentGateways: () => gateways,
    switchStudy: (uid, gatewayAet) => switchStudy(uid, gatewayAet, gateways),
    scheduler: {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: handle => window.clearTimeout(handle as number),
    },
  });
  if (!bridge.getState().active) {
    return { handle: null, getState: () => bridge.getState() };
  }
  window.addEventListener('message', (event: MessageEvent) => {
    try {
      bridge.receive({ source: event.source, origin: event.origin, data: event.data });
    } catch (_) {
      /* a malformed event must never break the viewer */
    }
  });
  const handle: EmbedBridgeHandle = {
    authRequired: code => bridge.authRequired(code),
    onVisibilityChange: listener => bridge.onVisibilityChange(listener),
    getState: () => bridge.getState(),
  };
  return { handle, getState: handle.getState };
}

/**
 * Install this document's bridge (idempotent). Returns null when it is inert —
 * not framed, or no allowed origin — but the read-only hook is installed either
 * way and reports `active: false` with the reason.
 */
export function installEmbedBridge(): EmbedBridgeHandle | null {
  if (installed) {
    return installed.handle;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  const existing = shared();
  if (existing) {
    installed = existing;
    return existing.handle;
  }
  let record: InstalledBridge;
  try {
    record = create();
  } catch (_) {
    record = inert('install-failed');
  }
  installed = record;
  defineReadOnly(INSTANCE_KEY, record, false);
  defineReadOnly(
    HOOK_KEY,
    Object.freeze({ version: EMBED_VERSION, getState: () => hookState(record) }),
    true
  );
  return record.handle;
}

/** This document's bridge when one was installed and is active; never installs one. */
export function getEmbedBridge(): EmbedBridgeHandle | null {
  if (installed) {
    return installed.handle;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  const existing = shared();
  if (existing) {
    installed = existing;
  }
  return existing ? existing.handle : null;
}
