/**
 * Rev 11 milestone 6 part 2 (§4 of the app repo's docs/rev11/m6-embed-protocol.md):
 * one owner of Cornerstone's image-pool limits, reference-counted.
 *
 * Two holders want pools at 0 for different reasons and at different times:
 * the first grid render (holdImagePoolsUntilFirstRender, per mode enter:
 * thumbnail and prefetch) and the report window parking this frame (the embed
 * bridge's suspend, per document: thumbnail only). Each used to save and
 * restore the limits on its own, so whichever released first put the pools
 * back while the other still wanted them held. Here a pool type is at 0 while
 * ANY hold covers it; the limit saved at the first hold of a type is restored
 * when the LAST hold covering it is released, and the pool is woken.
 *
 * Pure: the pool is a parameter (browserImagePoolGovernor.ts wires
 * Cornerstone's imageLoadPoolManager).
 */

export interface GovernedPool {
  getMaxSimultaneousRequests(type: string): number | undefined;
  setMaxSimultaneousRequests(type: string, max: number): void;
  /** Cornerstone declares this protected; nothing else wakes a pool whose limit just rose. */
  startGrabbing?: () => void;
}

/**
 * What the `parked` hold covers: the study browser's thumbnails only.
 * `interaction` (the viewport's own images) and `prefetch` stay open —
 * Cornerstone streams volume viewports (MPR, 3D) through the prefetch request
 * type (BaseStreamingImageVolume's default request type, and the streaming
 * volume loader's), so holding it would freeze a volume the reader returns to.
 */
export const PARKED_POOL_TYPES: readonly string[] = ['thumbnail'];

export interface ImagePoolHoldRecord {
  reason: string;
  types: string[];
}

export interface ImagePoolGovernor {
  /** Hold these pool types at 0. Returns the release, which is idempotent. */
  hold(reason: string, types: readonly string[]): () => void;
  /** The holds in force, oldest first. */
  holds(): ImagePoolHoldRecord[];
  isHeld(type: string): boolean;
  /**
   * The limit that the last release of `type` will restore: the one in force
   * at its first hold. Undefined when the type is not held, or was already at
   * 0 or unknown then (it is left as it was).
   */
  savedLimit(type: string): number | undefined;
}

export function createImagePoolGovernor(pool: GovernedPool): ImagePoolGovernor {
  const active: ImagePoolHoldRecord[] = [];
  /** How many holds cover each type. */
  const coverage = new Map<string, number>();
  /** Positive limits saved at a type's first hold. */
  const saved = new Map<string, number>();

  const hold: ImagePoolGovernor['hold'] = (reason, types) => {
    const record: ImagePoolHoldRecord = { reason, types: Array.from(new Set(types)) };
    for (const type of record.types) {
      const covering = coverage.get(type) ?? 0;
      const current = pool.getMaxSimultaneousRequests(type);
      const positive = typeof current === 'number' && current > 0;
      if (covering === 0) {
        if (positive) {
          saved.set(type, current);
          pool.setMaxSimultaneousRequests(type, 0);
        }
      } else if (positive && saved.has(type)) {
        // Raised by someone else while held: back to 0, and the limit from
        // before the FIRST hold is still the one restored.
        pool.setMaxSimultaneousRequests(type, 0);
      }
      coverage.set(type, covering + 1);
    }
    active.push(record);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      active.splice(active.indexOf(record), 1);
      let restored = false;
      for (const type of record.types) {
        const covering = (coverage.get(type) ?? 1) - 1;
        if (covering > 0) {
          coverage.set(type, covering);
          continue;
        }
        coverage.delete(type);
        const limit = saved.get(type);
        if (limit !== undefined) {
          saved.delete(type);
          pool.setMaxSimultaneousRequests(type, limit);
          restored = true;
        }
      }
      if (restored) {
        // Raising a limit does not wake the pool; the queued requests would
        // wait for the next addRequest. Wake it explicitly when the pool allows.
        try {
          pool.startGrabbing?.();
        } catch (_) {
          /* best effort */
        }
      }
    };
  };

  return {
    hold,
    holds: () => active.map(r => ({ reason: r.reason, types: r.types.slice() })),
    isHeld: type => (coverage.get(type) ?? 0) > 0,
    savedLimit: type => saved.get(type),
  };
}

export type EmbedVisibilitySubscribe = (
  listener: (state: 'visible' | 'parked') => void
) => () => void;

/**
 * The embed bridge's suspend: a hold named `parked` over the thumbnail pool
 * (PARKED_POOL_TYPES) while the report window has this frame parked (its
 * Report mode), released when it is visible again. The interaction and
 * prefetch pools stay open, so the frame's current images, its stack and its
 * volumes keep loading and a return to Images is immediate.
 * Returns an unsubscribe that also releases a hold in force.
 */
export function holdPoolsWhileParked(
  governor: ImagePoolGovernor,
  onVisibilityChange: EmbedVisibilitySubscribe
): () => void {
  let release: (() => void) | null = null;
  const unsubscribe = onVisibilityChange(state => {
    if (state === 'parked') {
      if (!release) {
        release = governor.hold('parked', PARKED_POOL_TYPES);
      }
    } else if (release) {
      const r = release;
      release = null;
      r();
    }
  });
  return () => {
    unsubscribe();
    if (release) {
      const r = release;
      release = null;
      r();
    }
  };
}
