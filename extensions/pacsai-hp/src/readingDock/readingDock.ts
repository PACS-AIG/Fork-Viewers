/**
 * Rev 11 milestone 6, approach C, phase 1: the reading dock. The radcopilot
 * mode's report column, divider and cover, and the one editor island mounted
 * in the column, all kept OUTSIDE OHIF's React tree: OHIF rebuilds its layout
 * on every route entry (Mode.tsx), and a case switch or a side-panel collapse
 * must never remount the report.
 *
 *   - The island mounts on the first route entry, whether or not images load
 *     (the report talks to the app, never to the viewer's data source).
 *   - An in-document study switch is `setCase`; a cover holds over the report
 *     until the island says it is ready on the route's study.
 *   - Images mode is `setVisibility(false)`, refused (or held as Both) until
 *     the report has told its microphone state, so a hidden report never
 *     dictates unseen with no indicator. The images under the report in Report
 *     mode are parked (installParkedSuspend listens through `onParkedChange`).
 *   - F4 is the microphone key (WeiWei, 17 Oct): on the whole page and in
 *     every mode it toggles the report's recognizer, as the header's
 *     microphone toggle does; a held F4 toggles once.
 *   - Leaving the mode takes the report off the screen at once (its
 *     recognizer stopped, the images unparked), settles it, then unmounts it.
 *     The viewer's error routes (a study not found) keep it, alone, and while
 *     a report is open the page asks before it unloads.
 *
 * The layout comes from dockModel.ts (the app's rules); the island from
 * islandLoader.ts. The header's controls (ReadingControls.tsx) read the state
 * through `subscribe`/`getSnapshot`; the harness through the read-only
 * `window.__pacsaiReading`, which names studies by reference, never by UID.
 */
import { studyRefFor } from '@ohif/core/src/utils/attempt/attemptTrace';
import {
  DEFAULT_REPORT_RATIO,
  DEFAULT_WORKSPACE_MODE,
  keyboardReportRatio,
  ratioFromPointer,
  reportPercent,
  splitBounds,
  type PaneRole,
  type WorkspaceMode,
} from './readingLayout';
import {
  IMAGES_GONE_LINE_PX,
  READING_MODES,
  afterShown,
  dockView,
  isDictationState,
  isMicKey,
  noticeText,
  type DictationState,
  type DockView,
  type NoticeLevel,
} from './dockModel';
import {
  handleSpeaksV1,
  type IslandHandleLike,
  type IslandLaunch,
  type IslandLoadFailure,
  type IslandLoadResult,
} from './islandLoader';

/** Above the viewer's layout and its viewport overlays, below its dialogs and menus (z-50). */
export const DOCK_Z_INDEX = 40;
/** The CSS width the radcopilot layout gives OHIF's images area (ViewerLayout `contentWidth`). */
export const IMAGES_WIDTH_VAR = '--pacsai-reading-images-width';
export const SETTLE_BEFORE_UNMOUNT_MS = 10_000;
const SET_CASE_RETRY_MS = 200;
const SUBMITTING_RETRY_MS = 1000;
const MAX_NOTICES = 5;

export type DockPhase = 'loading' | 'mounted' | 'failed' | 'gone';
export type ParkedState = 'visible' | 'parked';

export interface DockNotice {
  code: string;
  level: NoticeLevel;
  text: string;
}

/** What the header's controls and the harness read. Studies as refs only. */
export interface ReadingDockSnapshot {
  phase: DockPhase;
  failure: IslandLoadFailure | null;
  failureDetail: string | null;
  build: string | null;
  routeStudyRef: string;
  islandCase: { studyRef: string; generation: number; state: string } | null;
  covered: boolean;
  coverText: string | null;
  requested: WorkspaceMode;
  mode: WorkspaceMode;
  fits: boolean;
  imagesHeld: boolean;
  reportPercent: number;
  viewerShown: boolean;
  dictation: DictationState | null;
  /** Shown while the report is hidden; cleared once the reader sees the report. */
  notices: DockNotice[];
  signed: boolean;
  counts: { mounts: number; unmounts: number; setCases: number; refusedImages: number; settles: number; micKeys: number };
}

export interface ReadingDockDeps {
  win: Window;
  load: () => Promise<IslandLoadResult>;
  /** True for a path of the radcopilot route (with or without a data source segment). */
  isReadingPath: (pathname: string) => boolean;
  /** True for the viewer's error routes, where the report stays on its own. */
  isErrorPath: (pathname: string) => boolean;
  /** The app's own sign-in pop-up (/auth/popup), when the flags say there is no app session. */
  openAppSignIn?: () => Window | null;
}

export interface ReadingDock {
  /** A route entry for this study (onModeInit and onModeEnter call it; idempotent). */
  enter: (studyInstanceUid: string | null, launch?: IslandLaunch) => void;
  /** The mode's run ended (onModeExit): a case switch, an error route, or leaving the mode. */
  routeLeft: () => void;
  /** Refused (false) for Images while the report's microphone state is unknown. */
  setMode: (mode: WorkspaceMode) => boolean;
  setReportRatio: (ratio: number) => void;
  /** The header's toggle: start or stop the report's recognizer. */
  toggleDictation: () => boolean;
  /** The caret back to the report (after a viewer control). */
  focusReport: () => boolean;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ReadingDockSnapshot;
  isGone: () => boolean;
  /** Leave now: settle, unmount, take the dock away. */
  destroy: () => Promise<void>;
}

// ---- the parked state, relayed across docks ----------------------------------
// installParkedSuspend is installed once per document, and a dock is made again
// after a leave; this relay is the one subscription it holds.
const parkedListeners = new Set<(state: ParkedState) => void>();
let parkedNow: ParkedState = 'visible';
function publishParked(state: ParkedState): void {
  if (state === parkedNow) {
    return;
  }
  parkedNow = state;
  parkedListeners.forEach(listener => listener(state));
}
/** For installParkedSuspend: told 'parked' at once when parked, then every change. */
export function onParkedChange(listener: (state: ParkedState) => void): () => void {
  parkedListeners.add(listener);
  if (parkedNow === 'parked') {
    listener('parked');
  }
  return () => parkedListeners.delete(listener);
}

const MODE_BY_CODE: Record<string, WorkspaceMode> = { Digit1: 'images', Digit2: 'both', Digit3: 'report' };

const COVER_LOADING = 'Opening the report…';
const COVER_SWITCHING = 'Opening the report for this study…';
const COVER_SUBMITTING = 'Finishing the signature on the previous case…';

const FAILURE_TEXT: Record<IslandLoadFailure, string> = {
  APP_SIGNED_OUT: 'Sign in to PACS AI to open the report here.',
  FLAGS_UNREADABLE: 'The report could not be opened here: PACS AI did not answer.',
  VIEWER_HOST_OFF: 'The report is not offered in the viewer on this server. Open it from the worklist.',
  ISLAND_LOAD_FAILED: 'The report could not be loaded here. Open it from the worklist.',
  ISLAND_VERSION_MISMATCH: 'This viewer and PACS AI disagree on the report version. Open the report from the worklist.',
};

export function createReadingDock(deps: ReadingDockDeps): ReadingDock {
  const { win } = deps;
  const doc = win.document;
  const root = doc.documentElement;

  // ---- state ------------------------------------------------------------------
  let phase: DockPhase = 'loading';
  let failure: IslandLoadFailure | null = null;
  let failureDetail: string | null = null;
  let build: string | null = null;
  let handle: IslandHandleLike | null = null;
  let routeStudy: string | null = null;
  let routeLaunch: IslandLaunch | undefined;
  /** The study the island was last asked to show. */
  let islandStudy: string | null = null;
  /** The case the island must say is ready before the cover drops (null generation: its first). */
  let expected: { study: string; generation: number | null } | null = null;
  let islandCase: { study: string; generation: number; state: string } | null = null;
  let submittingWait = false;
  let requested: WorkspaceMode = DEFAULT_WORKSPACE_MODE;
  let reportRatio = DEFAULT_REPORT_RATIO;
  let fallback: PaneRole | null = null;
  let shown = { wasSplit: true, lastVisibleImagesPx: null as number | null };
  let viewerShown = true;
  let dictation: DictationState | null = null;
  let notices: DockNotice[] = [];
  let signed = false;
  let islandVisible = true;
  let started = false;
  let gone = false;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Watches the app's sign-in pop-up until it closes; ends with the dock. */
  let signInPoll: ReturnType<typeof setInterval> | null = null;
  const counts = { mounts: 0, unmounts: 0, setCases: 0, refusedImages: 0, settles: 0, micKeys: 0 };
  let view: DockView | null = null;
  let snapshot: ReadingDockSnapshot;
  const listeners = new Set<() => void>();

  // ---- the nodes (outside OHIF's React root) -----------------------------------
  const column = doc.createElement('section');
  column.setAttribute('data-pacsai-reading-column', '');
  column.setAttribute('aria-label', 'Report');
  Object.assign(column.style, {
    position: 'fixed',
    zIndex: String(DOCK_Z_INDEX),
    boxSizing: 'border-box',
    overflow: 'hidden',
    background: '#050B14',
  });
  const islandElement = doc.createElement('div');
  islandElement.setAttribute('data-pacsai-reading-island', '');
  Object.assign(islandElement.style, { position: 'absolute', inset: '0' });
  const cover = doc.createElement('div');
  cover.setAttribute('data-pacsai-reading-cover', '');
  cover.setAttribute('role', 'status');
  cover.setAttribute('aria-live', 'polite');
  Object.assign(cover.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '1',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    textAlign: 'center',
    background: '#0D1218',
    color: '#E8EEF5',
    font: '14px/20px system-ui, -apple-system, "Segoe UI", sans-serif',
  });
  const coverText = doc.createElement('div');
  coverText.setAttribute('data-pacsai-reading-cover-text', '');
  const coverAction = doc.createElement('button');
  coverAction.type = 'button';
  coverAction.setAttribute('data-pacsai-reading-cover-action', '');
  coverAction.hidden = true;
  Object.assign(coverAction.style, {
    padding: '6px 14px',
    borderRadius: '6px',
    border: '1px solid #8AB4F8',
    background: 'transparent',
    color: '#8AB4F8',
    cursor: 'pointer',
    font: 'inherit',
  });
  cover.append(coverText, coverAction);
  column.append(islandElement, cover);

  const divider = doc.createElement('div');
  divider.setAttribute('data-pacsai-reading-divider', '');
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-label', 'Report width');
  divider.tabIndex = 0;
  Object.assign(divider.style, {
    position: 'fixed',
    zIndex: String(DOCK_Z_INDEX),
    cursor: 'col-resize',
    background: '#1B2735',
    touchAction: 'none',
  });

  const goneLine = doc.createElement('div');
  goneLine.setAttribute('data-pacsai-reading-images-gone', '');
  goneLine.setAttribute('role', 'status');
  goneLine.textContent = 'The images for this study could not be shown. The report stays open.';
  Object.assign(goneLine.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    top: '0',
    height: `${IMAGES_GONE_LINE_PX}px`,
    zIndex: String(DOCK_Z_INDEX),
    display: 'none',
    alignItems: 'center',
    padding: '0 12px',
    background: '#2E2413',
    color: '#F5C36B',
    font: '13px/18px system-ui, -apple-system, "Segoe UI", sans-serif',
  });

  // ---- reading the state --------------------------------------------------------
  const widthNow = () => root.clientWidth || win.innerWidth;
  const heightNow = () => root.clientHeight || win.innerHeight;
  const dictationKnown = () => phase !== 'mounted' || dictation !== null;
  const covered = () => {
    if (phase !== 'mounted') {
      return true;
    }
    if (!routeStudy || islandStudy !== routeStudy || !expected || expected.study !== routeStudy) {
      return true;
    }
    if (!islandCase || islandCase.study !== routeStudy) {
      return true;
    }
    return expected.generation !== null && islandCase.generation !== expected.generation;
  };
  const coverLine = (): string | null => {
    if (phase === 'failed') {
      return FAILURE_TEXT[failure as IslandLoadFailure] ?? FAILURE_TEXT.ISLAND_LOAD_FAILED;
    }
    if (!covered()) {
      return null;
    }
    if (phase === 'loading' || counts.setCases === 0) {
      return COVER_LOADING;
    }
    return submittingWait ? COVER_SUBMITTING : COVER_SWITCHING;
  };

  const buildSnapshot = (): ReadingDockSnapshot => ({
    phase,
    failure,
    failureDetail,
    build,
    routeStudyRef: studyRefFor(routeStudy),
    islandCase: islandCase
      ? { studyRef: studyRefFor(islandCase.study), generation: islandCase.generation, state: islandCase.state }
      : null,
    covered: covered(),
    coverText: coverLine(),
    requested,
    mode: view?.mode ?? requested,
    fits: view?.layout.fits ?? true,
    imagesHeld: view?.imagesHeld ?? false,
    reportPercent: reportPercent(reportRatio),
    viewerShown,
    dictation: dictation ? { ...dictation } : null,
    notices: notices.map(n => ({ ...n })),
    signed,
    counts: { ...counts },
  });

  const notify = () => {
    snapshot = buildSnapshot();
    listeners.forEach(listener => listener());
  };

  // ---- applying it -----------------------------------------------------------------
  const place = (el: HTMLElement, r: { left: number; top: number; width: number; height: number }) => {
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  };

  const apply = () => {
    if (gone) {
      return;
    }
    const width = widthNow();
    view = dockView({
      requested,
      reportRatio,
      widthPx: width,
      heightPx: heightNow(),
      wasSplit: shown.wasSplit,
      fallback,
      dictationKnown: dictationKnown(),
      viewerShown,
      lastVisibleImagesPx: shown.lastVisibleImagesPx,
    });
    shown = afterShown(view, shown);
    root.style.setProperty(IMAGES_WIDTH_VAR, `${view.imagesWidthPx}px`);

    place(column, view.column);
    (column as HTMLElement & { inert: boolean }).inert = !view.column.shown;
    column.setAttribute('aria-hidden', String(!view.column.shown));

    if (view.divider.shown) {
      divider.hidden = false;
      place(divider, view.divider);
      const bounds = splitBounds(width);
      divider.setAttribute('aria-valuenow', String(reportPercent(view.layout.reportRatio)));
      divider.setAttribute('aria-valuemin', String(bounds ? Math.round(bounds.min * 100) : 0));
      divider.setAttribute('aria-valuemax', String(bounds ? Math.round(bounds.max * 100) : 100));
      divider.setAttribute('aria-valuetext', `Report ${reportPercent(view.layout.reportRatio)} %`);
    } else {
      divider.hidden = true;
    }
    // (style.display, not `hidden`: an inline display wins over the attribute)
    goneLine.style.display = viewerShown ? 'none' : 'flex';

    const line = coverLine();
    cover.style.display = line === null ? 'none' : 'flex';
    coverText.textContent = line ?? '';
    coverAction.hidden = !(phase === 'failed' && failure === 'APP_SIGNED_OUT' && deps.openAppSignIn);
    coverAction.textContent = 'Sign in';

    if (handle && islandVisible !== view.column.shown) {
      islandVisible = view.column.shown;
      handle.setVisibility(islandVisible);
    }
    // Notices are for a hidden report: once it shows, the reader sees its own lines.
    if (view.column.shown && notices.length) {
      notices = [];
    }
    publishParked(view.parked ? 'parked' : 'visible');
    notify();
  };

  // ---- the island --------------------------------------------------------------------
  const onReady = (settled: unknown) => {
    const s = settled as { studyInstanceUid?: unknown; generation?: unknown; state?: unknown } | null;
    if (!s || typeof s.studyInstanceUid !== 'string' || typeof s.generation !== 'number') {
      return;
    }
    islandCase = { study: s.studyInstanceUid, generation: s.generation, state: String(s.state) };
    if (expected && expected.generation === null && expected.study === s.studyInstanceUid) {
      expected = { study: expected.study, generation: s.generation };
    }
    apply();
  };
  const onSigned = (signal: unknown) => {
    const s = signal as { studyInstanceUid?: unknown } | null;
    if (s && s.studyInstanceUid === islandStudy) {
      signed = true;
    }
    if (submittingWait) {
      requestCase();
    }
    apply();
  };
  const onDictation = (status: unknown) => {
    dictation = isDictationState(status)
      ? { started: status.started, busy: status.busy, available: status.available, pending: status.pending }
      : null;
    apply();
  };
  const addNotice = (code: string, level: NoticeLevel) => {
    notices = [...notices.filter(n => n.code !== code), { code, level, text: noticeText(code) }].slice(-MAX_NOTICES);
  };
  const onNotice = (notice: unknown) => {
    const n = notice as { code?: unknown; level?: unknown } | null;
    if (!n || typeof n.code !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(n.code)) {
      return;
    }
    if (view && view.column.shown) {
      return; // the report is on screen and shows its own line
    }
    addNotice(n.code, n.level === 'error' ? 'error' : 'warning');
    notify();
  };
  const onAuthRequired = () => onNotice({ code: 'AUTH_REQUIRED', level: 'warning' });

  const requestCase = () => {
    if (retryTimer) {
      win.clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (!handle || gone || !routeStudy) {
      return;
    }
    const study = routeStudy;
    const answer = handle.setCase(study, routeLaunch);
    counts.setCases++;
    if (answer.ok) {
      submittingWait = false;
      if (!answer.sameCase) {
        islandStudy = study;
        expected = { study, generation: answer.generation };
        islandCase = null;
        signed = false;
        notices = [];
      }
      apply();
      return;
    }
    if (answer.reason === 'not-ready') {
      retryTimer = win.setTimeout(requestCase, SET_CASE_RETRY_MS);
    } else if (answer.reason === 'submitting') {
      submittingWait = true;
      retryTimer = win.setTimeout(requestCase, SUBMITTING_RETRY_MS);
    } else {
      phase = 'failed';
      failure = 'ISLAND_LOAD_FAILED';
      failureDetail = `setCase: ${answer.reason}`;
    }
    apply();
  };

  const start = async () => {
    started = true;
    // The divider before the column: the Tab order follows the screen (images, divider, report).
    doc.body.append(divider, column, goneLine);
    apply();
    let result: IslandLoadResult;
    try {
      result = await deps.load();
    } catch (e) {
      result = { ok: false, failure: 'ISLAND_LOAD_FAILED', detail: String((e as Error)?.message ?? e).slice(0, 120) };
    }
    if (gone) {
      return;
    }
    if (result.ok === false) {
      phase = 'failed';
      failure = result.failure;
      failureDetail = result.detail ?? null;
      apply();
      return;
    }
    build = result.build;
    const study = routeStudy;
    let h: unknown;
    try {
      h = result.module.mountReportEditor(islandElement, {
        studyInstanceUid: study,
        ...(routeLaunch ? { launch: routeLaunch } : {}),
        paneLayout: true,
        onReady,
        onSigned,
        onDictation,
        onNotice,
        onAuthRequired,
      });
    } catch (e) {
      phase = 'failed';
      failure = 'ISLAND_LOAD_FAILED';
      failureDetail = String((e as Error)?.message ?? e).slice(0, 120);
      apply();
      return;
    }
    if (!handleSpeaksV1(h)) {
      try {
        (h as { unmount?: () => void } | null)?.unmount?.();
      } catch (_) {
        /* not ours to mend */
      }
      phase = 'failed';
      failure = 'ISLAND_VERSION_MISMATCH';
      failureDetail = 'the handle does not name pacsai.reportIsland v1';
      apply();
      return;
    }
    handle = h;
    counts.mounts++;
    phase = 'mounted';
    islandStudy = study;
    expected = study ? { study, generation: null } : null;
    islandVisible = true;
    apply();
    // The route moved on while the module loaded.
    if (routeStudy !== islandStudy) {
      requestCase();
    }
  };

  // ---- the reader's controls ----------------------------------------------------------
  const focusReport = (): boolean => {
    if (!handle || !view || !view.column.shown) {
      return false;
    }
    try {
      return handle.setFocus();
    } catch (_) {
      return false;
    }
  };
  const setMode = (mode: WorkspaceMode): boolean => {
    if (gone || !READING_MODES.some(m => m.value === mode)) {
      return false;
    }
    if (mode === 'images' && !dictationKnown()) {
      counts.refusedImages++;
      notify();
      return false;
    }
    requested = mode;
    if (mode !== 'both') {
      fallback = mode;
    }
    apply();
    if (mode !== 'images') {
      focusReport();
    }
    return true;
  };
  const setReportRatio = (ratio: number) => {
    if (gone || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
      return;
    }
    reportRatio = ratio;
    apply();
  };
  const toggleDictation = (): boolean => {
    if (!handle || typeof handle.toggleDictation !== 'function') {
      return false;
    }
    try {
      return handle.toggleDictation() !== false;
    } catch (_) {
      return false;
    }
  };

  // ---- the divider --------------------------------------------------------------------
  let dragging: number | null = null;
  divider.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    dragging = e.pointerId;
    try {
      divider.setPointerCapture(e.pointerId);
    } catch (_) {
      /* capture is a nicety */
    }
  });
  divider.addEventListener('pointermove', (e: PointerEvent) => {
    if (dragging !== e.pointerId) {
      return;
    }
    const r = ratioFromPointer(e.clientX, widthNow());
    if (r !== null) {
      setReportRatio(r);
    }
  });
  const endDrag = (e: PointerEvent) => {
    if (dragging !== e.pointerId) {
      return;
    }
    dragging = null;
    focusReport();
  };
  divider.addEventListener('pointerup', endDrag);
  divider.addEventListener('pointercancel', endDrag);
  divider.addEventListener('keydown', (e: KeyboardEvent) => {
    const r = keyboardReportRatio(e.key, reportRatio, widthNow());
    if (r === null) {
      return;
    }
    // The viewer's page-wide hotkeys bind arrows too.
    e.preventDefault();
    e.stopPropagation();
    setReportRatio(r);
  });
  const stopSignInPoll = () => {
    if (signInPoll) {
      win.clearInterval(signInPoll);
      signInPoll = null;
    }
  };
  coverAction.addEventListener('click', () => {
    const popup = deps.openAppSignIn?.();
    if (!popup) {
      return;
    }
    // One poll, for the newest pop-up (the same named window on a second click).
    stopSignInPoll();
    signInPoll = win.setInterval(() => {
      if (!popup.closed) {
        return;
      }
      stopSignInPoll();
      if (!gone && phase === 'failed' && failure === 'APP_SIGNED_OUT') {
        phase = 'loading';
        failure = null;
        void retryLoad();
      }
    }, 500);
  });
  const retryLoad = async () => {
    column.remove();
    divider.remove();
    goneLine.remove();
    await start();
  };

  // ---- page-wide listeners ---------------------------------------------------------------
  const onResize = () => apply();
  // Alt+1/2/3 from inside the report: the island stops its keys before the
  // viewer's hotkeys see them, so the mode keys are relayed from here. Outside
  // the report the viewer's own hotkeys (radcopilot's) run them.
  const inReport = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (column.contains(target) ||
      !!(target as Element).closest?.('[data-pacs-island-portal-host]') ||
      !!(target.parentElement?.closest?.('[data-pacs-island-portal-host]')));
  const onKeyDown = (e: KeyboardEvent) => {
    // The microphone key (F4) on the whole page and in every mode, as the
    // header's microphone toggle; a held key toggles once.
    if (isMicKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) {
        counts.micKeys++;
        toggleDictation();
        notify();
      }
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !inReport(e.target)) {
      return;
    }
    const mode = MODE_BY_CODE[e.code];
    if (!mode) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setMode(mode);
  };
  // While a report is open the page asks before it goes (a reload, a sign-in
  // redirect, the window closing). The island's own pagehide saves its draft.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (phase !== 'mounted' || signed || islandCase?.state !== 'reportable') {
      return;
    }
    e.preventDefault();
    e.returnValue = '';
  };
  win.addEventListener('resize', onResize);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('beforeunload', onBeforeUnload);

  // ---- the route ------------------------------------------------------------------------
  const enter = (studyInstanceUid: string | null, launch?: IslandLaunch) => {
    if (gone) {
      return;
    }
    if (leaveTimer) {
      win.clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    const wasHidden = !viewerShown;
    viewerShown = true;
    const changed = studyInstanceUid !== routeStudy;
    if (changed) {
      routeStudy = studyInstanceUid;
      routeLaunch = launch;
    }
    if (!started) {
      void start();
      return;
    }
    if (changed && phase === 'mounted') {
      requestCase();
      return;
    }
    if (changed || wasHidden) {
      apply();
    }
  };

  /**
   * The start of a leave: the next route is on screen already, so nothing of
   * the report stays on it while the report settles (up to 10 s). The column
   * parks off the window at its size, inert, as in Images; the divider and the
   * images-gone line go; the images area loses its width rule; nothing is held
   * parked (the next mode's images render at once).
   */
  const leaveScreen = () => {
    column.style.left = `${widthNow()}px`;
    (column as HTMLElement & { inert: boolean }).inert = true;
    column.setAttribute('aria-hidden', 'true');
    divider.hidden = true;
    goneLine.style.display = 'none';
    root.style.removeProperty(IMAGES_WIDTH_VAR);
    publishParked('visible');
  };

  const destroy = async () => {
    if (gone) {
      return;
    }
    gone = true;
    phase = 'gone';
    if (retryTimer) {
      win.clearTimeout(retryTimer);
    }
    if (leaveTimer) {
      win.clearTimeout(leaveTimer);
    }
    stopSignInPoll();
    win.removeEventListener('resize', onResize);
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('beforeunload', onBeforeUnload);
    leaveScreen();
    const h = handle;
    handle = null;
    if (h) {
      // A hidden report takes no more words: its recognizer stops first, by
      // the footer's own toggle, when the report says it is running (between
      // states, the unmount below stops it). Then its popups go too.
      if (dictation?.started && !dictation.busy) {
        try {
          h.toggleDictation?.();
        } catch (_) {
          /* the unmount stops it */
        }
      }
      try {
        h.setVisibility(false);
      } catch (_) {
        /* the column is off the window already */
      }
      counts.settles++;
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          h.settle(),
          new Promise(resolve => {
            timer = win.setTimeout(resolve, SETTLE_BEFORE_UNMOUNT_MS);
          }),
        ]);
      } catch (_) {
        /* unmount sends the draft with keepalive anyway */
      } finally {
        if (timer) {
          win.clearTimeout(timer);
        }
      }
      try {
        h.unmount();
      } catch (_) {
        /* the page is going on without it */
      }
      counts.unmounts++;
    }
    column.remove();
    divider.remove();
    goneLine.remove();
    notify();
  };

  const routeLeft = () => {
    if (gone) {
      return;
    }
    if (leaveTimer) {
      win.clearTimeout(leaveTimer);
    }
    // After the router has moved: a case switch stays on the route (the next
    // entry follows), an error route keeps the report, anything else leaves.
    leaveTimer = win.setTimeout(() => {
      leaveTimer = null;
      const path = win.location.pathname;
      if (deps.isReadingPath(path)) {
        return;
      }
      if (deps.isErrorPath(path)) {
        viewerShown = false;
        apply();
        return;
      }
      void destroy();
    }, 0);
  };

  snapshot = buildSnapshot();
  return {
    enter,
    routeLeft,
    setMode,
    setReportRatio,
    toggleDictation,
    focusReport,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    isGone: () => gone,
    destroy,
  };
}

// ---- the route's paths ---------------------------------------------------------------------
/** radcopilot's route: …/radcopilot, or …/radcopilot/<data source>. */
export function isReadingPath(pathname: string): boolean {
  const segments = String(pathname).split('/').filter(Boolean);
  const i = segments.lastIndexOf('radcopilot');
  return i >= 0 && segments.length - i <= 2;
}
/** The viewer's error routes (a study or server not found). */
export function isErrorPath(pathname: string): boolean {
  const segments = String(pathname).split('/').filter(Boolean);
  return /^notfound/i.test(segments[segments.length - 1] ?? '');
}
