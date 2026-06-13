import React, { useEffect, useRef, useState } from 'react';
import { cache, eventTarget, Enums } from '@cornerstonejs/core';
import { Icons } from '@ohif/ui-next';

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
 */
function ViewportLoadingProgress({ viewportId, element, viewportData, servicesManager }: withAppTypes) {
  const { cornerstoneViewportService } = servicesManager.services;
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
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

  if (!progress) {
    return null;
  }

  const percentComplete = Math.floor((progress.loaded / progress.total) * 100);

  // Compact corner chip — non-blocking, so the first image stays fully visible
  // while the rest of the series streams in behind it.
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-50 flex flex-col gap-1 rounded bg-black/60 px-2 py-1">
      <div className="flex items-center gap-2 text-xs text-white">
        <Icons.LoadingOHIFMark className="h-4 w-4 text-white" />
        <span>
          Loading {percentComplete}% ({progress.loaded}/{progress.total})
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
