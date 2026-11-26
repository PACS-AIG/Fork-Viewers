/**
 * RS-38, the refine tool: what a viewport shows, as the tool and its overlay
 * need it. A mark is taken only on a stack viewport (the series' own slices),
 * and its points are the image's: on cornerstone's CPU path, its world reads
 * half a pixel off DICOM's (anatomyOverlay.cpuPixelShift), and that half pixel
 * is taken off here too.
 */
import type { Vec3 } from '../anatomy/anatomyGeometry';
import { cpuPixelShift, type CornerstoneApi } from '../anatomy/anatomyOverlay';
import type { ShownImage } from './refineHit';

/** What the tool and the overlay use of a cornerstone viewport. */
export interface RefineViewport {
  id: string;
  element: HTMLElement;
  canvasToWorld: (pos: [number, number]) => ArrayLike<number> | undefined;
  worldToCanvas?: (world: Vec3) => ArrayLike<number> | undefined;
  getImageIds?: () => string[];
  getCurrentImageId?: () => string | undefined;
  setImageIdIndex?: (index: number) => unknown;
  useCPURendering?: boolean;
}

/** A stack viewport: the series' own slices, one image at a time. */
export const isStackViewport = (vp: RefineViewport | null | undefined): vp is RefineViewport =>
  !!vp && typeof vp.setImageIdIndex === 'function' && typeof vp.getCurrentImageId === 'function';

/** The series and frame of reference of the image a viewport shows, or null. */
export function shownImageOf(
  metaData: CornerstoneApi['metaData'],
  vp: RefineViewport
): (ShownImage & { imageId: string }) | null {
  let imageId: string | undefined;
  try {
    imageId = vp.getCurrentImageId?.();
  } catch (_) {
    return null;
  }
  if (!imageId) {
    return null;
  }
  try {
    const series = metaData.get('generalSeriesModule', imageId) as
      | { seriesInstanceUID?: string }
      | undefined;
    const plane = metaData.get('imagePlaneModule', imageId) as
      | { frameOfReferenceUID?: string }
      | undefined;
    if (typeof series?.seriesInstanceUID !== 'string') {
      return null;
    }
    return {
      seriesUID: series.seriesInstanceUID,
      frameOfReferenceUID:
        typeof plane?.frameOfReferenceUID === 'string' ? plane.frameOfReferenceUID : null,
      imageId,
    };
  } catch (_) {
    return null;
  }
}

/** A world point the viewport gave, as the image's (the CPU path's half pixel taken off). */
export function imageWorld(
  metaData: CornerstoneApi['metaData'],
  vp: RefineViewport,
  world: ArrayLike<number>
): Vec3 {
  let imageId: string | undefined;
  try {
    imageId = vp.getCurrentImageId?.();
  } catch (_) {
    imageId = undefined;
  }
  const s = cpuPixelShift(metaData, vp.useCPURendering, imageId);
  return [world[0] - s[0], world[1] - s[1], world[2] - s[2]];
}

/** Where an image point is on the viewport's canvas (the CPU path's half pixel put back), or null. */
export function canvasOf(
  metaData: CornerstoneApi['metaData'],
  vp: RefineViewport,
  world: Vec3
): [number, number] | null {
  if (typeof vp.worldToCanvas !== 'function') {
    return null;
  }
  let imageId: string | undefined;
  try {
    imageId = vp.getCurrentImageId?.();
  } catch (_) {
    imageId = undefined;
  }
  const s = cpuPixelShift(metaData, vp.useCPURendering, imageId);
  try {
    const c = vp.worldToCanvas([world[0] + s[0], world[1] + s[1], world[2] + s[2]]);
    return c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [c[0], c[1]] : null;
  } catch (_) {
    return null;
  }
}
