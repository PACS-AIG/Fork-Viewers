import React, { useEffect, useRef, useState } from 'react';
import { cache, eventTarget, Enums } from '@cornerstonejs/core';
import { Icons } from '@ohif/ui-next';
import { subscribePrefetchProgress, PrefetchProgress } from '../../prefetchProgress';

const { IMAGE_LOADED } = Enums.Events;

/**
 * Whole-series load progress for a viewport.
 *
 * The sibling `ViewportImageSliceLoadingIndicator` only reacts to
 * STACK_VIEWPORT_SCROLL — it shows "Loading..." when you scroll to a slice that
 * hasn't streamed in yet, but it stays silent on the INITIAL hang. So when a
 * stage lays out a fresh viewport and its images are still arriving (a slow prior,
 * a large series, a sluggish server), the pane just sits blank with no feedback —
 * indistinguishable from a broken/empty viewport.
 *
 * This overlay fills that gap: on new viewport data it counts how many of the
 * viewport's images are already cached and tracks the rest via cornerstone's
 * IMAGE_LOADED events, rendering a compact bottom-right chip ("Loading X% (n/N)"
 * + a thin progress bar) until the series is fully loaded, then removing itself.
 * The chip is non-blocking (corner-anchored, pointer-events-none) so the first
 * image stays fully visible while the rest streams in. If every image is already
 * cached (e.g. paging back to a stage whose series finished loading) it never
 * shows, so there's no flicker.
 *
 * Scoped to STACK viewports: `getImageIds()` + per-image `cache.getImage()` is a
 * reliable loaded-count for stacks, whereas volumes load through a separate cache
 * and would read here as perpetually unloaded. Volume viewports simply get no
 * indicator (they render progressively anyway).
 *
 * PREFETCH-AWARE FALLBACK: on a fast server the background prefetcher
 * (initViewportPrefetch) warms this pane's images before it even mounts, so the
 * own-stack count above seeds at 100% and the chip never shows — even though the
 * rest of the visible layout (other compare panes, or a huge all-in-one composite)
 * is still streaming. To keep feedback in that case, when this viewport's OWN stack
 * is already complete we fall back to the shared prefetch-progress store and show
 * "Prefetching X% (n/N)" for the whole visible layout. That fallback is rendered
 * only on the ACTIVE viewport so a multi-pane layout shows a single chip, not one
 * per pane. The own-stack "Loading…" always wins when present (it's the pane the
 * user is actually looking at / scrolling).
 */
function ViewportLoadingProgress({ viewportId, element, viewportData, servicesManager }: withAppTypes) {
  const { cornerstoneViewportService, viewportGridService } = servicesManager.services;
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [prefetch, setPrefetch] = useState<PrefetchProgress | null>(null);
  const [isActive, setIsActive] = useState(
    () => viewportGridService?.getActiveViewportId?.() === viewportId
  );
  // Mutable so the IMAGE_LOADED handler reads the latest set without re-subscribing.
  const stateRef = useRef<{ imageIds: Set<string>; loaded: Set<string>; total: number }>({
    imageIds: new Set(),
    loaded: new Set(),
    total: 0,
  });

  useEffect(() => {
    if (!element || !viewportData) {
      setProgress(null);
      return;
    }

    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!viewport || viewport.type !== Enums.ViewportType.STACK) {
      setProgress(null);
      return;
    }

    let imageIds: string[] = [];
    try {
      imageIds = viewport.getImageIds() ?? [];
    } catch {
      imageIds = [];
    }

    const total = imageIds.length;
    if (!total) {
      setProgress(null);
      return;
    }

    // Seed from the cache so an already-loaded series shows no indicator and a
    // partially-loaded one starts at the right percentage.
    const loaded = new Set<string>();
    imageIds.forEach(id => {
      if (cache.getImage(id)) {
        loaded.add(id);
      }
    });

    stateRef.current = { imageIds: new Set(imageIds), loaded, total };

    if (loaded.size >= total) {
      setProgress(null);
      return;
    }

    setProgress({ loaded: loaded.size, total });

    const onImageLoaded = evt => {
      const imageId = evt?.detail?.image?.imageId;
      const st = stateRef.current;
      if (!imageId || !st.imageIds.has(imageId) || st.loaded.has(imageId)) {
        return;
      }
      st.loaded.add(imageId);
      setProgress(
        st.loaded.size >= st.total ? null : { loaded: st.loaded.size, total: st.total }
      );
    };

    eventTarget.addEventListener(IMAGE_LOADED, onImageLoaded);
    return () => {
      eventTarget.removeEventListener(IMAGE_LOADED, onImageLoaded);
    };
  }, [element, viewportData, viewportId, cornerstoneViewportService]);

  // Track the shared background-prefetch progress (the whole visible layout).
  useEffect(() => subscribePrefetchProgress(setPrefetch), []);

  // Track whether this is the active viewport so only one prefetch chip shows.
  useEffect(() => {
    if (!viewportGridService) {
      return;
    }
    const sync = () => setIsActive(viewportGridService.getActiveViewportId() === viewportId);
    sync();
    const { unsubscribe } = viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      sync
    );
    return () => unsubscribe();
  }, [viewportGridService, viewportId]);

  // Own stack still streaming wins (this is the pane being viewed). Otherwise, on the
  // active viewport, surface the background prefetch for the rest of the layout.
  const active = progress ?? (isActive ? prefetch : null);

  // Bringup debug: log the active pane's render decision only when it changes.
  const lastDecision = useRef<string>('');
  if (isActive) {
    const decision = active
      ? `${progress ? 'Loading' : 'Prefetching'} ${active.loaded}/${active.total}`
      : `hidden (own=${progress ? 'loading' : 'done'} prefetch=${prefetch ? `${prefetch.loaded}/${prefetch.total}` : 'null'})`;
    if (decision !== lastDecision.current) {
      lastDecision.current = decision;
      // eslint-disable-next-line no-console
      console.log(`[pacsai-prefetch] chip(${viewportId}) ${decision}`);
    }
  }

  if (!active) {
    return null;
  }
  const isPrefetch = !progress;

  const percentComplete = Math.floor((active.loaded / active.total) * 100);

  // Compact corner chip — non-blocking, so the first image stays fully visible
  // while the rest of the series streams in behind it. Sits just above the
  // bottom-right slice-index overlay so the two don't overlap.
  return (
    <div className="pointer-events-none absolute bottom-8 right-2 z-50 flex flex-col gap-1 rounded bg-black/60 px-2 py-1">
      <div className="flex items-center gap-2 text-xs text-white">
        <Icons.LoadingOHIFMark className="h-4 w-4 text-white" />
        <span>
          {isPrefetch ? 'Prefetching' : 'Loading'} {percentComplete}% ({active.loaded}/
          {active.total})
        </span>
      </div>
      <div className="h-0.5 w-full overflow-hidden rounded bg-white/20">
        <div
          className="bg-primary-light h-full transition-[width] duration-150"
          style={{ width: `${percentComplete}%` }}
        />
      </div>
    </div>
  );
}

export default ViewportLoadingProgress;
