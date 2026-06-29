import { cache, eventTarget, imageLoadPoolManager, imageLoader, Enums } from '@cornerstonejs/core';
import { setPrefetchSet, markPrefetchLoaded } from './prefetchProgress';

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

  // imageIds added to the pool during the CURRENT enqueue pass, so the same series
  // shown in two panes isn't queued twice. Reset each pass (cache.getImageLoadObject
  // covers already-loaded + in-flight across passes).
  const enqueued = new Set<string>();

  // Signature of the last layout we prefetched (sorted visible displaySet UIDs).
  // When it changes — notably the transient default layout -> hanging-protocol
  // layout swap, and each stage change — we drop the stale queued prefetch and
  // re-prioritize the now-visible layout. Unchanged settles (e.g. just clicking
  // between viewports) are skipped to avoid needless queue churn.
  let lastSignature = '';

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

    // Collect the visible viewports' displaySet UIDs (order-insensitive signature).
    const visibleUIDs: string[] = [];
    viewports.forEach((viewport: any) => {
      (viewport?.displaySetInstanceUIDs ?? []).forEach((uid: string) => visibleUIDs.push(uid));
    });
    const signature = [...new Set(visibleUIDs)].sort().join('|');
    if (signature === lastSignature) {
      return;
    }
    lastSignature = signature;

    // The visible layout changed (default -> HP layout, or a stage change). Drop any
    // prefetch still QUEUED for the previous layout so this layout's images don't
    // wait behind them; then re-queue from scratch. In-flight requests can't be
    // cancelled (no AbortController in cs3D yet), so a few stale loads still finish,
    // but the bulk of the queue is reclaimed. Interaction/Thumbnail are separate pool
    // buckets and are untouched, so user scrolling is unaffected.
    imageLoadPoolManager.clearRequestStack(REQUEST_TYPE);
    enqueued.clear();

    // Gather each displayed stack's still-needed imageIds, then enqueue round-robin
    // so every visible viewport advances together instead of one filling first.
    // `allImageIds` is the full (unfiltered) set = the progress denominator the chip
    // reports; `stacks` is the still-needed subset we actually queue.
    const allImageIds: string[] = [];
    const stacks: string[][] = [];
    new Set(visibleUIDs).forEach((uid: string) => {
      const ids = getImageIds(uid);
      ids.forEach(id => allImageIds.push(id));
      const needed = ids.filter(id => !isPending(id));
      if (needed.length) {
        stacks.push(needed);
      }
    });

    setPrefetchSet(allImageIds);

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
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(prefetchVisibleViewports, SETTLE_DEBOUNCE_MS);
  };

  // Advance the shared progress store as images finish loading (prefetched or
  // user-driven — either way the visible layout is now more complete).
  eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, (evt: any) => {
    markPrefetchLoaded(evt?.detail?.image?.imageId);
  });

  const { EVENTS } = viewportGridService;
  // VIEWPORTS_READY = a fresh study open — force a re-run even if the displaySet UIDs
  // happen to match the last study (its cache was cleared on mode exit).
  viewportGridService.subscribe(EVENTS.VIEWPORTS_READY, () => {
    lastSignature = '';
    schedule();
  });
  // Subsequent in-study settles (stage change, layout change, new active series).
  [EVENTS.LAYOUT_CHANGED, EVENTS.GRID_STATE_CHANGED, EVENTS.ACTIVE_VIEWPORT_ID_CHANGED].forEach(
    evt => viewportGridService.subscribe(evt, () => schedule())
  );
}

export default initViewportPrefetch;
