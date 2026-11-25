/**
 * RS-36: the 3D anatomy model in a cell of the viewer's grid (WeiWei, 25 Nov
 * 2026: "move it to the main viewports, like an exception to the current
 * hanging protocol", behind a setting, on by default).
 *
 *   - On (the gear menu's switch, kept in this browser): while the grid shows
 *     the hanging protocol's stage and the study's anatomy offers display
 *     surfaces, the stage's layout gains one cell, the model's
 *     (anatomy3dLayout), as soon as both are there, whichever comes last.
 *   - Only the protocol's layout: one the reader picks (the layout button),
 *     or OHIF's one-up, is left as it is. The grid shows the stage when its
 *     viewports, the cell aside, are the stage's, in its order, and (without
 *     the cell) in its rows and columns.
 *   - The Anatomy tab's 3D button takes the cell out, or puts it into the
 *     layout there is; the cell's x takes it out, and so does dropping a
 *     series on it. Out stays out for the study until the button puts it back.
 *   - Off: the cell goes, the stage's layout as the protocol made it; the 3D
 *     button opens the model in the tab, as before.
 *   - Never without WebGL: nothing could be drawn.
 *
 * The cell looks at the grid a moment after anything changes (OHIF's grid
 * state is React's, current only after a render), and after a layout of its
 * own only once that layout has come, so it never adds itself twice.
 *
 * The cell shows a display set of its own: no images, never matched by a
 * protocol (`isNonImageDisplaySet`), never in the series list; its viewport
 * (Anatomy3DViewport) draws the model as the tab's 3D view does. No UID is
 * named in the harness state.
 */
import { gridBoxes, withAnatomy3dCell, type CellBox } from './anatomy3dLayout';
import type { AnatomySnapshot, AnatomyStore } from './anatomyStore';

/** The SOP class handler the cell's display set names: the viewport module maps it to Anatomy3DViewport. */
export const ANATOMY3D_SOP_CLASS_HANDLER_ID =
  '@ohif/extension-pacsai-hp.sopClassHandlerModule.anatomy3d';
/** The cell's viewport, as the mode lists it with the display sets it shows. */
export const ANATOMY3D_VIEWPORT_NAMESPACE = '@ohif/extension-pacsai-hp.viewportModule.anatomy3d';
/** Where the setting is kept ('off' to switch it off; anything else is on). */
export const ANATOMY3D_SETTING_KEY = 'pacsai.anatomy3dViewport';
/** How long a layout the cell asked for may take to come before the cell looks again regardless. */
const SETTLE_MS = 3000;
/** How long after a change the cell looks at the grid (OHIF's grid state is current a render later). */
const LOOK_MS = 50;

interface GridViewport {
  viewportId: string;
  displaySetInstanceUIDs?: string[];
  displaySetOptions?: unknown[];
  viewportOptions?: Record<string, unknown>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  [k: string]: unknown;
}
interface GridState {
  layout: { numRows: number; numCols: number; [k: string]: unknown };
  viewports: Map<string, GridViewport>;
  activeViewportId?: string | null;
  [k: string]: unknown;
}
interface Subscription {
  unsubscribe?: () => void;
}
/** What the cell reads of the protocol's active stage. */
interface ActiveProtocol {
  stage?: { viewportStructure?: { properties?: { rows?: number; columns?: number } } };
  viewportMatchDetails?: Map<string, unknown>;
}
export interface CellServices {
  viewportGridService: {
    EVENTS: { LAYOUT_CHANGED: string; GRID_STATE_CHANGED: string };
    getState(): GridState | undefined;
    setLayout(options: Record<string, unknown>): unknown;
    subscribe(event: string, listener: (...args: unknown[]) => void): Subscription;
  };
  hangingProtocolService: {
    EVENTS: { PROTOCOL_CHANGED: string };
    subscribe(event: string, listener: (...args: unknown[]) => void): Subscription;
    getActiveProtocol?: () => ActiveProtocol | undefined;
  };
  displaySetService: {
    addDisplaySets(...displaySets: unknown[]): unknown;
    getDisplaySetByUID(uid: string): unknown;
  };
}

export interface Anatomy3dCellDeps {
  services: CellServices;
  store: AnatomyStore;
  /** The setting's storage (the browser's). */
  storage: { get(): string | null; set(value: string): void };
  /** Whether the page can draw WebGL (asked once, when first needed). */
  webgl: () => boolean;
  now?: () => number;
  /** How long after a change the cell looks at the grid (tests: 0). */
  lookMs?: number;
}

export interface Anatomy3dCell {
  readonly store: AnatomyStore;
  /** The route's study: the cell's display set belongs to it. A new study: the cell may come back. */
  enter(study: string): void;
  leave(): void;
  /** The setting: the protocol's layouts gain the cell (on unless switched off). */
  setting(): boolean;
  setSetting(on: boolean): void;
  /** Whether the 3D button works the grid: the setting on, and the page draws WebGL. */
  inGrid(): boolean;
  /** Whether the cell is in the grid, or on its way in. */
  shown(): boolean;
  /** The tab's 3D button: the cell out of the grid, or into it. */
  toggle(): void;
  /** The cell's x: out of the grid, until the 3D button puts it back. */
  hide(): void;
  /** The series whose surfaces the cell draws (the first that offers any), or null. */
  series(): number | null;
  subscribe(listener: () => void): () => void;
  /** A number that changes when anything the tab shows of the cell changes. */
  version(): number;
  harnessState(): Record<string, unknown>;
  destroy(): void;
}

/** Whether a series offers display surfaces (as the tab's 3D button does). */
export function seriesWithSurfaces(snap: AnatomySnapshot): number | null {
  const s = snap.series.find(v =>
    v.tasks.some(t => t.surfaces.status !== 'none' && t.surfaces.status !== 'withheld')
  );
  return s ? s.index : null;
}

let current: Anatomy3dCell | null = null;
/** The page's cell, for its viewport (one per document, while the reading system is entered). */
export const currentAnatomy3dCell = (): Anatomy3dCell | null => current;

const boxOf = (v: GridViewport): CellBox => ({
  x: typeof v.x === 'number' ? v.x : 0,
  y: typeof v.y === 'number' ? v.y : 0,
  width: typeof v.width === 'number' ? v.width : 1,
  height: typeof v.height === 'number' ? v.height : 1,
});
const copyOf = (v: GridViewport): GridViewport => ({
  ...v,
  viewportOptions: { ...(v.viewportOptions ?? {}) },
});
const signatureOf = (rows: number, cols: number, ids: string[]): string =>
  `${rows}x${cols}:${ids.join(',')}`;

export function createAnatomy3dCell(deps: Anatomy3dCellDeps): Anatomy3dCell {
  const { services, store } = deps;
  const grid = services.viewportGridService;
  const hp = services.hangingProtocolService;
  const now = deps.now ?? (() => Date.now());
  const lookMs = deps.lookMs ?? LOOK_MS;
  const listeners = new Set<() => void>();
  let study: string | null = null;
  let displaySet: Record<string, unknown> | null = null;
  let sets = 0;
  let cells = 0;
  let cellViewportId: string | null = null;
  // Out by the reader (the 3D button, the cell's x, a series dropped on it), for this study.
  let out = false;
  // The 3D button put the cell in: it joins the layout there is, the reader's too.
  let forced = false;
  // The layout the cell last asked for (rows x columns and its viewports, in order), until it comes.
  let expected: string | null = null;
  let expectedAt = 0;
  let expectedShown = false;
  // The stage's layout before the cell, to put back.
  let base: {
    numRows: number;
    numCols: number;
    layoutOptions: CellBox[];
    viewportIds: string[];
    activeViewportId: string | null;
  } | null = null;
  let webglOk: boolean | null = null;
  let changes = 0;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const notify = () => {
    changes++;
    listeners.forEach(l => l());
  };
  const setting = (): boolean => {
    try {
      return deps.storage.get() !== 'off';
    } catch (_) {
      return true;
    }
  };
  const canDraw = (): boolean => {
    if (webglOk === null) {
      try {
        webglOk = deps.webgl();
      } catch (_) {
        webglOk = false;
      }
    }
    return webglOk;
  };
  const uid = (): string | null => (displaySet ? String(displaySet.displaySetInstanceUID) : null);
  const isCell = (v: GridViewport): boolean => {
    const u = uid();
    return Boolean(u && v.displaySetInstanceUIDs?.includes(u));
  };
  const viewportsOf = (state: GridState | undefined): GridViewport[] =>
    state?.viewports ? [...state.viewports.values()] : [];
  const shownNow = (): boolean => viewportsOf(grid.getState()).some(isCell);
  const settling = (): boolean => expected !== null && now() - expectedAt < SETTLE_MS;
  const shownSoon = (): boolean => (settling() ? expectedShown : shownNow());
  const want = (): boolean =>
    !destroyed &&
    study !== null &&
    setting() &&
    !out &&
    seriesWithSurfaces(store.getSnapshot()) !== null &&
    canDraw();

  /** Whether the grid shows the protocol's stage (the cell aside). */
  const showsStage = (state: GridState): boolean => {
    let active: ActiveProtocol | undefined;
    try {
      active = hp.getActiveProtocol?.();
    } catch (_) {
      return false;
    }
    const ids = active?.viewportMatchDetails ? [...active.viewportMatchDetails.keys()] : [];
    if (!ids.length) {
      return false;
    }
    const vps = viewportsOf(state);
    const rest = vps.filter(v => !isCell(v)).map(v => v.viewportId);
    if (rest.length !== ids.length || rest.some((id, i) => id !== ids[i])) {
      return false;
    }
    const shape = active?.stage?.viewportStructure?.properties;
    const withCell = rest.length !== vps.length;
    return (
      withCell ||
      !shape ||
      ((shape.rows ?? state.layout.numRows) === state.layout.numRows &&
        (shape.columns ?? state.layout.numCols) === state.layout.numCols)
    );
  };

  const ensureDisplaySet = (): Record<string, unknown> | null => {
    const u = uid();
    if (displaySet && u && services.displaySetService.getDisplaySetByUID(u)) {
      return displaySet;
    }
    if (!study) {
      return null;
    }
    sets++;
    const id = `pacsai-anatomy-3d-${sets}`;
    displaySet = {
      displaySetInstanceUID: id,
      SeriesInstanceUID: id,
      StudyInstanceUID: study,
      SOPClassHandlerId: ANATOMY3D_SOP_CLASS_HANDLER_ID,
      SOPClassUID: '',
      Modality: 'OT',
      SeriesDescription: '3D anatomy',
      SeriesNumber: 99998,
      SeriesDate: '',
      SeriesTime: '',
      numImageFrames: 0,
      imageIds: [],
      instances: [],
      images: [],
      isAnatomy3D: true,
      excludeFromThumbnailBrowser: true,
      isReconstructable: false,
      // Built by the viewer, but not the reader's: the series list never jumps to it.
      madeInClient: false,
    };
    services.displaySetService.addDisplaySets(displaySet);
    return displaySet;
  };

  const setLayout = (options: Record<string, unknown>, ids: string[], withCell: boolean) => {
    expected = signatureOf(options.numRows as number, options.numCols as number, ids);
    expectedAt = now();
    expectedShown = withCell;
    try {
      Promise.resolve(grid.setLayout(options)).catch(() => {
        expected = null;
      });
    } catch (_) {
      expected = null;
    }
  };

  const augment = (state: GridState): void => {
    const vps = viewportsOf(state);
    if (!vps.length || vps.some(isCell)) {
      return;
    }
    const set = ensureDisplaySet();
    if (!set) {
      return;
    }
    const boxes = vps.map(boxOf);
    base = {
      numRows: state.layout.numRows,
      numCols: state.layout.numCols,
      layoutOptions: boxes,
      viewportIds: vps.map(v => v.viewportId),
      activeViewportId: state.activeViewportId ?? null,
    };
    const next = withAnatomy3dCell(base.numRows, base.numCols, boxes);
    cells++;
    const cellId = `pacsai-anatomy-3d-${cells}`;
    cellViewportId = cellId;
    setLayout(
      {
        numRows: next.numRows,
        numCols: next.numCols,
        layoutOptions: next.layoutOptions,
        activeViewportId: state.activeViewportId ?? undefined,
        isHangingProtocolLayout: true,
        findOrCreateViewport: (position: number) =>
          position < vps.length
            ? copyOf(vps[position])
            : {
                displaySetInstanceUIDs: [String(set.displaySetInstanceUID)],
                displaySetOptions: [{}],
                viewportOptions: { viewportId: cellId },
              },
      },
      [...vps.map(v => v.viewportId), cellId],
      true
    );
  };

  const remove = (state: GridState): void => {
    const vps = viewportsOf(state);
    const rest = vps.filter(v => !isCell(v));
    if (rest.length === vps.length) {
      return;
    }
    const sameAsBase =
      base !== null &&
      base.viewportIds.length === rest.length &&
      base.viewportIds.every((id, i) => rest[i]?.viewportId === id);
    let layout: { numRows: number; numCols: number; layoutOptions: CellBox[] };
    if (sameAsBase && base) {
      layout = base;
    } else {
      const cols = Math.max(1, Math.ceil(Math.sqrt(rest.length)));
      const rows = Math.max(1, Math.ceil(rest.length / cols));
      layout = { numRows: rows, numCols: cols, layoutOptions: gridBoxes(rows, cols, rest.length) };
    }
    const active = state.activeViewportId ?? null;
    const activeIsCell = active !== null && !rest.some(v => v.viewportId === active);
    setLayout(
      {
        numRows: layout.numRows,
        numCols: layout.numCols,
        layoutOptions: layout.layoutOptions,
        activeViewportId: (activeIsCell ? base?.activeViewportId : active) ?? undefined,
        isHangingProtocolLayout: sameAsBase,
        findOrCreateViewport: (position: number) =>
          position < rest.length ? copyOf(rest[position]) : undefined,
      },
      rest.map(v => v.viewportId),
      false
    );
  };

  /** Look at the grid and put the cell in, or take it out. */
  const look = (): void => {
    timer = null;
    if (destroyed) {
      return;
    }
    const state = grid.getState();
    if (!state) {
      return;
    }
    if (expected !== null) {
      const ids = viewportsOf(state).map(v => v.viewportId);
      if (
        signatureOf(state.layout.numRows, state.layout.numCols, ids) === expected ||
        !settling()
      ) {
        // Ours has come (or never will): the grid is as it is.
        expected = null;
      } else {
        later();
        return;
      }
    }
    // A series dropped on the cell: the reader's choice, out until the 3D button.
    const dropped = cellViewportId ? state.viewports.get(cellViewportId) : undefined;
    if (dropped && !isCell(dropped)) {
      out = true;
      forced = false;
      cellViewportId = null;
    }
    const isShown = viewportsOf(state).some(isCell);
    if (want()) {
      if (!isShown && (forced || showsStage(state))) {
        augment(state);
      }
      forced = false;
    } else if (isShown) {
      remove(state);
    }
    notify();
  };
  /** Look a moment after a change (coalesced). */
  const later = (): void => {
    if (destroyed || timer !== null) {
      return;
    }
    timer = setTimeout(look, lookMs);
  };

  const subs: Subscription[] = [
    hp.subscribe(hp.EVENTS.PROTOCOL_CHANGED, later),
    grid.subscribe(grid.EVENTS.LAYOUT_CHANGED, later),
    grid.subscribe(grid.EVENTS.GRID_STATE_CHANGED, later),
  ];
  const offStore = store.subscribe(later);

  const cell: Anatomy3dCell = {
    store,
    enter(s) {
      if (s === study) {
        return;
      }
      study = s;
      out = false;
      forced = false;
      displaySet = null;
      base = null;
      cellViewportId = null;
      later();
      notify();
    },
    leave() {
      study = null;
      out = false;
      forced = false;
      displaySet = null;
      base = null;
      cellViewportId = null;
      notify();
    },
    setting,
    setSetting(on) {
      try {
        deps.storage.set(on ? 'on' : 'off');
      } catch (_) {
        /* a private window: on for this page only */
      }
      if (on) {
        out = false;
      }
      later();
      notify();
    },
    inGrid: () => setting() && canDraw(),
    shown: shownSoon,
    toggle() {
      if (shownSoon()) {
        out = true;
        forced = false;
      } else {
        out = false;
        forced = true;
      }
      later();
      notify();
    },
    hide() {
      out = true;
      forced = false;
      later();
      notify();
    },
    series: () => seriesWithSurfaces(store.getSnapshot()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => changes,
    harnessState() {
      const state = grid.getState();
      const vps = viewportsOf(state);
      const at = vps.findIndex(isCell);
      return {
        setting: setting(),
        shown: at >= 0,
        out,
        fromProtocol: state ? showsStage(state) : false,
        layout: state ? `${state.layout.numRows}x${state.layout.numCols}` : null,
        panes: vps.length,
        cellPane: at >= 0 ? at : null,
        series: seriesWithSurfaces(store.getSnapshot()),
      };
    },
    destroy() {
      destroyed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      subs.forEach(s => s.unsubscribe?.());
      offStore();
      listeners.clear();
      if (current === cell) {
        current = null;
      }
    },
  };
  current = cell;
  return cell;
}
