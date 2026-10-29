/**
 * Rev 11 milestone 6, approach C, F58 (29 Oct 2026): Hold / Back, the viewer's
 * half. What a held place keeps of the images, and putting it back, through
 * OHIF's own services:
 *
 *   - the grid: its layout and each position's viewport (series and options),
 *     kept and set back as OHIF's own one-up toggle keeps and restores them
 *     (`viewportGridService.setLayout` with each position's viewport);
 *   - each viewport's view, from cornerstone: its slice (the view reference),
 *     zoom, pan and rotation (the view presentation) and window/level (VOI),
 *     applied once the viewport shows its series again;
 *   - the active viewport.
 *
 * A series that is no longer in the study is not guessed at: its position
 * keeps the viewport it has now (or none, when that position is new), and the
 * caller names it. The study's series, by number, say what arrived meanwhile.
 * No patient data is kept or named.
 */
import { seriesLabel, type SeriesSeen } from './placeModel';

interface GridViewport {
  viewportId: string;
  positionId?: string;
  displaySetInstanceUIDs?: string[];
  [k: string]: unknown;
}
interface GridState {
  layout: { numRows: number; numCols: number; [k: string]: unknown };
  viewports: Map<string, GridViewport>;
  activeViewportId: string | null;
  [k: string]: unknown;
}
interface VoiRange {
  lower: number;
  upper: number;
}
interface CsViewport {
  getViewReference?: () => unknown;
  setViewReference?: (ref: unknown) => void;
  getViewPresentation?: (selector?: unknown) => unknown;
  setViewPresentation?: (presentation: unknown) => void;
  getProperties?: () => { voiRange?: VoiRange } | undefined;
  setProperties?: (properties: unknown) => void;
  getCurrentImageIdIndex?: () => number;
  getCurrentImageId?: () => string | undefined;
  getImageIds?: () => string[];
  getDefaultActor?: () => unknown;
  getZoom?: () => number;
  render?: () => void;
}
interface DisplaySetLike {
  displaySetInstanceUID: string;
  StudyInstanceUID?: string;
  SeriesNumber?: unknown;
}
export interface ViewerServices {
  viewportGridService: {
    getState: () => GridState;
    setLayout: (options: Record<string, unknown>) => Promise<void> | void;
    getLayoutOptionsFromState: (state: GridState) => unknown;
    getDisplaySetsUIDsForViewport?: (viewportId: string) => string[] | undefined;
    setActiveViewportId: (viewportId: string) => void;
  };
  cornerstoneViewportService: {
    getCornerstoneViewport: (viewportId: string) => CsViewport | null | undefined;
  };
  displaySetService: {
    getDisplaySetByUID: (uid: string) => DisplaySetLike | undefined;
    getActiveDisplaySets: () => DisplaySetLike[];
  };
}

export interface HeldViewport {
  viewportId: string;
  positionId: string | null;
  displaySetInstanceUIDs: string[];
  /** The series as the line names it ("series 4"). */
  series: string;
  view: {
    reference: unknown;
    presentation: unknown;
    voiRange: VoiRange | null;
    imageIndex: number | null;
  } | null;
}

export interface HeldView {
  grid: GridState;
  viewports: HeldViewport[];
}

export interface ViewerPlace {
  capture: () => HeldView | null;
  /** Puts the held images back; the series that could not be (no longer in the study). */
  restore: (held: HeldView) => Promise<{ missing: string[] }>;
  /** The study's series now (all studies' when none is named). */
  series: (studyInstanceUid: string | null) => SeriesSeen[];
}

/** How long a viewport may take to show its series again before its view is left. */
export const VIEW_READY_MS = 15_000;
/** OHIF applies its own remembered view to a viewport that shows a series again;
 *  the held view is checked this long after, and applied again where it was undone. */
export const VIEW_SETTLE_MS = 400;

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

const rangeOf = (r: VoiRange | undefined): VoiRange | null =>
  r && Number.isFinite(r.lower) && Number.isFinite(r.upper)
    ? { lower: r.lower, upper: r.upper }
    : null;

const sleep = (win: Window, ms: number) =>
  new Promise<void>(resolve => win.setTimeout(resolve, ms));

export function createViewerPlace(services: () => ViewerServices | null, win: Window): ViewerPlace {
  const csOf = (s: ViewerServices, viewportId: string): CsViewport | null => {
    try {
      return s.cornerstoneViewportService.getCornerstoneViewport(viewportId) ?? null;
    } catch (_) {
      return null;
    }
  };

  const viewOf = (cs: CsViewport | null): HeldViewport['view'] => {
    if (!cs) {
      return null;
    }
    try {
      return {
        reference: cs.getViewReference?.() ?? null,
        presentation: cs.getViewPresentation?.({ zoom: true, pan: true, rotation: true }) ?? null,
        voiRange: rangeOf(cs.getProperties?.()?.voiRange),
        imageIndex:
          typeof cs.getCurrentImageIdIndex === 'function' ? cs.getCurrentImageIdIndex() : null,
      };
    } catch (_) {
      return null;
    }
  };

  const capture = (): HeldView | null => {
    const s = services();
    if (!s) {
      return null;
    }
    let state: GridState;
    try {
      state = s.viewportGridService.getState();
    } catch (_) {
      return null;
    }
    if (!state?.viewports || !state.layout) {
      return null;
    }
    const viewports: HeldViewport[] = [];
    for (const vp of state.viewports.values()) {
      const uids = [...(vp.displaySetInstanceUIDs ?? [])];
      let ds: DisplaySetLike | undefined;
      try {
        ds = uids[0] ? s.displaySetService.getDisplaySetByUID(uids[0]) : undefined;
      } catch (_) {
        ds = undefined;
      }
      viewports.push({
        viewportId: vp.viewportId,
        positionId: typeof vp.positionId === 'string' ? vp.positionId : null,
        displaySetInstanceUIDs: uids,
        series: seriesLabel(ds?.SeriesNumber),
        view: viewOf(csOf(s, vp.viewportId)),
      });
    }
    return {
      grid: { ...state, layout: { ...state.layout }, viewports: new Map(state.viewports) },
      viewports,
    };
  };

  const shows = (s: ViewerServices, v: HeldViewport): CsViewport | null => {
    let uids: string[] | undefined;
    try {
      uids = s.viewportGridService.getDisplaySetsUIDsForViewport?.(v.viewportId);
    } catch (_) {
      uids = undefined;
    }
    if (!sameList(uids, v.displaySetInstanceUIDs)) {
      return null;
    }
    const cs = csOf(s, v.viewportId);
    if (!cs) {
      return null;
    }
    try {
      const hasImage = !!cs.getCurrentImageId?.() || (cs.getImageIds?.()?.length ?? 0) > 0;
      return hasImage || !!cs.getDefaultActor?.() ? cs : null;
    } catch (_) {
      return null;
    }
  };

  const apply = (cs: CsViewport, view: NonNullable<HeldViewport['view']>) => {
    try {
      if (view.reference && cs.setViewReference) {
        cs.setViewReference(view.reference);
      }
    } catch (_) {
      /* the slice stays */
    }
    try {
      if (view.presentation && cs.setViewPresentation) {
        cs.setViewPresentation(view.presentation);
      }
    } catch (_) {
      /* zoom and pan stay */
    }
    try {
      if (view.voiRange && cs.setProperties) {
        cs.setProperties({ voiRange: view.voiRange });
      }
    } catch (_) {
      /* the window stays */
    }
    try {
      cs.render?.();
    } catch (_) {
      /* drawn at the next frame */
    }
  };

  /** Whether a viewport shows the held view (slice and window), as far as it can tell. */
  const showsView = (cs: CsViewport, view: NonNullable<HeldViewport['view']>): boolean => {
    try {
      if (view.imageIndex !== null && typeof cs.getCurrentImageIdIndex === 'function') {
        if (cs.getCurrentImageIdIndex() !== view.imageIndex) {
          return false;
        }
      }
      const voi = rangeOf(cs.getProperties?.()?.voiRange);
      if (view.voiRange && voi) {
        return voi.lower === view.voiRange.lower && voi.upper === view.voiRange.upper;
      }
      return true;
    } catch (_) {
      return true;
    }
  };

  const restore = async (held: HeldView): Promise<{ missing: string[] }> => {
    const s = services();
    if (!s) {
      return { missing: [] };
    }
    const missing = held.viewports.filter(v =>
      v.displaySetInstanceUIDs.some(uid => {
        try {
          return !s.displaySetService.getDisplaySetByUID(uid);
        } catch (_) {
          return true;
        }
      })
    );
    const missingIds = new Set(missing.map(v => v.viewportId));
    const now = s.viewportGridService.getState();
    const nowViewports = [...now.viewports.values()];
    const sameGrid =
      now.layout.numRows === held.grid.layout.numRows &&
      now.layout.numCols === held.grid.layout.numCols &&
      held.viewports.every(v => {
        if (missingIds.has(v.viewportId)) {
          return true;
        }
        const current = now.viewports.get(v.viewportId);
        return !!current && sameList(current.displaySetInstanceUIDs, v.displaySetInstanceUIDs);
      });
    if (!sameGrid) {
      const heldAt = new Map<string, GridViewport>();
      for (const vp of held.grid.viewports.values()) {
        if (typeof vp.positionId === 'string') {
          heldAt.set(vp.positionId, vp);
        }
      }
      // As OHIF's one-up toggle: each position gets its held viewport, but a
      // series no longer in the study keeps what is there now (or nothing).
      const findOrCreateViewport = (_position: number, positionId: string) => {
        const want = heldAt.get(positionId);
        const current = nowViewports.find(v => v.positionId === positionId);
        if (!want) {
          return current ?? {};
        }
        if (missingIds.has(want.viewportId)) {
          return current ?? { ...want, displaySetInstanceUIDs: [] };
        }
        return want;
      };
      await s.viewportGridService.setLayout({
        numRows: held.grid.layout.numRows,
        numCols: held.grid.layout.numCols,
        activeViewportId: held.grid.activeViewportId,
        layoutOptions: s.viewportGridService.getLayoutOptionsFromState(held.grid),
        findOrCreateViewport,
        isHangingProtocolLayout: true,
      });
    }
    const toApply = held.viewports.filter(v => !missingIds.has(v.viewportId) && v.view);
    const ready = new Map<string, CsViewport>();
    const until = Date.now() + VIEW_READY_MS;
    while (ready.size < toApply.length && Date.now() < until) {
      for (const v of toApply) {
        if (!ready.has(v.viewportId)) {
          const cs = shows(s, v);
          if (cs) {
            ready.set(v.viewportId, cs);
            apply(cs, v.view as NonNullable<HeldViewport['view']>);
          }
        }
      }
      if (ready.size < toApply.length) {
        await sleep(win, 100);
      }
    }
    // OHIF's own remembered view can land after the held one: checked once more.
    await sleep(win, VIEW_SETTLE_MS);
    for (const v of toApply) {
      const cs = csOf(s, v.viewportId);
      const view = v.view as NonNullable<HeldViewport['view']>;
      if (cs && ready.has(v.viewportId) && !showsView(cs, view)) {
        apply(cs, view);
      }
    }
    try {
      const active = held.grid.activeViewportId;
      if (active && s.viewportGridService.getState().viewports.has(active)) {
        s.viewportGridService.setActiveViewportId(active);
      }
    } catch (_) {
      /* the active viewport stays */
    }
    return { missing: missing.map(v => v.series) };
  };

  const series = (studyInstanceUid: string | null): SeriesSeen[] => {
    const s = services();
    if (!s) {
      return [];
    }
    try {
      return s.displaySetService
        .getActiveDisplaySets()
        .filter(ds => !studyInstanceUid || ds.StudyInstanceUID === studyInstanceUid)
        .map(ds => ({ uid: ds.displaySetInstanceUID, label: seriesLabel(ds.SeriesNumber) }));
    } catch (_) {
      return [];
    }
  };

  return { capture, restore, series };
}
