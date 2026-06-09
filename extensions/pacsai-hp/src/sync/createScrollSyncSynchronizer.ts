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
 */
export default function createScrollSyncSynchronizer(
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

    // Stack viewports only — needs index getters and an element to scroll.
    if (
      !source?.getCurrentImageIdIndex ||
      !source?.getImageIds ||
      !target?.getCurrentImageIdIndex ||
      !target?.getImageIds ||
      !target?.element
    ) {
      return;
    }

    const srcCount = source.getImageIds().length;
    const tgtCount = target.getImageIds().length;
    if (!srcCount || !tgtCount) {
      return;
    }

    const srcIdx = source.getCurrentImageIdIndex();
    // Proportional mapping so differing slice counts still track top-to-bottom.
    const frac = srcCount > 1 ? srcIdx / (srcCount - 1) : 0;
    const tgtIdx = Math.min(tgtCount - 1, Math.max(0, Math.round(frac * (tgtCount - 1))));

    // Idempotent: if the target is already there, do nothing (also stops ping-pong).
    if (tgtIdx === target.getCurrentImageIdIndex()) {
      return;
    }

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
