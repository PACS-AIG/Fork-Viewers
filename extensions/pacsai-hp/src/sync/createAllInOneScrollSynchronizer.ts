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
 * opposite an axial one. Instead, for the current image's plane (from its orientation)
 * it sweeps the prior's LARGEST contiguous run of that plane, in proportion to where the
 * user is within the current's images of that plane. So scrolling the current's
 * sagittals sweeps the prior's main sagittal series in step — neither pane waits for the
 * other to finish a plane (proportional WITHIN plane, not whole-stack), and it stays
 * smooth (one contiguous run, no leaping across the prior's separate same-plane series,
 * which the series-number-sorted stack interleaves). Falls back to a plain proportional
 * map when a plane can't be determined or the prior lacks it.
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

// Throttled debug logging to diagnose the sync (flip off once confirmed working).
const DEBUG_SYNC = true;
let lastSyncLog = 0;

export default function createAllInOneScrollSynchronizer(
  synchronizerName: string,
  _options?: Record<string, unknown>
): Synchronizer {
  // Ping-pong guards: `updating` covers synchronous re-entry; `lastProgrammatic`
  // covers the ASYNC echo — jumpToSlice fires STACK_NEW_IMAGE after `updating` has
  // reset, so we also ignore the event that lands a viewport exactly where we just
  // put it (the plane-matched round-trip isn't an exact fixed point, so the idempotent
  // check alone let the panes nudge each other endlessly).
  let updating = false;
  const lastProgrammatic = new Map<string, { index: number; time: number }>();

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

    // Echo suppression: ignore the STACK_NEW_IMAGE we caused by jumping THIS viewport
    // (lands on the index we just set, within a short window) so the bidirectional sync
    // doesn't ping-pong and jerk the pane the user is scrolling.
    const echo = lastProgrammatic.get(sourceViewport.viewportId);
    if (echo && echo.index === srcIdx && Date.now() - echo.time < 600) {
      lastProgrammatic.delete(sourceViewport.viewportId);
      return;
    }

    const srcPlanes = planesFor(srcIds);
    const plane = srcPlanes[srcIdx];
    const tgtPlanes = planesFor(tgtIds);

    let tgtIdx = -1;
    if (plane) {
      // Where the user is within ALL the source's images of this plane (0..1).
      const srcGroup: number[] = [];
      for (let i = 0; i < srcPlanes.length; i++) {
        if (srcPlanes[i] === plane) {
          srcGroup.push(i);
        }
      }
      const srcPos = Math.max(0, srcGroup.indexOf(srcIdx));
      const frac = srcGroup.length > 1 ? srcPos / (srcGroup.length - 1) : 0;

      // Sweep the LARGEST contiguous run of the same plane in the target, proportionally.
      // Proportional-WITHIN-plane (not whole-stack) means neither pane waits for the
      // other to finish a plane; using one contiguous run (not every same-plane image)
      // keeps it smooth — no leaping between the target's separate same-plane series,
      // which the series-number-sorted stack interleaves.
      let start = -1;
      let len = 0;
      let bestStart = -1;
      let bestLen = 0;
      for (let i = 0; i < tgtPlanes.length; i++) {
        if (tgtPlanes[i] === plane) {
          start = start < 0 ? i : start;
          len += 1;
          if (len > bestLen) {
            bestLen = len;
            bestStart = start;
          }
        } else {
          start = -1;
          len = 0;
        }
      }
      if (bestLen > 0) {
        tgtIdx = bestStart + Math.round(frac * (bestLen - 1));
      }
    }
    // Fallback: plane unknown, or the target has none of it — plain proportional.
    if (tgtIdx < 0) {
      const frac = srcIds.length > 1 ? srcIdx / (srcIds.length - 1) : 0;
      tgtIdx = Math.min(tgtIds.length - 1, Math.max(0, Math.round(frac * (tgtIds.length - 1))));
    }

    if (DEBUG_SYNC && Date.now() - lastSyncLog > 800) {
      lastSyncLog = Date.now();
      console.log('[pacsai-hp] allinone-sync', {
        plane,
        planeMatched: plane ? tgtPlanes[tgtIdx] === plane : false,
        srcIdx,
        srcCount: srcIds.length,
        tgtCount: tgtIds.length,
        tgtIdx,
      });
    }

    // Idempotent: if already there, do nothing (also stops the bidirectional ping-pong).
    if (tgtIdx === target.getCurrentImageIdIndex()) {
      return;
    }

    // Remember this programmatic move so the target's resulting STACK_NEW_IMAGE (which
    // fires async, after `updating` resets) is recognized as our echo and ignored.
    lastProgrammatic.set(targetViewport.viewportId, { index: tgtIdx, time: Date.now() });
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
