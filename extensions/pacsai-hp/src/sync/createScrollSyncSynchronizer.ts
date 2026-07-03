import {
  getEnabledElementByViewportId,
  Enums as CoreEnums,
  utilities as csUtils,
} from '@cornerstonejs/core';
import { SynchronizerManager, Synchronizer } from '@cornerstonejs/tools';

const { createSynchronizer } = SynchronizerManager;

/**
 * Cross-study scroll synchronizer.
 *
 * The built-in `imageslice` synchronizer matches slices by world position within
 * a shared frame of reference, so it can't sync a current study against a prior
 * (different study / frame of reference). This synchronizer instead maps the
 * scrolled slice *proportionally* by index, so scrolling the current series moves
 * the matching prior viewport even when their slice counts differ.
 *
 * Registered as the `pacsaiscroll` sync type and attached per plane/sequence in
 * the comparison protocols (see buildCompareProtocol).
 *
 * DEBUGGING: set `window.PACSAI_DEBUG_SYNC = true` in the console for a throttled
 * per-event trace (no redeploy needed). Structural bail reasons — the "sync is bound
 * but silently dead, why?" cases — are warned ONCE per (pair, reason) regardless of
 * the flag, so a dead sync always leaves a fingerprint in the console.
 */

/** Runtime-flippable verbose trace: `window.PACSAI_DEBUG_SYNC = true` in the console. */
const verbose = () => (window as any).PACSAI_DEBUG_SYNC === true;
let lastTraceLog = 0;
const trace = (msg: string, data: Record<string, unknown>) => {
  if (!verbose() || Date.now() - lastTraceLog < 500) {
    return;
  }
  lastTraceLog = Date.now();
  console.log(`[pacsai-hp] pacsaiscroll ${msg}`, data);
};

// A structural bail means the sync will NEVER fire for this pair until something
// changes (wrong viewport type, empty stack) — warn once per (pair, reason) so it's
// visible without the verbose flag but can't flood the console.
const warnedBails = new Set<string>();
const warnBailOnce = (reason: string, srcId: string, tgtId: string, data?: unknown) => {
  const key = `${srcId}|${tgtId}|${reason}`;
  if (warnedBails.has(key)) {
    return;
  }
  warnedBails.add(key);
  console.warn(`[pacsai-hp] pacsaiscroll DEAD for pair — ${reason}`, {
    source: srcId,
    target: tgtId,
    ...(data ? { detail: data } : {}),
  });
};

export default function createScrollSyncSynchronizer(
  synchronizerName: string,
  _options?: Record<string, unknown>
): Synchronizer {
  // Ping-pong guards: `updating` covers synchronous re-entry; `lastProgrammatic`
  // covers the ASYNC echo — jumpToSlice fires STACK_NEW_IMAGE after `updating` has
  // reset, so we also ignore the event that lands a viewport exactly where we just
  // put it. The proportional round-trip isn't an exact fixed point for unequal slice
  // counts, so at high event rates (cine / momentum / minimap drag) the idempotent
  // check alone would let the panes nudge each other. (Same guard as the all-in-one
  // synchronizer, ported ahead of the cine/minimap features.)
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

    // Stack viewports only — needs index getters and an element to scroll.
    if (
      !source?.getCurrentImageIdIndex ||
      !source?.getImageIds ||
      !target?.getCurrentImageIdIndex ||
      !target?.getImageIds ||
      !target?.element
    ) {
      warnBailOnce('not a stack viewport (volume hang / not enabled yet?)', sourceViewport.viewportId, targetViewport.viewportId, {
        sourceIsStack: !!source?.getCurrentImageIdIndex,
        targetIsStack: !!target?.getCurrentImageIdIndex,
        sourceEnabled: !!source,
        targetEnabled: !!target,
      });
      return;
    }

    const srcCount = source.getImageIds().length;
    const tgtCount = target.getImageIds().length;
    if (!srcCount || !tgtCount) {
      warnBailOnce('empty image stack', sourceViewport.viewportId, targetViewport.viewportId, {
        srcCount,
        tgtCount,
      });
      return;
    }

    const srcIdx = source.getCurrentImageIdIndex();

    // Echo suppression: ignore the STACK_NEW_IMAGE we caused by jumping THIS viewport
    // (lands on the index we just set, within a short window) so the bidirectional
    // sync doesn't ping-pong and jerk the pane the user is scrolling.
    const echo = lastProgrammatic.get(sourceViewport.viewportId);
    if (echo && echo.index === srcIdx && Date.now() - echo.time < 600) {
      lastProgrammatic.delete(sourceViewport.viewportId);
      trace('echo suppressed', { viewportId: sourceViewport.viewportId, index: srcIdx });
      return;
    }

    // Proportional mapping so differing slice counts still track top-to-bottom.
    const frac = srcCount > 1 ? srcIdx / (srcCount - 1) : 0;
    const tgtIdx = Math.min(tgtCount - 1, Math.max(0, Math.round(frac * (tgtCount - 1))));

    trace('map', {
      source: sourceViewport.viewportId,
      target: targetViewport.viewportId,
      srcIdx,
      srcCount,
      tgtIdx,
      tgtCount,
    });

    // Idempotent: if the target is already there, do nothing (also stops ping-pong).
    if (tgtIdx === target.getCurrentImageIdIndex()) {
      return;
    }

    // Remember this programmatic move so the target's resulting STACK_NEW_IMAGE
    // (which fires async, after `updating` resets) is recognized as our echo.
    lastProgrammatic.set(targetViewport.viewportId, { index: tgtIdx, time: Date.now() });
    updating = true;
    try {
      // Use jumpToSlice (the same call the scrollbar uses) so it fires
      // STACK_VIEWPORT_SCROLL — this keeps the scrollbar and instance-number
      // overlay in sync, which a raw setImageIdIndex does not.
      csUtils.jumpToSlice(target.element, { imageIndex: tgtIdx, debounceLoading: true });
    } finally {
      updating = false;
    }
  };

  return createSynchronizer(synchronizerName, CoreEnums.Events.STACK_NEW_IMAGE, callback);
}
