import { cache } from '@cornerstonejs/core';

/**
 * Shared progress store for the background prefetcher (initViewportPrefetch).
 *
 * The per-viewport `ViewportLoadingProgress` chip only reflects ITS OWN stack, so
 * on a fast server the chip seeds at 100% and never shows — the prefetcher has
 * already warmed that pane's images before it mounts. But the prefetcher is still
 * busy filling the rest of the visible layout (the other compare panes, or the
 * hundreds/thousands of images in an all-in-one composite). This store exposes that
 * aggregate "still loading in the background" progress so the chip can surface it
 * instead of silently disappearing.
 *
 * Pure pub/sub, no cornerstone event wiring of its own: the prefetcher owns the
 * lifecycle — it calls `setPrefetchSet` once per layout pass (the denominator = all
 * visible images) and `markPrefetchLoaded` from its IMAGE_LOADED listener.
 */

export type PrefetchProgress = { loaded: number; total: number };

let tracked = new Set<string>();
let loaded = new Set<string>();
const listeners = new Set<(p: PrefetchProgress | null) => void>();

// null = nothing to show (idle, or everything tracked is loaded).
function snapshot(): PrefetchProgress | null {
  if (tracked.size === 0 || loaded.size >= tracked.size) {
    return null;
  }
  return { loaded: loaded.size, total: tracked.size };
}

function emit(): void {
  const s = snapshot();
  listeners.forEach(l => l(s));
}

export function subscribePrefetchProgress(
  cb: (p: PrefetchProgress | null) => void
): () => void {
  listeners.add(cb);
  cb(snapshot());
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Replace the tracked set with the current layout's full image list (the
 * denominator). Re-seeds the loaded count from the cache so an already-warm layout
 * reports null immediately and a partially-loaded one starts at the right percent.
 */
export function setPrefetchSet(imageIds: string[]): void {
  tracked = new Set(imageIds);
  loaded = new Set();
  tracked.forEach(id => {
    if (cache.getImage(id)) {
      loaded.add(id);
    }
  });
  emit();
}

export function markPrefetchLoaded(imageId: string): void {
  if (!imageId || !tracked.has(imageId) || loaded.has(imageId)) {
    return;
  }
  loaded.add(imageId);
  emit();
}
