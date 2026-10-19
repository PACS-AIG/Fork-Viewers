/**
 * Rev 11 milestone 6, approach C, phase 1: the reading layout's rules. The
 * three modes, the divider's bounds from the tested minimum widths (560 px
 * for the report, 796 px for the images, an 8 px divider: one pane below
 * 1364 px), the narrow-width ladder and the divider's keys, as the app built
 * and unit-tested them for milestone 6 (app repo, src/app/lib/workspaceLayout.ts).
 *
 * The text between the two "pinned layout rules" lines is the app's, byte for
 * byte. readingLayout.test.ts pins it by its SHA-256, as the app's
 * workspaceLayout.pin.test.mjs pins its own copy, so a change on either side
 * fails a test until both copies and both pins move together. Only the two
 * types the rules name are declared here; the words on the control are the
 * dock's own (the middle mode reads "Both", workspace decision 8).
 *
 * Pure: no window, React or OHIF here.
 */
export type WorkspaceMode = 'images' | 'both' | 'report';
export type PaneRole = 'images' | 'report';

// ---- pinned layout rules: begin ----
/** Images + Report is the default when there is no valid saved arrangement. */
export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = 'both';
/** About 60 % images and 40 % report to start (docs/12 §2). The ratio is the
 *  REPORT's share, which is also what the divider announces. */
export const DEFAULT_REPORT_RATIO = 0.4;
/** Provisional minimums (docs/02 §5): an image area of about 640 px plus the
 *  viewer's 156 px left rail, and 560 px for the report. */
export const MIN_IMAGES_PX = 796;
export const MIN_REPORT_PX = 560;
export const DIVIDER_PX = 8;
/** The narrowest window that holds both panes at their minimums. */
export const SPLIT_MIN_WIDTH_PX = MIN_IMAGES_PX + MIN_REPORT_PX + DIVIDER_PX;
/** One arrow key moves the divider by 2 % of the width the panes share. */
export const RATIO_STEP = 0.02;
/** Once the split has given way to one pane, it comes back only this much
 *  above the minimum: a scrollbar appearing (up to ~17 px) as the one-pane
 *  report changes height must not flip the layout back and forth. */
export const SPLIT_HYSTERESIS_PX = 24;

export const isWorkspaceMode = (v: unknown): v is WorkspaceMode =>
    v === 'images' || v === 'both' || v === 'report';

export const modeShowsImages = (mode: WorkspaceMode): boolean => mode !== 'report';
export const modeShowsReport = (mode: WorkspaceMode): boolean => mode !== 'images';

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** A ratio from storage or a drag, made usable: anything that is not a share
 *  strictly between 0 and 1 becomes the default. */
const usableRatio = (ratio: unknown): number =>
    typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio < 1 ? ratio : DEFAULT_REPORT_RATIO;

/** The range the report's share may take at this window width, from the two
 *  minimums, or null when the window cannot hold both panes at all. The share
 *  is of the width the panes divide, i.e. the window less the divider. */
export const splitBounds = (widthPx: number): { min: number; max: number } | null => {
    if (!Number.isFinite(widthPx)) return null;
    const usable = widthPx - DIVIDER_PX;
    if (usable < MIN_IMAGES_PX + MIN_REPORT_PX) return null;
    return { min: MIN_REPORT_PX / usable, max: (usable - MIN_IMAGES_PX) / usable };
};

/** The share the divider can SHOW at this width. The reader's own ratio is
 *  kept by the caller as chosen: a narrower window changes what is shown, never
 *  what was chosen (docs/02 §5, "do not change the remembered choice just
 *  because the window got narrow"). */
export const clampReportRatio = (ratio: number, widthPx: number): number => {
    const r = usableRatio(ratio);
    const bounds = splitBounds(widthPx);
    if (!bounds) return r;
    return Math.min(bounds.max, Math.max(bounds.min, r));
};

export interface LayoutInput {
    /** The mode the reader chose. */
    requested: WorkspaceMode;
    /** The reader's divider, as chosen. */
    reportRatio: number;
    /** The window's width in CSS pixels. */
    widthPx: number;
    /** Where one pane goes when Images + Report cannot fit: the role the reader
     *  is working in, else the last single pane they chose. None → Report. */
    fallback?: PaneRole | null;
    /** False holds the one-pane fallback although the minimums fit (see
     *  `splitAllowed`). Default true. */
    allowSplit?: boolean;
}

export interface Layout {
    requested: WorkspaceMode;
    /** What is shown. Differs from `requested` only when Images + Report was
     *  asked for and the window cannot hold it. */
    mode: WorkspaceMode;
    /** False only in that case; the caller says so and keeps all three choices. */
    fits: boolean;
    /** The share shown (clamped to this width's bounds). */
    reportRatio: number;
    /** Visible widths; 0 for a hidden pane. */
    imagesPx: number;
    reportPx: number;
    /** The images width Images + Report has at this width, or null when it
     *  cannot fit. A parked viewer keeps a real size (see `frameWidthPx`). */
    splitImagesPx: number | null;
}

/** The narrow-width ladder (docs/12 §2, docs/02 §5): Images + Report when both
 *  minimums fit; otherwise one pane, never a squeeze, and the caller shows why. */
export const resolveLayout = ({ requested, reportRatio, widthPx, fallback, allowSplit = true }: LayoutInput): Layout => {
    const width = Math.max(0, Math.round(Number.isFinite(widthPx) ? widthPx : 0));
    const req: WorkspaceMode = isWorkspaceMode(requested) ? requested : DEFAULT_WORKSPACE_MODE;
    const bounds = allowSplit ? splitBounds(width) : null;
    const shown = clampReportRatio(reportRatio, width);
    const splitReportPx = bounds ? Math.round((width - DIVIDER_PX) * shown) : null;
    const splitImagesPx = bounds && splitReportPx !== null ? width - DIVIDER_PX - splitReportPx : null;

    if (req === 'both') {
        if (bounds && splitReportPx !== null && splitImagesPx !== null) {
            return { requested: req, mode: 'both', fits: true, reportRatio: shown, imagesPx: splitImagesPx, reportPx: splitReportPx, splitImagesPx };
        }
        const mode: WorkspaceMode = fallback === 'images' ? 'images' : 'report';
        return {
            requested: req, mode, fits: false, reportRatio: shown,
            imagesPx: mode === 'images' ? width : 0,
            reportPx: mode === 'report' ? width : 0,
            splitImagesPx: null,
        };
    }
    return {
        requested: req, mode: req, fits: true, reportRatio: shown,
        imagesPx: req === 'images' ? width : 0,
        reportPx: req === 'report' ? width : 0,
        splitImagesPx,
    };
};

/** The width the viewer's frame keeps. Visible: its pane. Hidden (Report): the
 *  width it last had on screen, else the width Images + Report would give it,
 *  else the window. Never zero once the window has a width — a hidden viewer is
 *  parked at a real size, not collapsed (docs/12 §9: never render into a hidden
 *  zero-size canvas). */
export const frameWidthPx = (layout: Layout, lastVisibleImagesPx: number | null, widthPx: number): number => {
    const width = Math.max(0, Math.round(Number.isFinite(widthPx) ? widthPx : 0));
    if (layout.imagesPx > 0) return layout.imagesPx;
    if (lastVisibleImagesPx && lastVisibleImagesPx > 0) return Math.min(Math.round(lastVisibleImagesPx), width);
    if (layout.splitImagesPx && layout.splitImagesPx > 0) return layout.splitImagesPx;
    return width;
};

/** The divider's keys, as a vertical window splitter whose value is the
 *  report's share (WAI-ARIA window splitter): ArrowLeft moves the divider left
 *  and widens the report, ArrowRight narrows it, Home and End go to the
 *  report's smallest and largest share. Null for any other key, or when the
 *  window cannot hold both panes. */
export const keyboardReportRatio = (key: string, ratio: number, widthPx: number): number | null => {
    const bounds = splitBounds(widthPx);
    if (!bounds) return null;
    const r = clampReportRatio(ratio, widthPx);
    switch (key) {
        case 'ArrowLeft': return Math.min(bounds.max, round3(r + RATIO_STEP));
        case 'ArrowRight': return Math.max(bounds.min, round3(r - RATIO_STEP));
        case 'Home': return bounds.min;
        case 'End': return bounds.max;
        default: return null;
    }
};

/** The report's share for a divider dragged to `clientX`, clamped, or null
 *  when the window cannot hold both panes. */
export const ratioFromPointer = (clientX: number, widthPx: number): number | null => {
    const bounds = splitBounds(widthPx);
    if (!bounds || !Number.isFinite(clientX)) return null;
    const usable = widthPx - DIVIDER_PX;
    const reportPx = widthPx - clientX - DIVIDER_PX / 2;
    return Math.min(bounds.max, Math.max(bounds.min, reportPx / usable));
};

export const reportPercent = (ratio: number): number => Math.round(usableRatio(ratio) * 100);

/** Whether Images + Report may be shown at this width, given whether it was
 *  shown just before: at the minimum while it is, SPLIT_HYSTERESIS_PX above it
 *  to come back. */
export const splitAllowed = (widthPx: number, wasSplit: boolean): boolean =>
    splitBounds(widthPx) !== null && (wasSplit || widthPx >= SPLIT_MIN_WIDTH_PX + SPLIT_HYSTERESIS_PX);
// ---- pinned layout rules: end ----
