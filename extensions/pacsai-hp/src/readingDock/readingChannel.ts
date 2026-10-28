/**
 * Rev 11 milestone 6, approach C, phase 2: the reading window's side of its
 * channel with the worklist that opened it. For a reader on the pilot's allow
 * list, the worklist opens this route (radcopilot) in one held window and,
 * on the next Read, asks it to open that case in its own page instead of
 * replacing it; after Sign it relays `closeWindow`, so the worklist closes the
 * window (until the next-case offer is built, decision 5).
 *
 * The worklist's side is the app's src/app/lib/workspaceCaseChannel.ts (one
 * pending open, the 2000 ms fallback to replacing this page, late answers,
 * retired documents). The messages are the app's, byte for byte: the same
 * golden vectors (readingChannel.vectors.json, generated from the app's
 * rules) live in both repos, and each side pins their SHA-256.
 *
 *   worklist → here   workspaceOpenCase {action, requestId, studyInstanceUid, attempt, attemptT0, gatewayAET?}
 *   here → worklist   workspaceCaseOpened {action, requestId, documentId, accepted, sameCase?, activeLaunch | reason}
 *                     workspaceState {action, documentId, activeLaunch, caseSwitch?: 1}
 *                     closeWindow {action, sessionId}
 *                     workspaceNextCase {action, documentId, activeLaunch}   (F72, 28 Oct 2026)
 *
 * Every message is a same-origin window post with the exact target origin. A
 * command counts only from this window's opener, from this origin, valid.
 * Pure: no window, timers or network (readingDock.ts wires it; the tests run
 * the vectors, readingChannel.test.ts).
 */

export const OPEN_CASE_ACTION = 'workspaceOpenCase';
export const CASE_OPENED_ACTION = 'workspaceCaseOpened';
export const WORKSPACE_STATE_ACTION = 'workspaceState';
export const CLOSE_WINDOW_ACTION = 'closeWindow';
/**
 * F72 (28 Oct 2026): this window opens the next case itself (the offer after
 * Sign, Open), under this launch; the worklist then takes it as the case the
 * window shows (its closeWindow match and its adverts' filter).
 */
export const NEXT_CASE_ACTION = 'workspaceNextCase';
/** The worklist falls back to replacing this page after this long with no answer. */
export const OPEN_CASE_FALLBACK_MS = 2000;
/** This window answers a command within this. */
export const OPEN_CASE_ANSWER_MS = 1000;
/** The same bytes as the app's src/app/lib/readingChannel.vectors.json. */
export const READING_CHANNEL_VECTORS_SHA256 =
  'd8e82a90e58fde3d6d5d465ddec945e7eeec39e63b6c014d6f3cbd380cb68f8c';
/**
 * The cases one document holds (the 13th loads in a fresh one): the viewer's
 * DicomMetadataStore and metadata caches are never pruned (B30: do not keep
 * every previously opened case resident), as milestone 6's shell capped its
 * frame (m6-case-switch.md §7).
 */
export const MAX_CASES_IN_DOCUMENT = 12;

export const CASE_REFUSAL_REASONS = ['submitting', 'disabled', 'separate', 'reload'] as const;
export type CaseRefusalReason = (typeof CASE_REFUSAL_REASONS)[number];

const CHANNEL_ID = /^[A-Za-z0-9-]{8,64}$/;
const STUDY_UID = /^[0-9]+(\.[0-9]+)*$/;
const MAX_STUDY_UID = 64;
const ATTEMPT = /^[A-Za-z0-9._:-]{1,128}$/;
const GATEWAY_AET = /^[A-Za-z0-9_.-]{1,64}$/;

/** As the app's userSettings.ts isPlainObject (the vectors pin the same answers). */
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isChannelId = (v: unknown): v is string => typeof v === 'string' && CHANNEL_ID.test(v);
export const isCaseStudyUid = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_STUDY_UID && STUDY_UID.test(v);
export const isCaseAttempt = (v: unknown): v is string => typeof v === 'string' && ATTEMPT.test(v);
export const isCaseAttemptT0 = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export const isCaseGatewayAet = (v: unknown): v is string =>
  typeof v === 'string' && GATEWAY_AET.test(v) && v !== 'undefined' && v !== 'null';
export const isCaseRefusalReason = (v: unknown): v is CaseRefusalReason =>
  (CASE_REFUSAL_REASONS as ReadonlyArray<unknown>).includes(v);

export interface ChannelLaunch {
  attempt: string;
  attemptT0: number;
}

const hasKeys = (
  o: Record<string, unknown>,
  required: ReadonlyArray<string>,
  optional: ReadonlyArray<string> = []
): boolean => {
  const own = Object.keys(o);
  return (
    required.every(k => Object.prototype.hasOwnProperty.call(o, k)) &&
    own.every(k => required.includes(k) || optional.includes(k))
  );
};

export const isChannelLaunch = (v: unknown): v is ChannelLaunch =>
  isPlainObject(v) &&
  hasKeys(v, ['attempt', 'attemptT0']) &&
  isCaseAttempt(v.attempt) &&
  isCaseAttemptT0(v.attemptT0);

const copyLaunch = (l: ChannelLaunch): ChannelLaunch => ({
  attempt: l.attempt,
  attemptT0: l.attemptT0,
});

export interface OpenCaseCommand {
  action: typeof OPEN_CASE_ACTION;
  requestId: string;
  studyInstanceUid: string;
  attempt: string;
  attemptT0: number;
  gatewayAET?: string;
}

export type ChannelParse<T> = { ok: true; value: T } | { ok: false; reason: 'action' | 'payload' };

const OPEN_CASE_KEYS = ['action', 'requestId', 'studyInstanceUid', 'attempt', 'attemptT0'];
const OPEN_CASE_OPTIONAL_KEYS = ['gatewayAET'];

/** A `workspaceOpenCase`: `action` first (anything else is not one), then
 *  exactly its five keys and `gatewayAET` if present, each by its rule. */
export function parseOpenCase(data: unknown): ChannelParse<OpenCaseCommand> {
  if (!isPlainObject(data) || data.action !== OPEN_CASE_ACTION) {
    return { ok: false, reason: 'action' };
  }
  if (
    !hasKeys(data, OPEN_CASE_KEYS, OPEN_CASE_OPTIONAL_KEYS) ||
    !isChannelId(data.requestId) ||
    !isCaseStudyUid(data.studyInstanceUid) ||
    !isCaseAttempt(data.attempt) ||
    !isCaseAttemptT0(data.attemptT0) ||
    ('gatewayAET' in data && !isCaseGatewayAet(data.gatewayAET))
  ) {
    return { ok: false, reason: 'payload' };
  }
  return {
    ok: true,
    value: {
      action: OPEN_CASE_ACTION,
      requestId: data.requestId,
      studyInstanceUid: data.studyInstanceUid,
      attempt: data.attempt,
      attemptT0: data.attemptT0,
      ...('gatewayAET' in data ? { gatewayAET: data.gatewayAET as string } : {}),
    },
  };
}

export const commandLaunch = (command: OpenCaseCommand): ChannelLaunch => ({
  attempt: command.attempt,
  attemptT0: command.attemptT0,
});

export interface CaseCommandEvent {
  /** `event.source === window.opener`. */
  fromOpener: boolean;
  /** The opener exists and is not closed. */
  openerOpen: boolean;
  origin: string;
  data: unknown;
}

export type CaseCommandIgnore = 'source' | 'origin' | 'action' | 'payload';

/** `command`: one to decide on. `ignored`: refused before any decision, and
 *  counted; never answered. `foreign`: traffic that is not the channel's (the
 *  viewer's sign-in frames, OHIF's own), neither answered nor counted. */
export type CaseCommandScreen =
  | { kind: 'command'; command: OpenCaseCommand }
  | { kind: 'ignored'; why: CaseCommandIgnore }
  | { kind: 'foreign' };

/** The opener's window (and it is open), this origin, the action, the payload. */
export function screenCaseCommand(event: CaseCommandEvent, ownOrigin: string): CaseCommandScreen {
  const claims = isPlainObject(event.data) && event.data.action === OPEN_CASE_ACTION;
  if (!event.fromOpener || !event.openerOpen) {
    return claims ? { kind: 'ignored', why: 'source' } : { kind: 'foreign' };
  }
  if (event.origin !== ownOrigin) {
    return claims ? { kind: 'ignored', why: 'origin' } : { kind: 'foreign' };
  }
  const parsed = parseOpenCase(event.data);
  if (parsed.ok === false) {
    return { kind: 'ignored', why: parsed.reason };
  }
  return { kind: 'command', command: parsed.value };
}

/** What this window does with a command. */
export type ReadingVerdict =
  /** The case already shown: focus only. */
  | { verdict: 'focus-only' }
  /** Open it in this document (the viewer's in-document study switch). */
  | { verdict: 'switch' }
  /** Accepted, in a fresh document: this one settles the report, then loads the case's address. */
  | { verdict: 'reload'; why: 'gateway' | 'cases' }
  | { verdict: 'refuse'; reason: CaseRefusalReason };

export interface ReadingCommandContext {
  /** The dock's phase (readingDock.ts). */
  phase: 'loading' | 'mounted' | 'failed' | 'gone';
  /** The study this document's route shows. */
  routeStudy: string | null;
  /** The island's state for the route's study, once it said (null: still opening). */
  caseState: 'reportable' | 'unavailable' | null;
  /** The gateways this document's data sources were built for. */
  documentGateways: readonly string[];
  /** The cases this document has held, the one it opened with included. */
  casesInDocument: number;
}

/**
 * In order: a dock that is going or failed needs a fresh document (`reload`,
 * the worklist's retry); the case already shown focuses (unless it could not
 * be opened: `reload`); a command with no gateway is not opened here
 * (`reload`); another gateway, or a 13th case, is accepted into a fresh
 * document; anything else switches in this one. A Submit in flight is not a
 * refusal here: the switch waits for it under the cover (readingDock.ts).
 */
export function decideReadingCommand(
  command: OpenCaseCommand,
  ctx: ReadingCommandContext
): ReadingVerdict {
  if (ctx.phase === 'failed' || ctx.phase === 'gone') {
    return { verdict: 'refuse', reason: 'reload' };
  }
  if (command.studyInstanceUid === ctx.routeStudy) {
    return ctx.caseState === 'unavailable'
      ? { verdict: 'refuse', reason: 'reload' }
      : { verdict: 'focus-only' };
  }
  if (command.gatewayAET === undefined) {
    return { verdict: 'refuse', reason: 'reload' };
  }
  if (!ctx.documentGateways.includes(command.gatewayAET)) {
    return { verdict: 'reload', why: 'gateway' };
  }
  if (ctx.casesInDocument >= MAX_CASES_IN_DOCUMENT) {
    return { verdict: 'reload', why: 'cases' };
  }
  return { verdict: 'switch' };
}

export type CaseOpenedAnswer =
  | {
      action: typeof CASE_OPENED_ACTION;
      requestId: string;
      documentId: string;
      accepted: true;
      sameCase?: boolean;
      activeLaunch: ChannelLaunch;
    }
  | {
      action: typeof CASE_OPENED_ACTION;
      requestId: string;
      documentId: string;
      accepted: false;
      reason: CaseRefusalReason;
    };

/** The answer to post (the app's caseOpenedAnswer, as the vectors pin it). */
export function caseOpenedAnswer(
  command: OpenCaseCommand,
  documentId: string,
  verdict:
    | { verdict: 'accept'; activeLaunch: ChannelLaunch }
    | { verdict: 'focus-only'; activeLaunch: ChannelLaunch }
    | { verdict: 'refuse'; reason: CaseRefusalReason }
): CaseOpenedAnswer {
  if (!isChannelId(documentId)) {
    throw new Error(`${CASE_OPENED_ACTION}: invalid documentId`);
  }
  const head = { action: CASE_OPENED_ACTION, requestId: command.requestId, documentId } as const;
  if (verdict.verdict === 'refuse') {
    if (!isCaseRefusalReason(verdict.reason)) {
      throw new Error(`${CASE_OPENED_ACTION}: invalid reason`);
    }
    return { ...head, accepted: false, reason: verdict.reason };
  }
  if (!isChannelLaunch(verdict.activeLaunch)) {
    throw new Error(`${CASE_OPENED_ACTION}: invalid activeLaunch`);
  }
  return {
    ...head,
    accepted: true,
    ...(verdict.verdict === 'focus-only' ? { sameCase: true } : {}),
    activeLaunch: copyLaunch(verdict.activeLaunch),
  };
}

/** The advertisement: this document, the launch of the case it shows, and
 *  `caseSwitch: 1` while it can open the next case in its page. Without a
 *  valid launch it never advertises a switch (the worklist ties it to the
 *  launch it sent this window to). No layout: the reading layout is the viewer's. */
export function buildAdvert({
  documentId,
  activeLaunch,
  caseSwitch,
}: {
  documentId: string;
  activeLaunch: ChannelLaunch | null | undefined;
  caseSwitch: boolean;
}): {
  action: typeof WORKSPACE_STATE_ACTION;
  documentId: string;
  activeLaunch?: ChannelLaunch;
  caseSwitch?: 1;
} {
  if (!isChannelId(documentId)) {
    throw new Error(`${WORKSPACE_STATE_ACTION}: invalid documentId`);
  }
  const launch = isChannelLaunch(activeLaunch) ? copyLaunch(activeLaunch) : null;
  return {
    action: WORKSPACE_STATE_ACTION,
    documentId,
    ...(launch ? { activeLaunch: launch } : {}),
    ...(caseSwitch && launch ? { caseSwitch: 1 as const } : {}),
  };
}

/** The relay after Sign: the signed case's session (its launch id, nothing about the patient). */
/** F72: `workspaceNextCase`, before this window opens the offered case. */
export function buildNextCase({
  documentId,
  activeLaunch,
}: {
  documentId: string;
  activeLaunch: ChannelLaunch;
}): { action: typeof NEXT_CASE_ACTION; documentId: string; activeLaunch: ChannelLaunch } {
  if (!isChannelId(documentId)) {
    throw new Error(`${NEXT_CASE_ACTION}: invalid documentId`);
  }
  if (!isChannelLaunch(activeLaunch)) {
    throw new Error(`${NEXT_CASE_ACTION}: invalid activeLaunch`);
  }
  return { action: NEXT_CASE_ACTION, documentId, activeLaunch: copyLaunch(activeLaunch) };
}

export function buildCloseWindow(
  sessionId: unknown
): { action: typeof CLOSE_WINDOW_ACTION; sessionId: string } | null {
  return isCaseAttempt(sessionId) ? { action: CLOSE_WINDOW_ACTION, sessionId } : null;
}

const ID_BYTES = 16;
/** A `documentId`: 16 random bytes as 32 lower-case hex characters. */
export function mintDocumentId(
  randomBytes: (n: number) => Uint8Array = n => {
    const bytes = new Uint8Array(n);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
): string {
  const bytes = randomBytes(ID_BYTES);
  if (!bytes || bytes.length < ID_BYTES) {
    throw new Error('reading channel: the random source returned too few bytes');
  }
  let out = '';
  for (let i = 0; i < ID_BYTES; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * The reading route for a case in THIS document (the in-document switch) or a
 * fresh one (a planned reload): the route this document was opened on, the
 * study, the gateways, and the case's own launch, nothing else (a previous
 * case's series, initial image, hanging protocol or token never carry over).
 */
export function readingRouteFor({
  href,
  openedPath,
  studyInstanceUid,
  gateways,
  launch,
}: {
  href: string;
  openedPath: string | null;
  studyInstanceUid: string;
  gateways: readonly string[];
  launch: ChannelLaunch;
}): string | null {
  if (
    !isCaseStudyUid(studyInstanceUid) ||
    !gateways.length ||
    !gateways.every(isCaseGatewayAet) ||
    !isChannelLaunch(launch)
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch (_) {
    return null;
  }
  if (openedPath) {
    url.pathname = openedPath;
  }
  const query = new URLSearchParams();
  query.set('StudyInstanceUIDs', studyInstanceUid);
  Array.from(new Set(gateways)).forEach(gateway => query.append('gatewayAET', gateway));
  query.set('attempt', launch.attempt);
  query.set('attemptT0', String(launch.attemptT0));
  url.search = query.toString();
  url.hash = '';
  return url.toString();
}
