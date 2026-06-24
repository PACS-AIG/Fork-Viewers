import {
  getEnabledElementByViewportId,
  Enums as CoreEnums,
  utilities as csUtils,
  metaData,
} from '@cornerstonejs/core';
import { SynchronizerManager, Synchronizer } from '@cornerstonejs/tools';

const { createSynchronizer } = SynchronizerManager;

/**
 * Plane-aware cross-study scroll synchronizer for the ALL-IN-ONE compare layout.
 *
 * An all-in-one stack concatenates every series of a study (sorted by series number),
 * so current and prior all-in-ones have different lengths AND interleave planes
 * differently — a plain proportional sync (`pacsaiscroll`) would put a sagittal slice
 * opposite an axial one. Instead this groups each stack's images BY PLANE (from
 * ImageOrientationPatient) and maps within the group: when the current image is the
 * k-th of its sagittal images, the prior jumps to the proportionally-k-th of ITS
 * sagittal images — so scrolling sagittals shows sagittals, axials show axials, etc.
 * If the prior has no images of the current plane, it's left where it is.
 *
 * Registered as the `pacsaiallinonescroll` sync type and attached to the all-in-one
 * current|prior compare stage (see buildCompareProtocol / hpAllInOne).
 */

/** Coerce a vec3-like (array or Float32Array) to a clean [x,y,z], or undefined. */
function vec3(x: any): number[] | undefined {
  if (!x || typeof x.length !== 'number' || x.length < 3) {
    return undefined;
  }
  const a = [Number(x[0]), Number(x[1]), Number(x[2])];
  return a.some(n => Number.isNaN(n)) ? undefined : a;
}

/**
 * Image plane from orientation: dominant slice-normal axis (normal ∥ S-I = axial,
 * ∥ L-R = sagittal, ∥ A-P = coronal). cornerstone's imagePlaneModule exposes the
 * orientation as rowCosines/columnCosines (fall back to a raw imageOrientationPatient).
 */
function planeOfImageId(imageId: string): string | undefined {
  const m = metaData.get('imagePlaneModule', imageId) as any;
  if (!m) {
    return undefined;
  }
  let row = vec3(m.rowCosines);
  let col = vec3(m.columnCosines);
  if (!row || !col) {
    const iop = m.imageOrientationPatient;
    if (iop && iop.length >= 6) {
      row = vec3([iop[0], iop[1], iop[2]]);
      col = vec3([iop[3], iop[4], iop[5]]);
    }
  }
  if (!row || !col) {
    return undefined;
  }
  // slice normal = row x col
  const nx = Math.abs(row[1] * col[2] - row[2] * col[1]);
  const ny = Math.abs(row[2] * col[0] - row[0] * col[2]);
  const nz = Math.abs(row[0] * col[1] - row[1] * col[0]);
  if (nz >= nx && nz >= ny) {
    return 'axial';
  }
  return nx >= ny ? 'sagittal' : 'coronal';
}

// Memoize the per-stack plane array (keyed by a cheap signature) so we don't re-read
// metadata for every image on every scroll tick. Bounded to a few stacks.
const planeCache = new Map<string, Array<string | undefined>>();
function planesFor(imageIds: string[]): Array<string | undefined> {
  const sig = `${imageIds.length}|${imageIds[0]}|${imageIds[imageIds.length - 1]}`;
  let planes = planeCache.get(sig);
  if (!planes) {
    planes = imageIds.map(planeOfImageId);
    planeCache.set(sig, planes);
    if (planeCache.size > 32) {
      planeCache.delete(planeCache.keys().next().value as string);
    }
  }
  return planes;
}

/** Global indices of the images whose plane equals `plane`, in stack order. */
function planeGroup(planes: Array<string | undefined>, plane: string): number[] {
  const group: number[] = [];
  for (let i = 0; i < planes.length; i++) {
    if (planes[i] === plane) {
      group.push(i);
    }
  }
  return group;
}

export default function createAllInOneScrollSynchronizer(
  synchronizerName: string,
  _options?: Record<string, unknown>
): Synchronizer {
  // Guard against the ping-pong that target updates could otherwise cause.
  let updating = false;

  const callback = (
    _synchronizer: Synchronizer,
    sourceViewport: { viewportId: string },
    targetViewport: { viewportId: string }
  ) => {
    if (updating) {
      return;
    }

    const source = getEnabledElementByViewportId(sourceViewport.viewportId)?.viewport as any;
    const target = getEnabledElementByViewportId(targetViewport.viewportId)?.viewport as any;

    if (
      !source?.getCurrentImageIdIndex ||
      !source?.getImageIds ||
      !target?.getCurrentImageIdIndex ||
      !target?.getImageIds ||
      !target?.element
    ) {
      return;
    }

    const srcIds: string[] = source.getImageIds();
    const tgtIds: string[] = target.getImageIds();
    if (!srcIds?.length || !tgtIds?.length) {
      return;
    }

    const srcIdx = source.getCurrentImageIdIndex();
    const srcPlanes = planesFor(srcIds);
    const plane = srcPlanes[srcIdx];
    if (!plane) {
      return;
    }

    // Position of the current image within its same-plane group.
    const srcGroup = planeGroup(srcPlanes, plane);
    const srcPos = srcGroup.indexOf(srcIdx);
    if (srcPos < 0) {
      return;
    }
    const frac = srcGroup.length > 1 ? srcPos / (srcGroup.length - 1) : 0;

    // Map proportionally into the target's same-plane group; if it has none of this
    // plane, leave the target alone (can't show a plane the prior doesn't have).
    const tgtGroup = planeGroup(planesFor(tgtIds), plane);
    if (!tgtGroup.length) {
      return;
    }
    const tgtPos = Math.min(tgtGroup.length - 1, Math.max(0, Math.round(frac * (tgtGroup.length - 1))));
    const tgtIdx = tgtGroup[tgtPos];

    // Idempotent: if already there, do nothing (also stops the bidirectional ping-pong).
    if (tgtIdx === target.getCurrentImageIdIndex()) {
      return;
    }

    updating = true;
    try {
      // jumpToSlice (the scrollbar's call) fires STACK_VIEWPORT_SCROLL so the scrollbar
      // and instance-number overlay stay in sync, which a raw setImageIdIndex does not.
      csUtils.jumpToSlice(target.element, { imageIndex: tgtIdx, debounceLoading: true });
    } finally {
      updating = false;
    }
  };

  return createSynchronizer(synchronizerName, CoreEnums.Events.STACK_NEW_IMAGE, callback);
}
