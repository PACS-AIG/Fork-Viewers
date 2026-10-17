/**
 * Rev 11 milestone 6, approach C, phase 1 PR 4: radcopilot's series rail. With
 * READING_DOCK on, the mode's left panel is the measurement-tracking study
 * browser drawn as one narrow column (its 'seriesRail' panel), at a fixed width
 * the reader cannot drag. Whether the reader closed it is remembered in this
 * browser (the reading layout has no per-reader store yet). Pure apart from the
 * storage it is handed.
 */

/** The rail's width in px: a 96 px tile with its margins (Roy's rail: 96–144 px). */
export const READING_RAIL_PX = 112;

/** The measurement-tracking panel radcopilot's layout puts on the left. */
export const SERIES_RAIL_PANEL = '@ohif/extension-measurement-tracking.panelModule.seriesRail';

export const RAIL_CLOSED_KEY = 'pacsai.radcopilot.seriesRailClosed';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): StorageLike | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch (_) {
    return null;
  }
};

/** True when the reader closed the rail last time (false when nothing is stored or storage fails). */
export function readRailClosed(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(RAIL_CLOSED_KEY) === '1';
  } catch (_) {
    return false;
  }
}

/** Remember the rail as closed or open; a storage that refuses changes nothing. */
export function writeRailClosed(
  closed: boolean,
  storage: StorageLike | null = browserStorage()
): void {
  try {
    storage?.setItem(RAIL_CLOSED_KEY, closed ? '1' : '0');
  } catch (_) {
    /* private mode or blocked storage: the rail opens next time */
  }
}

/** The left panel props radcopilot's layout adds with READING_DOCK on. */
export function railLayoutProps(storage: StorageLike | null = browserStorage()) {
  return {
    leftPanels: [SERIES_RAIL_PANEL],
    leftPanelResizable: false,
    leftPanelWidth: READING_RAIL_PX,
    leftPanelClosed: readRailClosed(storage),
    onLeftPanelClosedChange: onRailClosedChange,
  };
}

/** One function for every layout render, so the layout's effect does not re-run for a new callback. */
function onRailClosedChange(closed: boolean): void {
  writeRailClosed(closed);
}
