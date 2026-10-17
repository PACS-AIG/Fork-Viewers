/**
 * Rev 11 milestone 6, approach C, phase 1: what the reading dock shows, from
 * what the reader chose and what the report has said. Pure (no window, DOM or
 * OHIF): readingDock.ts applies it, dockModel.test.ts pins it.
 *
 * The dock is the viewer's report column (the editor island mounted in it),
 * the divider and the cover, kept outside OHIF's React tree so OHIF's layout
 * rebuilds never touch them. The images area below the viewer's header is
 * narrowed to the width the layout rules give it; the header stays whole.
 */
import {
  DIVIDER_PX,
  MIN_REPORT_PX,
  frameWidthPx,
  resolveLayout,
  splitAllowed,
  type Layout,
  type PaneRole,
  type WorkspaceMode,
} from './readingLayout';

/** The viewer's header, as measured (ui-next Header: one 48 px row). ViewerLayout
 *  sizes what is below it as calc(100vh - 52px), 4 px short of the window; the
 *  report column starts where that area starts and runs to the window's foot. */
export const VIEWER_HEADER_PX = 48;
/** The line that says the images are not shown, once the viewer left its route on an error. */
export const IMAGES_GONE_LINE_PX = 32;

/** The control's order, words and default keys (Alt+1/2/3, radcopilot's own hotkeys). */
export const READING_MODES: ReadonlyArray<{ value: WorkspaceMode; label: string; keys: string[] }> = [
  { value: 'images', label: 'Images', keys: ['alt+1'] },
  { value: 'both', label: 'Both', keys: ['alt+2'] },
  { value: 'report', label: 'Report', keys: ['alt+3'] },
];

/** The microphone key (WeiWei, 17 Oct: F4, PowerScribe's dictation on/off).
 *  The dock owns it on the whole page, in every mode; radcopilot's hotkeys
 *  list it for OHIF's shortcut sheet. */
export const READING_MIC_KEY = { label: 'Microphone on/off', keys: ['f4'], code: 'F4' } as const;

/** Is this keydown the microphone key? Plain F4 only: Alt+F4 and Ctrl+F4 belong
 *  to the system and the browser. A held key repeats its keydown; the caller
 *  toggles on the first one only. */
export const isMicKey = (
  e: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
): boolean =>
  e.code === READING_MIC_KEY.code && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

export interface DockInput {
  /** The mode the reader chose. */
  requested: WorkspaceMode;
  /** The reader's divider, as chosen. */
  reportRatio: number;
  widthPx: number;
  heightPx: number;
  /** Both was shown just before (the ladder's hysteresis). */
  wasSplit: boolean;
  /** The last single pane the reader chose: where one pane goes when Both cannot fit. */
  fallback: PaneRole | null;
  /** The report has told its microphone state for the open case. */
  dictationKnown: boolean;
  /** False once the viewer left its route on an error (the study was not found): the report alone. */
  viewerShown: boolean;
  /** The images width last on screen; a parked images area keeps it. */
  lastVisibleImagesPx: number | null;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DockView {
  layout: Layout;
  /** What is shown. */
  mode: WorkspaceMode;
  /** Images (asked for, or the narrow ladder's one pane) is held back until the
   *  report's microphone state is known: a hidden report must never dictate
   *  unseen with no indicator. */
  imagesHeld: boolean;
  /** The width OHIF's images area keeps: never 0, a parked one keeps a real size. */
  imagesWidthPx: number;
  /** The report column; `shown` false: parked off screen at a real size. */
  column: Rect & { shown: boolean };
  divider: (Rect & { shown: true }) | { shown: false };
  /** The images are under the report (Report, or no viewer route): rendering pauses. */
  parked: boolean;
}

const px = (n: number): number => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));

/** The width the report takes when Both shows at this width, else its floor. */
const splitReportPx = (layout: Layout, widthPx: number): number =>
  layout.splitImagesPx !== null ? widthPx - DIVIDER_PX - layout.splitImagesPx : MIN_REPORT_PX;

export function dockView(input: DockInput): DockView {
  const width = px(input.widthPx);
  const height = px(input.heightPx);

  if (!input.viewerShown) {
    const layout = resolveLayout({ requested: 'report', reportRatio: input.reportRatio, widthPx: width });
    const top = IMAGES_GONE_LINE_PX;
    return {
      layout,
      mode: 'report',
      imagesHeld: false,
      imagesWidthPx: frameWidthPx(layout, input.lastVisibleImagesPx, width),
      column: { left: 0, top, width, height: Math.max(0, height - top), shown: true },
      divider: { shown: false },
      parked: true,
    };
  }

  const allowSplit = splitAllowed(width, input.wasSplit);
  let layout = resolveLayout({
    requested: input.requested,
    reportRatio: input.reportRatio,
    widthPx: width,
    fallback: input.fallback,
    allowSplit,
  });
  let imagesHeld = false;
  if (layout.mode === 'images' && !input.dictationKnown) {
    imagesHeld = true;
    layout = resolveLayout({
      requested: 'both',
      reportRatio: input.reportRatio,
      widthPx: width,
      fallback: 'report',
      allowSplit,
    });
  }

  const top = VIEWER_HEADER_PX;
  const columnHeight = Math.max(0, height - top);
  const imagesWidthPx = frameWidthPx(layout, input.lastVisibleImagesPx, width);
  if (layout.mode === 'both') {
    return {
      layout,
      mode: 'both',
      imagesHeld,
      imagesWidthPx,
      column: { left: layout.imagesPx + DIVIDER_PX, top, width: layout.reportPx, height: columnHeight, shown: true },
      divider: { left: layout.imagesPx, top, width: DIVIDER_PX, height: columnHeight, shown: true },
      parked: false,
    };
  }
  if (layout.mode === 'report') {
    return {
      layout,
      mode: 'report',
      imagesHeld,
      imagesWidthPx,
      column: { left: 0, top, width, height: columnHeight, shown: true },
      divider: { shown: false },
      parked: true,
    };
  }
  // Images: the report is parked just off the window's right edge, at the
  // width Both would give it, inert (setVisibility(false)); dictation goes on.
  return {
    layout,
    mode: 'images',
    imagesHeld: false,
    imagesWidthPx,
    column: { left: width, top, width: splitReportPx(layout, width), height: columnHeight, shown: false },
    divider: { shown: false },
    parked: false,
  };
}

/** Where the next resolve starts from, once a view is on screen. */
export function afterShown(
  view: DockView,
  previous: { lastVisibleImagesPx: number | null }
): { wasSplit: boolean; lastVisibleImagesPx: number | null } {
  return {
    wasSplit: view.mode === 'both',
    lastVisibleImagesPx: view.layout.imagesPx > 0 ? view.layout.imagesPx : previous.lastVisibleImagesPx,
  };
}

// ---------------------------------------------------------------------------
// What the viewer says about a hidden report. The island tells codes only,
// never report text (pacsai.reportIsland v1, onNotice); the viewer's header
// shows a short line for each while the report is hidden.

export type NoticeLevel = 'warning' | 'error';

const NOTICE_TEXT: Record<string, string> = {
  AUTH_REQUIRED: 'Report: sign in to PACS AI again',
  USER_CHANGED: 'Report: another user signed in',
  CASE_UNAVAILABLE: 'Report: this case cannot be reported here',
  DRAFT_NOT_SAVED: 'Report: the draft is not saved',
  DRAFT_STOPPED: 'Report: saving the draft stopped',
  DRAFT_OTHER_READER: "Report: another reader's draft is waiting",
  DRAFT_RESTORED_CHANGED: 'Report: the draft came back; check it',
  DRAFT_CHECK_SECTIONS: 'Report: check where your words meet the draft',
  ISLAND_CSS_FAILED: "Report: its styles did not load",
  ISLAND_RENDER_FAILED: 'Report: it could not be shown',
};

/** The header's words for a notice code; an unknown code still says the report needs a look. */
export const noticeText = (code: string): string =>
  Object.prototype.hasOwnProperty.call(NOTICE_TEXT, code) ? NOTICE_TEXT[code] : 'Report: needs your attention';

// ---------------------------------------------------------------------------
// The report's microphone, as the viewer's header shows it (pacsai.reportIsland
// v1, onDictation: started, busy, available, pending).

export interface DictationState {
  started: boolean;
  busy: boolean;
  available: boolean;
  pending: number;
}

export const isDictationState = (v: unknown): v is DictationState =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as DictationState).started === 'boolean' &&
  typeof (v as DictationState).busy === 'boolean' &&
  typeof (v as DictationState).available === 'boolean' &&
  Number.isFinite((v as DictationState).pending);

/** The destination line beside the microphone in the header. */
export function micLine(state: DictationState | null): string {
  if (!state) {
    return 'Report microphone: waiting';
  }
  if (!state.available) {
    return 'Report microphone unavailable';
  }
  if (state.busy) {
    return state.started ? 'Stopping dictation…' : 'Starting dictation…';
  }
  const pending = state.pending > 0 ? ` · ${state.pending} to confirm` : '';
  return (state.started ? 'Dictating into the report' : 'Report microphone off') + pending;
}
