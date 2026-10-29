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
 *   - Phase 2 (the worklist's reading window): the dock answers the worklist
 *     that opened this window (readingChannel.ts). It advertises that it can
 *     open the next case in this page; a Read is then the viewer's
 *     in-document study switch, or, for a study on another gateway or a 13th
 *     case, a planned reload once the report is settled (no leave prompt);
 *     after Sign it relays `closeWindow`, so the worklist closes the window.
 *   - F55 (28 Oct 2026): with the report hidden (Images), one strip under the
 *     images, never over them (the images area gives it its height): Case
 *     linked, the report's case by accession and exam, the last sentence
 *     placed, the one thing to settle first, and Sign through the island (D5;
 *     Review and Show report bring the report back, as Both); after Sign, the
 *     island's offer of the next case. A spoken mode ("show images") is the
 *     island's `onModeRequest`, under setMode's own rules.
 *   - F72 (28 Oct 2026): where the island offers the next case after Sign
 *     (its line, Open / Skip; the island says so in `onSigned`), the window
 *     stays open and nothing is relayed. Open is the island's `onOpenCase`:
 *     the worklist is told first (`workspaceNextCase`, so the case this
 *     window shows stays the worklist's to know), then the case opens as a
 *     worklist Read would here. The offer's Worklist is the relay after Sign.
 *   - Phase 2 (PR 4): the dock tells the island what the viewer shows (the
 *     route's study and the viewer's own signed-in user) at the mount, after
 *     each route entry and when the window comes back to the front; the
 *     island holds its microphone and Sign while either disagrees with its
 *     case (its identity gate).
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
import {
  OPEN_CASE_ACTION,
  buildAdvert,
  buildCloseWindow,
  buildNextCase,
  caseOpenedAnswer,
  decideReadingCommand,
  isCaseGatewayAet,
  isCaseStudyUid,
  isChannelLaunch,
  mintDocumentId,
  readingRouteFor,
  screenCaseCommand,
  type OpenCaseCommand,
} from './readingChannel';
import {
  IMAGES_BOTTOM_VAR,
  STRIP_HEIGHT_PX,
  readStripState,
  stripSnapshot,
  stripView,
  type StripState,
} from './readingStrip';
export { IMAGES_BOTTOM_VAR } from './readingStrip';

/** Above the viewer's layout and its viewport overlays, below its dialogs and menus (z-50). */
export const DOCK_Z_INDEX = 40;
/** The CSS width the radcopilot layout gives OHIF's images area (ViewerLayout `contentWidth`). */
export const IMAGES_WIDTH_VAR = '--pacsai-reading-images-width';
export const SETTLE_BEFORE_UNMOUNT_MS = 10_000;
/** A planned reload waits this long at most for a Submit in flight (the island's own Submit wait). */
export const SUBMIT_BEFORE_RELOAD_MS = 15_000;
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
  /** 22 Oct: the window cannot hold Images + Report (the narrow ladder's one
   *  pane, whatever was asked; 200 % zoom among them). The header's
   *  microphone keeps its toggle and notices then, its line in the toggle's title. */
  narrow: boolean;
  imagesHeld: boolean;
  reportPercent: number;
  viewerShown: boolean;
  dictation: DictationState | null;
  /** Shown while the report is hidden; cleared once the reader sees the report. */
  notices: DockNotice[];
  signed: boolean;
  /** F55: the Images strip (no report text, no study: readingStrip.ts stripSnapshot). */
  strip: ReturnType<typeof stripSnapshot>;
  stripCounts: {
    signs: number;
    reviews: number;
    shows: number;
    lineActions: number;
    modeRequests: number;
  };
  /** F56: layouts the island showed (and refused), and the reader's choices told to it. */
  layoutCounts: { restores: number; refusedRestores: number; told: number };
  counts: { mounts: number; unmounts: number; setCases: number; refusedImages: number; settles: number; micKeys: number };
  /** Phase 2 (PR 3): "Report without images" opened from the cover. */
  reportOnlyOpens: number;
  /** Phase 2 (PR 4): what the island was last told the viewer shows (a study ref, whether a user is known). */
  identity: { studyRef: string; user: boolean; told: number } | null;
  /** Phase 2: the channel to the worklist that opened this window (no study UIDs). */
  channel: {
    documentId: string;
    /** A worklist this page may talk to opened it. */
    opener: boolean;
    casesInDocument: number;
    /** 'settling' while the report settles before a planned reload; 'go' once it loads. */
    plannedReload: 'no' | 'settling' | 'go';
    adverts: number;
    answers: { switched: number; focusOnly: number; reloads: number; refused: number };
    ignored: Record<string, number>;
    relays: number;
    /** F72: the next-case offer after Sign: cases signed with the offer up,
     *  its Opens taken, refused, and its Worklist relays. */
    offers: { signed: number; opens: number; refused: number; backs: number };
  };
}

/** Phase 2: what the dock needs to answer the worklist that opened its window. */
export interface ReadingChannelDeps {
  /** That worklist's window, when this page may talk to it (open, this origin); else null. */
  opener: () => Window | null;
  ownOrigin: string;
  /** The gateways this document's data sources were built for (its URL's, at its start). */
  documentGateways: () => readonly string[];
  /** The route this document was opened on (its path), for every case it shows. */
  openedPath: string | null;
  /** The viewer's in-document study switch to this address. */
  switchTo: (href: string) => void;
  /** A planned reload: this window loads this address. */
  loadNew: (href: string) => void;
  mintId?: () => string;
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
  /** Phase 2: the channel to the worklist that opened this window (none: no channel). */
  channel?: ReadingChannelDeps;
  /** Phase 2 (PR 3): "Report without images": the app's report-only page for this case. */
  openReportOnly?: (studyInstanceUid: string, launch?: IslandLaunch) => Window | null;
  /** Phase 2 (PR 4): the viewer's own signed-in user (its OpenID subject), or null. */
  viewerUser?: () => string | null;
  /**
   * 21 Oct: whether the viewer's user is the app's (the reading window signed in
   * with the app's sign-in; the platform's utils/appSignIn), not its own.
   */
  viewerUserIsApp?: () => boolean;
  /** 21 Oct: the app's sign-out (./appSignOut); true once it answered. */
  signOutOfApp?: () => Promise<boolean>;
  /**
   * 21 Oct: after Logout. Signed out: the window closes, else the app's sign-in
   * page; not signed out (no answer): the app's own sign-out page, which asks.
   */
  leaveAfterSignOut?: (signedOut: boolean) => void;
}

/** F56: whose a change of layout is: the reader's (remembered) or the dock's and report's own (not). */
export type LayoutBy = 'reader' | 'system';

/** 18 Oct 2026: an item the dock offers the viewer's gear menu (radcopilot passes them to OHIF's header). */
export interface ReadingMenuOption {
  title: string;
  icon: string;
  onClick: () => void;
}

export interface ReadingDock {
  /** A route entry for this study (onModeInit and onModeEnter call it; idempotent). */
  enter: (studyInstanceUid: string | null, launch?: IslandLaunch) => void;
  /** The mode's run ended (onModeExit): a case switch, an error route, or leaving the mode. */
  routeLeft: () => void;
  /** Refused (false) for Images while the report's microphone state is unknown.
   *  F56: `by` 'reader' (the default: the header's control, the mode keys) is
   *  told to the island, which remembers it; 'system' is not. */
  setMode: (mode: WorkspaceMode, by?: LayoutBy) => boolean;
  setReportRatio: (ratio: number) => void;
  /** The header's toggle: start or stop the report's recognizer. */
  toggleDictation: () => boolean;
  /** The caret back to the report (after a viewer control). */
  focusReport: () => boolean;
  /** The viewer's gear menu: the report's settings and its quiet_workspace
   *  switch, once the report is up and only as far as the island has them. */
  menuOptions: () => ReadingMenuOption[];
  /**
   * 21 Oct: the viewer's Logout, taken (true) when the viewer holds the app's
   * sign-in: the report settles (its draft saved while the session still takes
   * it), the app signs out (which ends the Keycloak session too), and the window
   * leaves. False when the viewer's user is its own: OHIF's /logout, as before.
   */
  logout: () => boolean;
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
const COVER_RELOADING = 'Saving the report, then opening the next case…';

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
  // Phase 2: the channel to the worklist that opened this window.
  const channel = deps.channel ?? null;
  let documentId = '';
  try {
    documentId = (channel?.mintId ?? mintDocumentId)();
  } catch (_) {
    documentId = '';
  }
  let casesInDocument = 1;
  let plannedReload: 'no' | 'settling' | 'go' = 'no';
  let reportOnlyOpens = 0;
  // Phase 2 (PR 4): what the island was last told the viewer shows.
  let toldIdentity: { study: string | null; user: string | null } | null = null;
  let identityTold = 0;
  const channelCounts = {
    adverts: 0,
    answers: { switched: 0, focusOnly: 0, reloads: 0, refused: 0 },
    ignored: {} as Record<string, number>,
    relays: 0,
    offers: { signed: 0, opens: 0, refused: 0, backs: 0 },
  };
  // F55: the Images strip, as the island last told it, and whether it shows.
  let strip: StripState | null = null;
  let stripShown = false;
  const stripCounts = { signs: 0, reviews: 0, shows: 0, lineActions: 0, modeRequests: 0 };
  const layoutCounts = { restores: 0, refusedRestores: 0, told: 0 };
  /** F56: the reader chose a layout since this case opened, so the layout the
   *  island remembered for the case no longer replaces it. */
  let readerChoseThisCase = false;
  /** F56: that choice has not reached the island yet (it was not up). */
  let choiceUntold = false;
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
  // Phase 2 (PR 3): when the report cannot be shown here, the report-only page.
  const coverReportOnly = doc.createElement('button');
  coverReportOnly.type = 'button';
  coverReportOnly.setAttribute('data-pacsai-reading-report-only', '');
  coverReportOnly.hidden = true;
  coverReportOnly.textContent = 'Report without images';
  Object.assign(coverReportOnly.style, {
    padding: '6px 14px',
    borderRadius: '6px',
    border: '1px solid #8AB4F8',
    background: 'transparent',
    color: '#8AB4F8',
    cursor: 'pointer',
    font: 'inherit',
  });
  cover.append(coverText, coverAction, coverReportOnly);
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

  // F55: the Images strip, under the images (the images area gives it its height).
  const stripEl = doc.createElement('div');
  stripEl.setAttribute('data-pacsai-reading-strip', '');
  stripEl.setAttribute('role', 'region');
  stripEl.setAttribute('aria-label', 'Report status');
  Object.assign(stripEl.style, {
    position: 'fixed',
    left: '0',
    bottom: '0',
    height: `${STRIP_HEIGHT_PX}px`,
    zIndex: String(DOCK_Z_INDEX),
    display: 'none',
    alignItems: 'center',
    gap: '12px',
    padding: '0 12px',
    boxSizing: 'border-box',
    background: '#0D1218',
    borderTop: '1px solid #1B2735',
    color: '#E8EEF5',
    font: '13px/18px system-ui, -apple-system, "Segoe UI", sans-serif',
    whiteSpace: 'nowrap',
  });
  const stripLink = doc.createElement('span');
  stripLink.setAttribute('data-pacsai-reading-strip-link', '');
  const stripCase = doc.createElement('span');
  stripCase.setAttribute('data-pacsai-reading-strip-case', '');
  Object.assign(stripCase.style, {
    color: '#A7B3C2',
    flex: '0 1 auto',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  const stripMain = doc.createElement('span');
  stripMain.setAttribute('data-pacsai-reading-strip-main', '');
  stripMain.setAttribute('aria-live', 'polite');
  Object.assign(stripMain.style, {
    flex: '1 1 auto',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  const stripBlocker = doc.createElement('span');
  stripBlocker.setAttribute('data-pacsai-reading-strip-blocker', '');
  Object.assign(stripBlocker.style, {
    color: '#F5C36B',
    flex: '0 1 auto',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  const stripActions = doc.createElement('span');
  stripActions.setAttribute('data-pacsai-reading-strip-actions', '');
  Object.assign(stripActions.style, { display: 'flex', gap: '8px', flex: '0 0 auto' });
  stripEl.append(stripLink, stripCase, stripMain, stripBlocker, stripActions);
  // The strip's buttons are the reader's, never the viewer's hotkeys (its own
  // keys, F4 and Alt+1/2/3, are taken on the window first, in capture).
  for (const type of ['keydown', 'keyup', 'keypress']) {
    stripEl.addEventListener(type, (e: Event) => e.stopPropagation());
  }
  const renderStrip = () => {
    stripEl.style.display = stripShown ? 'flex' : 'none';
    if (!stripShown || !strip) {
      return;
    }
    const v = stripView(strip);
    stripLink.textContent = v.linkText
      ? `${strip.linked === 'linked' ? '✓' : '⚠'} ${v.linkText}`
      : '';
    stripLink.setAttribute('data-pacsai-reading-strip-link', strip.linked);
    stripLink.style.color = strip.linked === 'linked' ? '#8FD7B2' : '#FFADB6';
    stripLink.style.display = v.linkText ? '' : 'none';
    stripCase.textContent = v.caseText;
    stripCase.title = v.caseText;
    stripMain.textContent = v.mainText;
    stripMain.title = v.mainText;
    stripBlocker.textContent = v.blockerText;
    stripBlocker.style.display = v.blockerText ? '' : 'none';
    stripActions.replaceChildren(
      ...v.actions.map(a => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = a.label;
        b.disabled = a.disabled;
        b.setAttribute('data-pacsai-reading-strip-action', a.id);
        Object.assign(b.style, {
          padding: '4px 12px',
          borderRadius: '6px',
          border: '1px solid #8AB4F8',
          background: a.primary ? '#8AB4F8' : 'transparent',
          color: a.primary ? '#0D1218' : '#8AB4F8',
          cursor: a.disabled ? 'default' : 'pointer',
          opacity: a.disabled ? '0.5' : '1',
          font: 'inherit',
          fontWeight: a.primary ? '600' : '400',
        });
        b.addEventListener('click', () => onStripAction(a.id));
        return b;
      })
    );
  };

  // ---- the channel's window ------------------------------------------------------
  function openerNow(): Window | null {
    if (!channel) {
      return null;
    }
    try {
      return channel.opener();
    } catch (_) {
      return null;
    }
  }
  function postToOpener(message: unknown): boolean {
    const opener = openerNow();
    if (!opener || !channel) {
      return false;
    }
    try {
      opener.postMessage(message, channel.ownOrigin);
      return true;
    } catch (_) {
      return false;
    }
  }

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
    if (plannedReload !== 'no') {
      return COVER_RELOADING;
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
    narrow: view ? view.layout.splitImagesPx === null : false,
    imagesHeld: view?.imagesHeld ?? false,
    reportPercent: reportPercent(reportRatio),
    viewerShown,
    dictation: dictation ? { ...dictation } : null,
    notices: notices.map(n => ({ ...n })),
    signed,
    strip: stripSnapshot(strip, stripShown),
    stripCounts: { ...stripCounts },
    layoutCounts: { ...layoutCounts },
    counts: { ...counts },
    reportOnlyOpens,
    identity: toldIdentity
      ? {
          studyRef: studyRefFor(toldIdentity.study),
          user: toldIdentity.user !== null,
          told: identityTold,
        }
      : null,
    channel: {
      documentId,
      opener: !!openerNow(),
      casesInDocument,
      plannedReload,
      adverts: channelCounts.adverts,
      answers: { ...channelCounts.answers },
      ignored: { ...channelCounts.ignored },
      relays: channelCounts.relays,
      offers: { ...channelCounts.offers },
    },
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
    // F55: the strip shows while the report is hidden (Images), the report up.
    stripShown = !!strip && phase === 'mounted' && viewerShown && !view.column.shown;
    root.style.setProperty(IMAGES_BOTTOM_VAR, stripShown ? `${STRIP_HEIGHT_PX}px` : '0px');
    stripEl.style.width = `${view.imagesWidthPx}px`;
    renderStrip();

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
    // Any other reason the report cannot be shown here: it can still be
    // written on its own page (with no session, sign in first).
    coverReportOnly.hidden = !(
      phase === 'failed' &&
      failure !== 'APP_SIGNED_OUT' &&
      !!routeStudy &&
      !!deps.openReportOnly
    );

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
    // F56: a choice the island was not up to take is told now that its case is.
    if (choiceUntold) {
      tellLayout();
    }
  };
  const onSigned = (signal: unknown) => {
    const s = signal as { studyInstanceUid?: unknown; sessionId?: unknown } | null;
    // The case shown signed: by its launch when the route carries one (a case
    // switched away from as its Submit ended can report the next study).
    const ofShownCase = routeLaunch
      ? s?.sessionId === routeLaunch.attempt
      : s?.studyInstanceUid === islandStudy;
    if (s && ofShownCase) {
      signed = true;
    }
    if (s && ofShownCase && (s as { offer?: unknown }).offer === true) {
      // F72: the island offers the next case in its line: the window stays
      // open, and the offer's Worklist is the relay when the reader wants it.
      channelCounts.offers.signed++;
    } else {
      // Phase 2: the relay after Sign; the worklist closes this window for the
      // case it shows and ignores any other.
      const relay = buildCloseWindow(s?.sessionId);
      if (relay && postToOpener(relay)) {
        channelCounts.relays++;
      }
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
  // F55: the strip, as the island tells it (null: no report to show).
  const onReportStatus = (state: unknown) => {
    strip = readStripState(state);
    apply();
  };
  // F55: a spoken reading mode, under setMode's own rules (Images refused
  // until the report's microphone state is known). F56: a spoken one is the
  // reader's choice, remembered; the report's own request (Both, to show why a
  // Sign did not sign) is not.
  const onModeRequest = (mode: unknown, why?: unknown): boolean => {
    if (typeof mode !== 'string' || !READING_MODES.some(m => m.value === mode)) {
      return false;
    }
    stripCounts.modeRequests++;
    return setMode(mode as WorkspaceMode, why === 'spoken' ? 'reader' : 'system');
  };
  /** F55: the strip's buttons. Review and Show report bring the report back
   *  (Both; setMode gives it the caret); Sign is the island's, which signs
   *  only a revision the reader has seen and else asks for the report. */
  const onStripAction = (id: string) => {
    if (id === 'sign') {
      stripCounts.signs++;
      let answer: unknown = 'none';
      try {
        answer = handle?.sign?.() ?? 'none';
      } catch (_) {
        answer = 'none';
      }
      if (answer === 'review') {
        setMode('both', 'system');
      }
      notify();
      return;
    }
    if (id === 'review' || id === 'show') {
      if (id === 'review') {
        stripCounts.reviews++;
      } else {
        stripCounts.shows++;
      }
      // F56: the strip's steps bring the report back for this case only.
      setMode('both', 'system');
      return;
    }
    if (id.startsWith('line:')) {
      stripCounts.lineActions++;
      try {
        handle?.lineAction?.('NEXT_CASE', id.slice('line:'.length));
      } catch (_) {
        /* the island keeps its line */
      }
      notify();
    }
  };

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
        readerChoseThisCase = false;
        choiceUntold = false;
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
    doc.body.append(divider, column, goneLine, stripEl);
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
      advertise();
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
        // F55: the Images strip, and a spoken reading mode.
        onReportStatus,
        onModeRequest,
        // F56: the layout remembered for the case that opened.
        onLayout,
        // F72: only a window the worklist opened can offer the next case.
        ...(channel ? { onOpenCase: openCase, onBackToWorklist: backToWorklist } : {}),
      });
    } catch (e) {
      phase = 'failed';
      failure = 'ISLAND_LOAD_FAILED';
      failureDetail = String((e as Error)?.message ?? e).slice(0, 120);
      apply();
      advertise();
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
      advertise();
      return;
    }
    handle = h;
    counts.mounts++;
    phase = 'mounted';
    islandStudy = study;
    expected = study ? { study, generation: null } : null;
    islandVisible = true;
    apply();
    advertise();
    // F56: a layout the reader chose while the island loaded is theirs to keep.
    if (readerChoseThisCase) {
      tellLayout();
    }
    // The route moved on while the module loaded.
    if (routeStudy !== islandStudy) {
      requestCase();
    }
    tellIdentity();
  };

  // ---- phase 2 (PR 4): what the viewer shows, for the island's identity gate -------------
  function viewerUserNow(): string | null {
    try {
      const user = deps.viewerUser?.() ?? null;
      return typeof user === 'string' && user.length > 0 && user.length <= 128 ? user : null;
    } catch (_) {
      return null;
    }
  }
  /** Told after the island took the route's case, so a switch it makes is never a disagreement. */
  function tellIdentity(): void {
    if (!handle || gone || typeof handle.setViewerIdentity !== 'function') {
      return;
    }
    const next = { study: routeStudy, user: viewerUserNow() };
    if (toldIdentity && toldIdentity.study === next.study && toldIdentity.user === next.user) {
      return;
    }
    try {
      if (handle.setViewerIdentity({ studyInstanceUid: next.study, userSub: next.user })) {
        toldIdentity = next;
        identityTold++;
        notify();
      }
    } catch (_) {
      /* the island keeps the last identity it took */
    }
  }

  // ---- phase 2: the worklist's channel --------------------------------------------------
  /** The advertisement: this document, the launch of the case it shows, and
   *  whether it can open the next case in this page (mounted, no reload under way). */
  function advertise(): void {
    if (!channel || gone || !documentId) {
      return;
    }
    let message: unknown;
    try {
      message = buildAdvert({
        documentId,
        activeLaunch: routeLaunch ?? null,
        caseSwitch: phase === 'mounted' && plannedReload === 'no',
      });
    } catch (_) {
      return;
    }
    if (postToOpener(message)) {
      channelCounts.adverts++;
    }
  }
  const bumpIgnored = (why: string) => {
    channelCounts.ignored[why] = (channelCounts.ignored[why] ?? 0) + 1;
  };
  const answer = (command: OpenCaseCommand, verdict: Parameters<typeof caseOpenedAnswer>[2]) => {
    try {
      postToOpener(caseOpenedAnswer(command, documentId, verdict));
    } catch (_) {
      bumpIgnored('answer-failed');
    }
  };
  const waitMs = (ms: number) => new Promise<void>(resolve => win.setTimeout(resolve, ms));
  /**
   * A planned reload (another gateway, a 13th case): a Submit in flight ends
   * first, the recognizer stops, the report settles (its draft saved, at most
   * 10 s), and only then does this window load the case's address, with no
   * leave prompt.
   */
  const plannedReloadTo = async (href: string) => {
    plannedReload = 'settling';
    channelCounts.answers.reloads++;
    advertise();
    apply();
    const h = handle;
    if (h) {
      const until = Date.now() + SUBMIT_BEFORE_RELOAD_MS;
      const submitting = () => {
        try {
          return typeof h.isSubmitting === 'function' && h.isSubmitting() === true;
        } catch (_) {
          return false;
        }
      };
      while (!gone && submitting() && Date.now() < until) {
        await waitMs(250);
      }
      if (dictation?.started && !dictation.busy) {
        try {
          h.toggleDictation?.();
        } catch (_) {
          /* the reload stops it */
        }
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
        /* the page's pagehide sends the draft with keepalive anyway */
      } finally {
        if (timer) {
          win.clearTimeout(timer);
        }
      }
    }
    if (gone) {
      return;
    }
    plannedReload = 'go';
    notify();
    channel?.loadNew(href);
  };
  /**
   * F72: Open on the case the island offered after Sign (claimed already by
   * the island where a worklist Read would claim it). The worklist hears it
   * first, so the case this window shows is still the one it knows; then the
   * case opens as a worklist Read would: the in-document switch, or a planned
   * reload for another gateway or a 13th case. False when it cannot be opened
   * here (the island says so and points to the worklist).
   */
  const openCase = (open: unknown): boolean => {
    const o = open as { studyInstanceUid?: unknown; gatewayAET?: unknown; launch?: unknown } | null;
    const refuse = () => {
      channelCounts.offers.refused++;
      notify();
      return false;
    };
    if (
      !channel ||
      gone ||
      !o ||
      !isCaseStudyUid(o.studyInstanceUid) ||
      !isCaseGatewayAet(o.gatewayAET) ||
      !isChannelLaunch(o.launch)
    ) {
      return refuse();
    }
    if (!documentId || plannedReload !== 'no') {
      return refuse();
    }
    const launch = { attempt: o.launch.attempt, attemptT0: o.launch.attemptT0 };
    const command: OpenCaseCommand = {
      action: OPEN_CASE_ACTION,
      requestId: documentId,
      studyInstanceUid: o.studyInstanceUid,
      attempt: launch.attempt,
      attemptT0: launch.attemptT0,
      gatewayAET: o.gatewayAET,
    };
    const decision = decideReadingCommand(command, {
      phase,
      routeStudy,
      caseState:
        islandCase && islandCase.study === routeStudy
          ? (islandCase.state as 'reportable' | 'unavailable')
          : null,
      documentGateways: channel.documentGateways(),
      casesInDocument,
    });
    if (decision.verdict !== 'switch' && decision.verdict !== 'reload') {
      return refuse();
    }
    const href = readingRouteFor({
      href: win.location.href,
      openedPath: channel.openedPath,
      studyInstanceUid: o.studyInstanceUid,
      gateways: decision.verdict === 'reload' ? [o.gatewayAET] : channel.documentGateways(),
      launch,
    });
    if (!href) {
      return refuse();
    }
    try {
      postToOpener(buildNextCase({ documentId, activeLaunch: launch }));
    } catch (_) {
      bumpIgnored('next-case-failed');
    }
    channelCounts.offers.opens++;
    if (decision.verdict === 'reload') {
      void plannedReloadTo(href);
      return true;
    }
    casesInDocument++;
    try {
      channel.switchTo(href);
    } catch (_) {
      bumpIgnored('switch-failed');
      return refuse();
    }
    notify();
    return true;
  };
  /** F72: the offer's Worklist: the relay after Sign, for the signed case. */
  const backToWorklist = (back: unknown): boolean => {
    const relay = buildCloseWindow((back as { sessionId?: unknown } | null)?.sessionId);
    const sent = !!relay && postToOpener(relay);
    if (sent) {
      channelCounts.relays++;
      channelCounts.offers.backs++;
    }
    notify();
    return sent;
  };

  const onMessage = (event: MessageEvent) => {
    if (!channel || gone) {
      return;
    }
    const opener = openerNow();
    const screen = screenCaseCommand(
      {
        fromOpener: !!opener && event.source === opener,
        openerOpen: !!opener && !opener.closed,
        origin: event.origin,
        data: event.data,
      },
      channel.ownOrigin
    );
    if (screen.kind === 'foreign') {
      return;
    }
    if (screen.kind === 'ignored') {
      bumpIgnored(screen.why);
      notify();
      return;
    }
    const command = screen.command;
    const launch = { attempt: command.attempt, attemptT0: command.attemptT0 };
    if (!documentId || plannedReload !== 'no') {
      // A reload is under way: the worklist's own replace supersedes it.
      channelCounts.answers.refused++;
      answer(command, { verdict: 'refuse', reason: 'reload' });
      notify();
      return;
    }
    const decision = decideReadingCommand(command, {
      phase,
      routeStudy,
      caseState:
        islandCase && islandCase.study === routeStudy
          ? (islandCase.state as 'reportable' | 'unavailable')
          : null,
      documentGateways: channel.documentGateways(),
      casesInDocument,
    });
    if (decision.verdict === 'focus-only') {
      if (!routeLaunch) {
        channelCounts.answers.refused++;
        answer(command, { verdict: 'refuse', reason: 'reload' });
      } else {
        channelCounts.answers.focusOnly++;
        answer(command, { verdict: 'focus-only', activeLaunch: routeLaunch });
        focusReport();
      }
      notify();
      return;
    }
    if (decision.verdict === 'refuse') {
      channelCounts.answers.refused++;
      answer(command, { verdict: 'refuse', reason: decision.reason });
      notify();
      return;
    }
    const href = readingRouteFor({
      href: win.location.href,
      openedPath: channel.openedPath,
      studyInstanceUid: command.studyInstanceUid,
      gateways:
        decision.verdict === 'reload' ? [command.gatewayAET as string] : channel.documentGateways(),
      launch,
    });
    if (!href) {
      channelCounts.answers.refused++;
      answer(command, { verdict: 'refuse', reason: 'reload' });
      notify();
      return;
    }
    answer(command, { verdict: 'accept', activeLaunch: launch });
    if (decision.verdict === 'reload') {
      void plannedReloadTo(href);
      return;
    }
    // The viewer's in-document switch: the route re-enters the mode for the
    // case (enter() below follows it with setCase, under the cover; a Submit
    // in flight is finished first there).
    channelCounts.answers.switched++;
    casesInDocument++;
    try {
      channel.switchTo(href);
    } catch (_) {
      bumpIgnored('switch-failed');
    }
    notify();
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
  // F56: the reader's own choice of layout goes to the island, which remembers
  // it for this display setup (and the case's modality, where it has its own).
  const tellLayout = () => {
    readerChoseThisCase = true;
    choiceUntold = true;
    const h = handle;
    if (!h || typeof h.layoutChanged !== 'function') {
      return;
    }
    try {
      if (h.layoutChanged({ mode: requested, reportRatio }) !== false) {
        layoutCounts.told++;
        choiceUntold = false;
      }
    } catch (_) {
      /* the layout stays as shown */
    }
    notify();
  };
  const setMode = (mode: WorkspaceMode, by: LayoutBy = 'reader'): boolean => {
    if (gone || !READING_MODES.some(m => m.value === mode)) {
      return false;
    }
    if (mode === 'images' && !dictationKnown()) {
      counts.refusedImages++;
      notify();
      return false;
    }
    const changed = requested !== mode;
    requested = mode;
    if (mode !== 'both') {
      fallback = mode;
    }
    apply();
    if (mode !== 'images') {
      focusReport();
    }
    if (by === 'reader' && changed) {
      tellLayout();
    }
    return true;
  };
  // F56: the island shows the layout remembered for the case that opened
  // ('case'), refused once the reader has chosen one in this case, or the
  // reader's own Reset or own layout turned off ('reader'); neither is told
  // back. Images while the report's microphone state is unknown shows as Both
  // until it is known (dockView), and a drag in progress keeps the divider
  // under the reader's hand.
  const onLayout = (value: unknown, why?: unknown): boolean => {
    const v = (typeof value === 'object' && value !== null ? value : {}) as {
      mode?: unknown;
      reportRatio?: unknown;
    };
    const ratio = v.reportRatio;
    const usable =
      READING_MODES.some(m => m.value === v.mode) &&
      typeof ratio === 'number' &&
      Number.isFinite(ratio) &&
      ratio > 0 &&
      ratio < 1;
    const byReader = why === 'reader';
    if (gone || !usable || dragging !== null || (!byReader && readerChoseThisCase)) {
      layoutCounts.refusedRestores++;
      notify();
      return false;
    }
    if (byReader) {
      readerChoseThisCase = true;
    }
    requested = v.mode as WorkspaceMode;
    if (requested !== 'both') {
      fallback = requested;
    }
    reportRatio = ratio as number;
    layoutCounts.restores++;
    apply();
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

  // ---- the viewer's gear menu (18 Oct) ----------------------------------------------
  // The report's own header row is folded away under quiet_workspace (D10), and
  // its settings open from the viewer's gear. v1's handle grew these within
  // version 1, so an older island offers neither, and nothing is listed.
  const menuOptions = (): ReadingMenuOption[] => {
    const h = handle;
    if (gone || phase !== 'mounted' || !h) {
      return [];
    }
    const out: ReadingMenuOption[] = [];
    if (typeof h.openReportSettings === 'function') {
      out.push({
        title: 'Report settings',
        icon: 'settings',
        onClick: () => {
          // The report's popups hide with it: from Images, the report comes back first.
          if (snapshot.mode === 'images') {
            setMode('both', 'system');
          }
          try {
            h.openReportSettings?.();
          } catch (_) {
            /* the report goes on */
          }
        },
      });
    }
    if (typeof h.quietWorkspace === 'function' && typeof h.setQuietWorkspace === 'function') {
      let on = false;
      try {
        on = h.quietWorkspace() === true;
      } catch (_) {
        on = false;
      }
      out.push({
        title: on ? 'Quiet report layout: on' : 'Quiet report layout: off',
        icon: 'settings',
        onClick: () => {
          try {
            h.setQuietWorkspace?.(!on);
          } catch (_) {
            /* the report goes on */
          }
        },
      });
    }
    // F55 PR 2 (29 Oct): the reader's sound cues, only where the app allows
    // them (the island answers null otherwise; an older island has no switch).
    if (typeof h.earcons === 'function' && typeof h.setEarcons === 'function') {
      let cues: boolean | null = null;
      try {
        const v = h.earcons();
        cues = typeof v === 'boolean' ? v : null;
      } catch (_) {
        cues = null;
      }
      if (cues !== null) {
        const on = cues;
        out.push({
          title: on ? 'Sound cues: on' : 'Sound cues: off',
          icon: 'settings',
          onClick: () => {
            try {
              h.setEarcons?.(!on);
            } catch (_) {
              /* the report goes on */
            }
          },
        });
      }
    }
    // F56 (29 Oct): the reading layouts, where the island can remember them
    // (null: the reader's settings could not be read; an older island has none).
    if (typeof h.layoutMenu === 'function' && typeof h.layoutAction === 'function') {
      let menu: { modality: string | null; ownLayout: boolean } | null = null;
      try {
        const v = h.layoutMenu();
        if (v && typeof v === 'object' && typeof v.ownLayout === 'boolean') {
          const modality =
            typeof v.modality === 'string' && /^[A-Z]{2,4}$/.test(v.modality) ? v.modality : null;
          menu = { modality, ownLayout: v.ownLayout };
        }
      } catch (_) {
        menu = null;
      }
      if (menu) {
        const act = (action: string) => () => {
          try {
            h.layoutAction?.(action, { mode: requested, reportRatio });
          } catch (_) {
            /* the layout stays as shown */
          }
          notify();
        };
        out.push({ title: 'Layout: save as my default', icon: 'settings', onClick: act('save') });
        out.push({ title: 'Layout: reset to my default', icon: 'settings', onClick: act('reset') });
        if (menu.modality) {
          out.push({
            title: `Own layout for ${menu.modality}: ${menu.ownLayout ? 'on' : 'off'}`,
            icon: 'settings',
            onClick: act(menu.ownLayout ? 'own-off' : 'own-on'),
          });
        }
      }
    }
    return out;
  };

  // ---- the divider --------------------------------------------------------------------
  let dragging: number | null = null;
  /** F56: the share when the drag began; a drag that moved it is told at its end. */
  let dragFrom: number | null = null;
  divider.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    dragging = e.pointerId;
    dragFrom = reportRatio;
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
    const moved = dragFrom !== null && dragFrom !== reportRatio;
    dragFrom = null;
    focusReport();
    if (moved) {
      tellLayout();
    }
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
    const before = reportRatio;
    setReportRatio(r);
    if (reportRatio !== before) {
      tellLayout();
    }
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
  coverReportOnly.addEventListener('click', () => {
    if (!routeStudy || !deps.openReportOnly) {
      return;
    }
    if (deps.openReportOnly(routeStudy, routeLaunch)) {
      reportOnlyOpens++;
      notify();
    }
  });
  const retryLoad = async () => {
    column.remove();
    divider.remove();
    goneLine.remove();
    stripEl.remove();
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
    // A planned reload settled the report first (its draft saved).
    if (plannedReload === 'go') {
      return;
    }
    if (phase !== 'mounted' || signed || islandCase?.state !== 'reportable') {
      return;
    }
    e.preventDefault();
    e.returnValue = '';
  };
  win.addEventListener('resize', onResize);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('beforeunload', onBeforeUnload);
  // PR 4: a sign-in in another window (the viewer's sign-in handoff) changes
  // the viewer's user without a route entry; the window coming back to the
  // front tells the island again.
  const onFront = () => {
    if (!doc.hidden) {
      tellIdentity();
    }
  };
  win.addEventListener('focus', onFront);
  doc.addEventListener('visibilitychange', onFront);
  if (channel) {
    win.addEventListener('message', onMessage);
  }

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
      // PR 4: once the island took the case (or refused it while a Submit
      // ends: then its gate holds the old case's microphone and Sign).
      tellIdentity();
      // The worklist's channel: this document now shows the new case's launch.
      advertise();
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
    // F55: the strip goes with the report.
    strip = null;
    stripShown = false;
    stripEl.style.display = 'none';
    root.style.removeProperty(IMAGES_BOTTOM_VAR);
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
    win.removeEventListener('focus', onFront);
    doc.removeEventListener('visibilitychange', onFront);
    win.removeEventListener('message', onMessage);
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
    stripEl.remove();
    root.style.removeProperty(IMAGES_BOTTOM_VAR);
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

  // ---- 21 Oct: Logout with the app's sign-in -----------------------------------------
  let loggingOut = false;
  const logout = (): boolean => {
    if (!deps.signOutOfApp || !deps.viewerUserIsApp?.()) {
      return false;
    }
    if (loggingOut) {
      return true;
    }
    loggingOut = true;
    void (async () => {
      // The report first, under the settle's own bound: a draft saved after the
      // sign-out would be refused.
      const h = handle;
      if (h) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            h.settle(),
            new Promise(resolve => {
              timer = win.setTimeout(resolve, SETTLE_BEFORE_UNMOUNT_MS);
            }),
          ]);
        } catch (_) {
          /* the unmount sends the draft with keepalive anyway */
        } finally {
          if (timer) {
            win.clearTimeout(timer);
          }
        }
      }
      let signedOut = false;
      try {
        signedOut = (await deps.signOutOfApp?.()) === true;
      } catch (_) {
        signedOut = false;
      }
      loggingOut = false;
      deps.leaveAfterSignOut?.(signedOut);
    })();
    return true;
  };

  snapshot = buildSnapshot();
  return {
    enter,
    routeLeft,
    setMode,
    setReportRatio,
    toggleDictation,
    focusReport,
    menuOptions,
    logout,
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
