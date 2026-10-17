/**
 * Rev 11 milestone 6, approach C, phase 1: loading the app's editor island
 * into the viewer's page (pacsai.reportIsland, version 1). The app serves it
 * from the viewer's own origin (prod and app-dev are one origin), so the
 * island calls the app's routes with the reader's app session and Keycloak,
 * nginx and dapi do not change.
 *
 *   1. GET /api/workspace/flags: `viewerHost` must be true (the app's
 *      WORKSPACE_VIEWER_HOST; off under v2 and in production builds unless set).
 *   2. import('/api/report-editor/report-editor.js'), outside webpack.
 *   3. The module, and later the handle, must name the api and version this
 *      viewer speaks; anything else is not mounted.
 *
 * Pure apart from its two injected effects (fetch and import), so every
 * outcome is unit-tested (islandLoader.test.ts).
 */

export const ISLAND_API = 'pacsai.reportIsland';
export const ISLAND_API_VERSION = 1;
export const FLAGS_PATH = '/api/workspace/flags';
export const ISLAND_LOADER_PATH = '/api/report-editor/report-editor.js';

/** Why there is no island, as the column says and the harness reads it. */
export type IslandLoadFailure =
  | 'APP_SIGNED_OUT' // the flags answered 401: no app session in this browser
  | 'FLAGS_UNREADABLE' // any other answer, or none
  | 'VIEWER_HOST_OFF' // the app does not serve the island here
  | 'ISLAND_LOAD_FAILED' // the import failed
  | 'ISLAND_VERSION_MISMATCH'; // the module or its handle is not v1

export interface IslandLaunch {
  attempt: string;
  attemptT0: number;
}

/** The handle the island returns, as far as this viewer uses it. */
export interface IslandHandleLike {
  readonly api: unknown;
  readonly version: unknown;
  setCase: (
    studyInstanceUid: string,
    launch?: IslandLaunch
  ) =>
    | { ok: true; generation: number; sameCase: boolean }
    | { ok: false; reason: 'submitting' | 'invalid' | 'unmounted' | 'not-ready' };
  setVisibility: (visible: boolean) => void;
  setFocus: () => boolean;
  settle: () => Promise<{ studyInstanceUid: string; generation: number; state: string; draft?: string }>;
  unmount: () => void;
  /** Optional in v1: start or stop the report's recognizer (false: nothing to toggle). */
  toggleDictation?: () => boolean;
  /** Optional in v1 (phase 2): a Submit is in flight (a planned reload waits for it). */
  isSubmitting?: () => boolean;
}

export interface IslandModuleLike {
  ISLAND_API: unknown;
  ISLAND_API_VERSION: unknown;
  ISLAND_BUILD?: unknown;
  mountReportEditor: (element: HTMLElement, options: Record<string, unknown>) => IslandHandleLike;
}

export type IslandLoadResult =
  | { ok: true; module: IslandModuleLike; build: string | null }
  | { ok: false; failure: IslandLoadFailure; detail?: string };

interface FetchLike {
  (input: string, init?: Record<string, unknown>): Promise<{
    status: number;
    ok: boolean;
    json: () => Promise<unknown>;
  }>;
}

export const moduleSpeaksV1 = (m: unknown): m is IslandModuleLike =>
  typeof m === 'object' &&
  m !== null &&
  (m as IslandModuleLike).ISLAND_API === ISLAND_API &&
  (m as IslandModuleLike).ISLAND_API_VERSION === ISLAND_API_VERSION &&
  typeof (m as IslandModuleLike).mountReportEditor === 'function';

export const handleSpeaksV1 = (h: unknown): h is IslandHandleLike =>
  typeof h === 'object' &&
  h !== null &&
  (h as IslandHandleLike).api === ISLAND_API &&
  (h as IslandHandleLike).version === ISLAND_API_VERSION &&
  ['setCase', 'setVisibility', 'setFocus', 'settle', 'unmount'].every(
    k => typeof (h as Record<string, unknown>)[k] === 'function'
  );

const why = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 120);

export async function loadIsland({
  fetchFn,
  importFn,
}: {
  fetchFn: FetchLike;
  importFn: (url: string) => Promise<unknown>;
}): Promise<IslandLoadResult> {
  let flags: unknown;
  try {
    const res = await fetchFn(FLAGS_PATH, { credentials: 'same-origin', cache: 'no-store' });
    if (res.status === 401) {
      return { ok: false, failure: 'APP_SIGNED_OUT' };
    }
    if (!res.ok) {
      return { ok: false, failure: 'FLAGS_UNREADABLE', detail: `HTTP ${res.status}` };
    }
    flags = await res.json();
  } catch (e) {
    return { ok: false, failure: 'FLAGS_UNREADABLE', detail: why(e) };
  }
  if ((flags as { viewerHost?: unknown } | null)?.viewerHost !== true) {
    return { ok: false, failure: 'VIEWER_HOST_OFF' };
  }
  let m: unknown;
  try {
    m = await importFn(ISLAND_LOADER_PATH);
  } catch (e) {
    return { ok: false, failure: 'ISLAND_LOAD_FAILED', detail: why(e) };
  }
  if (!moduleSpeaksV1(m)) {
    const api = (m as IslandModuleLike | null)?.ISLAND_API;
    const version = (m as IslandModuleLike | null)?.ISLAND_API_VERSION;
    return { ok: false, failure: 'ISLAND_VERSION_MISMATCH', detail: `${String(api)} v${String(version)}` };
  }
  const build = typeof m.ISLAND_BUILD === 'string' ? m.ISLAND_BUILD : null;
  return { ok: true, module: m, build };
}

/** The launch the route carries (the worklist's Read click, phase 2), when valid. */
const ATTEMPT = /^[A-Za-z0-9._:-]{1,128}$/;
export function launchFromQuery(search: string): IslandLaunch | undefined {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch (_) {
    return undefined;
  }
  const attempt = q.get('attempt');
  const t0 = q.get('attemptT0');
  if (!attempt || !ATTEMPT.test(attempt) || !t0 || !/^\d{1,15}$/.test(t0)) {
    return undefined;
  }
  const attemptT0 = Number(t0);
  return Number.isSafeInteger(attemptT0) && attemptT0 > 0 ? { attempt, attemptT0 } : undefined;
}

/** The study a radcopilot route names: its first StudyInstanceUIDs, as the island accepts one. */
const STUDY_UID = /^[0-9]+(\.[0-9]+)*$/;
export function routeStudyOf(search: string): string | null {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch (_) {
    return null;
  }
  const first = (q.get('StudyInstanceUIDs') ?? q.get('studyInstanceUIDs') ?? '').split(',')[0]?.trim() ?? '';
  return first.length >= 1 && first.length <= 64 && STUDY_UID.test(first) ? first : null;
}
