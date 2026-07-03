import React, { useRef, useState } from 'react';

/**
 * Hover-scrub for series thumbnails (PACS AI): moving the mouse across a thumbnail
 * sweeps through the series' images (left edge = first, right edge = last) so a rad
 * can preview a stack without hanging it. Leaving the thumbnail restores the static
 * thumbnail image.
 *
 * SAFETY: this NEVER touches a viewport or fires any navigation/scroll event — it
 * only swaps the thumbnail <img> src — so it cannot interact with the scroll
 * synchronizers. Rendering reuses the same imageId→dataURL path as the static
 * thumbnails (cornerstone loadImageToCanvas via the panel's getImageSrc), throttled
 * to ONE in-flight render with newest-wins follow-up, plus a bounded shared cache so
 * re-scrubs are instant and repeated hovers don't re-render.
 *
 * DEBUGGING: set `window.PACSAI_DEBUG_SCRUB = true` in the console for a per-move
 * trace. Image-render failures warn once per imageId regardless of the flag.
 */

export type ThumbnailScrubSource = {
  /** Lazy imageId list for the displaySet — resolved on first hover, not at map time. */
  getImageIds: () => string[];
  /** Same renderer the static thumbnail uses (imageId → dataURL promise). */
  getImageSrc: (imageId: string) => Promise<string>;
};

// dataURL cache shared across all thumbnails (imageId → dataURL). Bounded FIFO —
// thumbnails are small (~10-30KB each), so the cap keeps this a few MB at most.
const srcCache = new Map<string, string>();
const SRC_CACHE_MAX = 200;

const warnedFailures = new Set<string>();
const verbose = () => (window as any).PACSAI_DEBUG_SCRUB === true;

export function useHoverScrub(scrub?: ThumbnailScrubSource) {
  const [display, setDisplay] = useState<{ src: string; index: number; count: number } | null>(
    null
  );
  const stateRef = useRef({
    imageIds: null as string[] | null,
    wanted: -1,
    inFlight: false,
    hovering: false,
  });
  const scrubRef = useRef(scrub);
  // A new scrub source (re-mapped panel state, e.g. streamed-in instances) invalidates
  // the resolved imageId list so the count follows the growing series.
  if (scrubRef.current !== scrub) {
    scrubRef.current = scrub;
    stateRef.current.imageIds = null;
  }

  const show = (src: string, index: number, count: number) => {
    setDisplay({ src, index, count });
  };

  const pump = () => {
    const s = stateRef.current;
    const source = scrubRef.current;
    if (!source || s.inFlight || !s.hovering || !s.imageIds) {
      return;
    }
    const imageIds = s.imageIds;
    const index = s.wanted;
    if (index < 0 || index >= imageIds.length) {
      return;
    }
    const imageId = imageIds[index];

    const cached = srcCache.get(imageId);
    if (cached) {
      show(cached, index, imageIds.length);
      return;
    }

    s.inFlight = true;
    source
      .getImageSrc(imageId)
      .then(src => {
        s.inFlight = false;
        if (src) {
          if (srcCache.size >= SRC_CACHE_MAX) {
            srcCache.delete(srcCache.keys().next().value as string);
          }
          srcCache.set(imageId, src);
        }
        if (!s.hovering) {
          return;
        }
        if (src && s.wanted === index) {
          show(src, index, imageIds.length);
        } else if (s.wanted !== index) {
          pump(); // newest-wins: the mouse moved on while we rendered
        }
      })
      .catch(e => {
        s.inFlight = false;
        if (!warnedFailures.has(imageId)) {
          warnedFailures.add(imageId);
          console.warn('[pacsai-ui] hover-scrub: image render failed', { imageId, error: e });
        }
      });
  };

  const onScrubMove = (e: React.MouseEvent) => {
    const source = scrubRef.current;
    if (!source) {
      return;
    }
    const s = stateRef.current;
    s.hovering = true;
    if (!s.imageIds) {
      try {
        s.imageIds = source.getImageIds() ?? [];
      } catch (err) {
        s.imageIds = [];
        if (!warnedFailures.has('getImageIds')) {
          warnedFailures.add('getImageIds');
          console.warn('[pacsai-ui] hover-scrub: getImageIds failed', err);
        }
      }
      if (verbose()) {
        console.log('[pacsai-ui] hover-scrub: resolved stack', { count: s.imageIds.length });
      }
    }
    const count = s.imageIds.length;
    if (count < 2) {
      return; // single-image series — nothing to scrub
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const index = Math.min(count - 1, Math.round(frac * (count - 1)));
    if (index === s.wanted) {
      return;
    }
    s.wanted = index;
    if (verbose()) {
      console.log('[pacsai-ui] hover-scrub', {
        index,
        count,
        cached: srcCache.has(s.imageIds[index]),
      });
    }
    pump();
  };

  const onScrubLeave = () => {
    const s = stateRef.current;
    s.hovering = false;
    s.wanted = -1;
    setDisplay(null); // restore the static thumbnail
  };

  return { scrubDisplay: display, onScrubMove, onScrubLeave };
}
