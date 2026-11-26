/**
 * RS-38, the refine tool's gesture, without cornerstone: what a mouse-down,
 * a drag and a mouse-up do (PacsaiRefineTool hands them over). A mark is taken
 * only on a stack viewport, as SAM2CT takes a mark on one of the series' own
 * slices; its points are the image's (refineViewport.imageWorld).
 */
import type { CornerstoneApi } from '../anatomy/anatomyOverlay';
import type { RefineStore } from './refineStore';
import { imageWorld, isStackViewport, shownImageOf, type RefineViewport } from './refineViewport';

export const NOT_ON_SLICES = 'Draw on the series’ own slices (a stack view), not a reformat.';

export interface RefineMouseDetail {
  element: HTMLElement;
  viewportId: string;
  currentPoints: { world: ArrayLike<number>; canvas: ArrayLike<number> };
}

export interface RefineGestureDeps {
  store: () => RefineStore | null;
  viewportOf: (element: HTMLElement) => RefineViewport | null;
  metaData: CornerstoneApi['metaData'];
}

export interface RefineGesture {
  /** Whether the mouse-down was the tool's (cornerstone then does nothing else with it). */
  down(detail: RefineMouseDetail): boolean;
  drag(detail: RefineMouseDetail): void;
  up(detail: RefineMouseDetail | null | undefined): void;
  readonly marking: boolean;
}

/** The tool's gesture, without cornerstone: what a mouse-down, drag and up do. */
export function createRefineGesture(deps: RefineGestureDeps): RefineGesture {
  let start: { element: HTMLElement; viewportId: string; canvas: [number, number] } | null = null;

  const distance = (d: RefineMouseDetail) =>
    start
      ? Math.hypot(
          d.currentPoints.canvas[0] - start.canvas[0],
          d.currentPoints.canvas[1] - start.canvas[1]
        )
      : 0;

  return {
    down(d) {
      const store = deps.store();
      if (!store) {
        return false;
      }
      const vp = deps.viewportOf(d.element);
      if (!isStackViewport(vp)) {
        start = null;
        store.refuseMark(d.viewportId, NOT_ON_SLICES);
        return true;
      }
      start = {
        element: d.element,
        viewportId: d.viewportId,
        canvas: [d.currentPoints.canvas[0], d.currentPoints.canvas[1]],
      };
      store.beginMark(d.viewportId, imageWorld(deps.metaData, vp, d.currentPoints.world));
      return true;
    },
    drag(d) {
      const store = deps.store();
      if (!store || !start || d.element !== start.element) {
        return;
      }
      const vp = deps.viewportOf(d.element);
      if (vp) {
        store.moveMark(imageWorld(deps.metaData, vp, d.currentPoints.world), distance(d));
      }
    },
    up(d) {
      const store = deps.store();
      const s = start;
      if (!store || !s) {
        start = null;
        return;
      }
      const vp = deps.viewportOf(s.element);
      if (vp && d?.currentPoints && d.element === s.element) {
        store.moveMark(imageWorld(deps.metaData, vp, d.currentPoints.world), distance(d));
      }
      start = null;
      store.endMark(vp ? shownImageOf(deps.metaData, vp) : null);
    },
    get marking() {
      return start !== null;
    },
  };
}
