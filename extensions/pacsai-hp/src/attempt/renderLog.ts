/**
 * The render log for the harness (Rev 11 milestone 6 part 2, V04): the last
 * grid viewport renders, each with the attempt generation current at that
 * moment and the studies the rendered viewport shows — as the trace's study
 * refs (a hash of the UID), never the UIDs.
 *
 * The attempt trace stamps every event with the CURRENT generation's study, so
 * after an in-document switch from A to B it cannot tell whether an image of A
 * still rendered. This log can: an entry naming A's ref in B's generation is
 * exactly that. It is read through a read-only `window.__pacsaiRenderLog`.
 *
 * Pure: the clock, the generation and the refs are the caller's
 * (initAttemptObservers.ts).
 */

export const RENDER_LOG_VERSION = 1;
export const RENDER_LOG_CAPACITY = 200;
export const RENDER_LOG_KEY = '__pacsaiRenderLog';

export interface RenderLogEntry {
  /** performance.now() of the render, rounded to a millisecond. */
  tMs: number;
  /** The trace's generation at the render; null when there is no trace. */
  generation: number | null;
  /** Refs of the studies the rendered viewport shows, deduplicated, in order. */
  studyRefs: string[];
  /**
   * Ref of the study the hanging protocol holds active (the case's current
   * study) at the render; null when unknown. After a switch to B, A may still
   * render legitimately as B's prior pane — then activeRef is B's.
   */
  activeRef: string | null;
}

export interface RenderLog {
  record(entry: {
    tMs: number;
    generation?: number | null;
    studyRefs: readonly string[];
    activeRef?: string | null;
  }): void;
  /** A copy, oldest first. */
  entries(): RenderLogEntry[];
}

export interface RenderLogHook {
  readonly version: number;
  entries(): RenderLogEntry[];
}

/** A ring of at most `capacity` entries: the oldest goes first. */
export function createRenderLog(capacity: number = RENDER_LOG_CAPACITY): RenderLog {
  const ring: RenderLogEntry[] = [];
  return {
    record: ({ tMs, generation, studyRefs, activeRef }) => {
      ring.push({
        tMs: Number.isFinite(tMs) ? Math.round(tMs) : 0,
        generation: typeof generation === 'number' ? generation : null,
        studyRefs: Array.from(new Set(studyRefs)),
        activeRef: typeof activeRef === 'string' ? activeRef : null,
      });
      if (ring.length > capacity) {
        ring.splice(0, ring.length - capacity);
      }
    },
    entries: () =>
      ring.map(e => ({
        tMs: e.tMs,
        generation: e.generation,
        studyRefs: e.studyRefs.slice(),
        activeRef: e.activeRef,
      })),
  };
}

/**
 * Publish the log on `target` (the window) as a frozen, non-writable,
 * non-configurable `__pacsaiRenderLog`. One per document: false when one is
 * there already (another copy of this module installed it first).
 */
export function installRenderLogHook(target: object, log: RenderLog): boolean {
  const hook: RenderLogHook = Object.freeze({
    version: RENDER_LOG_VERSION,
    entries: () => log.entries(),
  });
  try {
    Object.defineProperty(target, RENDER_LOG_KEY, {
      value: hook,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    return true;
  } catch (_) {
    return false;
  }
}
