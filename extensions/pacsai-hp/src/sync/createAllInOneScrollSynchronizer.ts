import {
  getEnabledElementByViewportId,
  Enums as CoreEnums,
  utilities as csUtils,
} from '@cornerstonejs/core';
import { SynchronizerManager, Synchronizer } from '@cornerstonejs/tools';

const { createSynchronizer } = SynchronizerManager;

/**
 * Cross-study scroll synchronizer for the ALL-IN-ONE compare layout.
 *
 * An all-in-one stack concatenates every series of a study (sorted by series number),
 * so the current and prior all-in-ones have different lengths and interleave planes in
 * different orders. We map the scrolled slice PROPORTIONALLY by whole-stack position
 * (0→100% of the source maps to 0→100% of the target), so both panes scroll
 * top-to-bottom together, the whole prior is covered, and the prior never skips a
 * region or snaps to the end.
 *
 * (We previously plane-matched — sagittal↔sagittal etc. — but strict plane alignment
 * and monotonic full-coverage are mutually exclusive when the two stacks interleave
 * planes differently: it left the prior stuck mid-stack and jumping to the end. Plain
 * proportional is monotonic and complete; for same-patient composites the planes line
 * up closely anyway. See git history for the plane-matched variant.)
 *
 * Differs from `pacsaiscroll` (used by the regular compare protocols) only by the
 * `lastProgrammatic` echo suppression below — the composites' lengths differ a lot
 * (e.g. 541 vs 924), so the proportional round-trip isn't an exact fixed point and the
 * idempotent check alone would let the panes ping-pong.
 *
 * Registered as the `pacsaiallinonescroll` sync type and attached to the all-in-one
 * current|prior compare stage (see buildCompareProtocol / hpAllInOne).
 */

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
  // put it (the proportional round-trip isn't an exact fixed point when the stacks
  // differ in length, so the idempotent check alone let the panes nudge each other).
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

    // Plain whole-stack proportional: differing slice counts still track top-to-bottom,
    // monotonically and over the full target.
    const frac = srcIds.length > 1 ? srcIdx / (srcIds.length - 1) : 0;
    const tgtIdx = Math.min(tgtIds.length - 1, Math.max(0, Math.round(frac * (tgtIds.length - 1))));

    if (DEBUG_SYNC && Date.now() - lastSyncLog > 800) {
      lastSyncLog = Date.now();
      console.log('[pacsai-hp] allinone-sync', {
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
