import React, { useRef, useState } from 'react';

/**
 * Hover-scrub for series thumbnails (PACS AI): moving the mouse across a thumbnail
 * sweeps through the series' images (left edge = first, right edge = last) so a rad
 * can preview a stack without hanging it. Leaving the thumbnail restores the static
 * thumbnail image.
 *
 * SAFETY: this NEVER touches a viewport or fires any navigation/scroll event — it
 * only swaps the thumbnail <img> src — so it cannot interact with the scroll
 * synchronizers.
 *
 * PERFORMANCE MODEL (v2): rendering a frame means loadImageToCanvas, which DOWNLOADS
 * the full DICOM image when it isn't in the cornerstone cache (~0.5MB/slice for CT).
 * Scrubbing therefore cannot be per-slice on cold series. Instead:
 *  - the scrub is quantized to a SUBSET of ≤ SUBSET_MAX evenly-spaced frames (a
 *    preview, not diagnostic scroll) — bounded network/memory per series;
 *  - hovering starts a background WARMUP of that subset (concurrency
 *    WARM_CONCURRENCY, cursor-priority) so the card sharpens within seconds and
 *    every later sweep is fully cache-hit smooth;
 *  - a move always responds INSTANTLY with the nearest already-cached subset frame
 *    while the exact frame loads (no dead frames mid-sweep);
 *  - the shared dataURL cache is LRU (touch-on-hit) so scrubbing a huge composite
 *    can't permanently evict other warm series.
 *
 * DEBUGGING: set `window.PACSAI_DEBUG_SCRUB = true` in the console for a per-move /
 * per-load trace (incl. load ms — distinguishes network-cold from cache-warm).
 * Failures warn once per imageId regardless of the flag; an inert card (fewer than 2
 * imageIds) logs its reason once per hover under the flag.
 */

export type ThumbnailScrubSource = {
  /** Lazy imageId list for the displaySet — resolved on first hover, not at map time. */
  getImageIds: () => string[];
  /** Same renderer the static thumbnail uses (imageId → dataURL promise). */
  getImageSrc: (imageId: string) => Promise<string>;
};

/** Max distinct frames scrubbed per series (evenly spaced, endpoints included). */
const SUBSET_MAX = 24;
/** Parallel background renders while hovering. */
const WARM_CONCURRENCY = 2;

// dataURL cache shared across all thumbnails (imageId → dataURL), LRU by re-insert.
// ~24 frames/series × ~15 warm series stays inside the cap.
const srcCache = new Map<string, string>();
const SRC_CACHE_MAX = 400;
const cacheGet = (imageId: string): string | undefined => {
  const hit = srcCache.get(imageId);
  if (hit !== undefined) {
    // LRU touch: move to the end so hot series survive a big cold sweep.
    srcCache.delete(imageId);
    srcCache.set(imageId, hit);
  }
  return hit;
};
const cachePut = (imageId: string, src: string) => {
  if (srcCache.size >= SRC_CACHE_MAX) {
    srcCache.delete(srcCache.keys().next().value as string);
  }
  srcCache.set(imageId, src);
};

const warnedFailures = new Set<string>();
const verbose = () => (window as any).PACSAI_DEBUG_SCRUB === true;

/** Evenly-spaced frame indices (≤ SUBSET_MAX, endpoints included). */
function subsetIndices(count: number): number[] {
  if (count <= SUBSET_MAX) {
    return Array.from({ length: count }, (_, i) => i);
  }
  return Array.from({ length: SUBSET_MAX }, (_, k) =>
    Math.round((k * (count - 1)) / (SUBSET_MAX - 1))
  );
}

export function useHoverScrub(scrub?: ThumbnailScrubSource) {
  const [display, setDisplay] = useState<{ src: string; index: number; count: number } | null>(
    null
  );
  const stateRef = useRef({
    imageIds: null as string[] | null,
    subset: [] as number[], // frame indices scrubbed, ascending
    wantedPos: -1, // position within subset the cursor asks for
    inFlight: 0,
    loadingIds: new Set<string>(), // imageIds currently being rendered
    hovering: false,
    loggedInert: false,
  });
  const scrubRef = useRef(scrub);
  // A new scrub source (re-mapped panel state, e.g. streamed-in instances) invalidates
  // the resolved imageId list so the count follows the growing series.
  if (scrubRef.current !== scrub) {
    scrubRef.current = scrub;
    stateRef.current.imageIds = null;
  }

  const showPos = (pos: number) => {
    const s = stateRef.current;
    const frameIndex = s.subset[pos];
    const src = cacheGet(s.imageIds[frameIndex]);
    if (src) {
      setDisplay({ src, index: frameIndex, count: s.imageIds.length });
      return true;
    }
    return false;
  };

  /** Nearest subset position to `pos` whose frame is already cached, or -1. */
  const nearestCachedPos = (pos: number): number => {
    const s = stateRef.current;
    for (let d = 0; d < s.subset.length; d++) {
      for (const cand of d === 0 ? [pos] : [pos - d, pos + d]) {
        if (cand >= 0 && cand < s.subset.length && srcCache.has(s.imageIds[s.subset[cand]])) {
          return cand;
        }
      }
    }
    return -1;
  };

  /** Next subset position worth loading: the cursor's first, then nearest-out. */
  const nextUncachedPos = (): number => {
    const s = stateRef.current;
    const from = s.wantedPos >= 0 ? s.wantedPos : 0;
    for (let d = 0; d < s.subset.length; d++) {
      for (const cand of d === 0 ? [from] : [from - d, from + d]) {
        if (cand < 0 || cand >= s.subset.length) {
          continue;
        }
        const imageId = s.imageIds[s.subset[cand]];
        // Skip cached, in-flight, and known-failed frames (else a bad frame under
        // the cursor would retry in a tight loop).
        if (!srcCache.has(imageId) && !s.loadingIds.has(imageId) && !warnedFailures.has(imageId)) {
          return cand;
        }
      }
    }
    return -1;
  };

  const pump = () => {
    const s = stateRef.current;
    const source = scrubRef.current;
    if (!source || !s.hovering || !s.imageIds || s.inFlight >= WARM_CONCURRENCY) {
      return;
    }
    const pos = nextUncachedPos();
    if (pos < 0) {
      return; // whole subset cached
    }
    const frameIndex = s.subset[pos];
    const imageId = s.imageIds[frameIndex];

    s.inFlight += 1;
    s.loadingIds.add(imageId);
    const t0 = Date.now();
    source
      .getImageSrc(imageId)
      .then(src => {
        s.inFlight -= 1;
        s.loadingIds.delete(imageId);
        if (src) {
          cachePut(imageId, src);
        }
        if (verbose()) {
          console.log('[pacsai-ui] hover-scrub: loaded', {
            frameIndex,
            ms: Date.now() - t0, // cold ≈ network+decode; warm ≈ <30ms
          });
        }
        if (s.hovering) {
          if (s.wantedPos === pos) {
            showPos(pos); // the cursor is still here — show the exact frame
          }
          pump(); // keep warming the subset
        }
      })
      .catch(e => {
        s.inFlight -= 1;
        s.loadingIds.delete(imageId);
        if (!warnedFailures.has(imageId)) {
          warnedFailures.add(imageId);
          console.warn('[pacsai-ui] hover-scrub: image render failed', { imageId, error: e });
        }
        if (s.hovering) {
          pump(); // skip the bad frame, keep going
        }
      });
  };

  const resolveStack = () => {
    const s = stateRef.current;
    try {
      s.imageIds = scrubRef.current.getImageIds() ?? [];
    } catch (err) {
      s.imageIds = [];
      if (!warnedFailures.has('getImageIds')) {
        warnedFailures.add('getImageIds');
        console.warn('[pacsai-ui] hover-scrub: getImageIds failed', err);
      }
    }
    s.subset = subsetIndices(s.imageIds.length);
    if (verbose()) {
      console.log('[pacsai-ui] hover-scrub: resolved stack', {
        count: s.imageIds.length,
        subset: s.subset.length,
      });
    }
  };

  const onScrubMove = (e: React.MouseEvent) => {
    if (!scrubRef.current) {
      return;
    }
    const s = stateRef.current;
    const freshEntry = !s.hovering;
    s.hovering = true;
    // Resolve on first hover; RE-resolve on every fresh entry while the stack looks
    // inert — a series still streaming in resolves short/empty at first and must not
    // be cached that way forever.
    if (!s.imageIds || (freshEntry && s.imageIds.length < 2)) {
      resolveStack();
    }
    const count = s.imageIds.length;
    if (count < 2) {
      if (freshEntry && verbose() && !s.loggedInert) {
        s.loggedInert = true;
        console.log('[pacsai-ui] hover-scrub: inert card (fewer than 2 imageIds)', { count });
      }
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const pos = Math.min(s.subset.length - 1, Math.round(frac * (s.subset.length - 1)));
    if (pos === s.wantedPos && !freshEntry) {
      return;
    }
    s.wantedPos = pos;
    if (verbose()) {
      console.log('[pacsai-ui] hover-scrub', {
        pos,
        frameIndex: s.subset[pos],
        count,
        cached: srcCache.has(s.imageIds[s.subset[pos]]),
      });
    }
    // Respond immediately: exact frame if cached, else the nearest cached subset
    // frame (no dead frames mid-sweep), while the warmers fetch the exact one.
    if (!showPos(pos)) {
      const near = nearestCachedPos(pos);
      if (near >= 0) {
        showPos(near);
      }
    }
    pump();
    pump(); // fill both warm slots
  };

  const onScrubLeave = () => {
    const s = stateRef.current;
    s.hovering = false;
    s.wantedPos = -1;
    setDisplay(null); // restore the static thumbnail (in-flight renders still cache)
  };

  return { scrubDisplay: display, onScrubMove, onScrubLeave };
}
