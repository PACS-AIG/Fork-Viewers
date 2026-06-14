import { cache, imageLoadPoolManager, imageLoader, Enums } from '@cornerstonejs/core';

/**
 * Background prefetcher for the VISIBLE viewports.
 *
 * cs3D's `stackContextPrefetch` fills each stack viewport but is re-driven by the
 * `STACK_NEW_IMAGE` event — i.e. scrolling. In a multi-viewport layout (e.g. a
 * whole-spine compare with several stacks hung at once) a background, non-interacted
 * viewport can therefore stall after its first few images until the user activates
 * it and scrolls. This loader sidesteps that quirk: whenever the layout settles, it
 * enqueues EVERY currently-displayed viewport's full stack into cornerstone's
 * Prefetch pool (skipping cached / already-queued imageIds), interleaved across
 * viewports so they fill evenly rather than one-at-a-time.
 *
 * Prefetch is a SEPARATE pool bucket from Interaction (`imageLoadPoolManager`
 * maxNumRequests is per-request-type — see init.tsx), so flooding it never blocks
 * the user's scroll/interaction loads. The cornerstone request pool throttles the
 * actual concurrency; we just make sure every visible image is queued.
 */

const REQUEST_TYPE = Enums.RequestType.Prefetch;

// Coalesce the burst of grid events fired during a single hang/stage change.
const SETTLE_DEBOUNCE_MS = 250;

function initViewportPrefetch(
  servicesManager: AppTypes.ServicesManager,
  extensionManager: AppTypes.ExtensionManager
): void {
  const { viewportGridService, displaySetService } = servicesManager.services;

  if (!viewportGridService || !displaySetService) {
    return;
  }

  // imageIds already handed to the pool. The cache check alone isn't enough: a
  // request that is queued-but-not-yet-started is not in the cache, so rapid
  // re-settles would enqueue it twice. Reset per study open (VIEWPORTS_READY) so a
  // reopened study whose cache was cleared on mode exit re-queues correctly.
  const enqueued = new Set<string>();

  const getImageIds = (displaySetInstanceUID: string): string[] => {
    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (!displaySet || displaySet.unsupported) {
      return [];
    }
    const dataSource = extensionManager.getActiveDataSource?.()?.[0];
    try {
      return dataSource?.getImageIdsForDisplaySet?.(displaySet) ?? displaySet.imageIds ?? [];
    } catch {
      return displaySet.imageIds ?? [];
    }
  };

  const isPending = (imageId: string): boolean =>
    !imageId || enqueued.has(imageId) || !!cache.getImageLoadObject(imageId);

  const enqueueImage = (imageId: string) => {
    if (isPending(imageId)) {
      return;
    }
    enqueued.add(imageId);
    imageLoadPoolManager.addRequest(
      () =>
        imageLoader
          .loadAndCacheImage(imageId, { requestType: REQUEST_TYPE, preScale: { enabled: true } })
          // A failed prefetch is dropped from the set so a later settle can retry it.
          .catch(() => enqueued.delete(imageId)),
      REQUEST_TYPE,
      { imageId }
    );
  };

  const prefetchVisibleViewports = () => {
    const { viewports } = viewportGridService.getState() ?? {};
    if (!viewports?.size) {
      return;
    }

    // Gather each displayed stack's still-needed imageIds, then enqueue round-robin
    // so every visible viewport advances together instead of one filling first.
    const stacks: string[][] = [];
    viewports.forEach((viewport: any) => {
      (viewport?.displaySetInstanceUIDs ?? []).forEach((uid: string) => {
        const imageIds = getImageIds(uid).filter(id => !isPending(id));
        if (imageIds.length) {
          stacks.push(imageIds);
        }
      });
    });

    const maxLen = stacks.reduce((m, s) => Math.max(m, s.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const stack of stacks) {
        if (i < stack.length) {
          enqueueImage(stack[i]);
        }
      }
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let resetRequested = false;
  const schedule = (reset: boolean) => {
    resetRequested = resetRequested || reset;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (resetRequested) {
        enqueued.clear();
        resetRequested = false;
      }
      prefetchVisibleViewports();
    }, SETTLE_DEBOUNCE_MS);
  };

  const { EVENTS } = viewportGridService;
  // VIEWPORTS_READY = a fresh study/layout — reset the dedupe set first.
  viewportGridService.subscribe(EVENTS.VIEWPORTS_READY, () => schedule(true));
  // Subsequent in-study settles (stage change, layout change, new active series).
  [EVENTS.LAYOUT_CHANGED, EVENTS.GRID_STATE_CHANGED, EVENTS.ACTIVE_VIEWPORT_ID_CHANGED].forEach(
    evt => viewportGridService.subscribe(evt, () => schedule(false))
  );
}

export default initViewportPrefetch;
