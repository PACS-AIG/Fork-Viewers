/**
 * Rev 11 milestone 2, B02 part 2: hold the thumbnail and prefetch request
 * pools until the first grid viewport has rendered.
 *
 * On a study open the study browser asks for one image per display set
 * (current study and priors — 66 frames in the measured opens, up to 75 in
 * flight with the deployed pool size) before the grid has shown anything.
 * Cornerstone's pool does give interaction requests priority, but only once a
 * viewport exists to make them. So while the first viewport is still on its
 * way, the thumbnail and prefetch pools are set to 0 (their requests queue,
 * nothing is dropped) and restored on the first grid render — or after a
 * timeout, so a viewer that never renders still gets its thumbnails.
 *
 * The pure half takes its pool and clock as parameters so it can be tested
 * without Cornerstone; installImagePoolHold() wires the real ones.
 */

export type HeldPoolType = 'thumbnail' | 'prefetch';
export const HELD_POOL_TYPES: readonly HeldPoolType[] = ['thumbnail', 'prefetch'];
export const DEFAULT_HOLD_TIMEOUT_MS = 8000;

export interface HoldablePool {
  getMaxSimultaneousRequests(type: string): number | undefined;
  setMaxSimultaneousRequests(type: string, max: number): void;
  /** Cornerstone declares this protected; nothing else wakes a pool whose limit just rose. */
  startGrabbing?: () => void;
}

export interface HoldDeps {
  pool: HoldablePool;
  /** Calls the listener once when the first grid viewport renders; returns an unsubscribe. */
  onFirstRender: (listener: () => void) => () => void;
  timeoutMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface ImagePoolHold {
  /** Restore the pools. Idempotent. `reason` is for the debug log only. */
  release(reason: 'first_render' | 'timeout' | 'mode_exit' | 'manual'): void;
  readonly released: boolean;
  readonly reason: string | null;
  /** The limits that were in force before the hold, per pool. */
  readonly saved: Readonly<Record<string, number>>;
}

export function holdImagePoolsUntilFirstRender(deps: HoldDeps): ImagePoolHold {
  const {
    pool,
    onFirstRender,
    timeoutMs = DEFAULT_HOLD_TIMEOUT_MS,
    setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: cancel = handle => globalThis.clearTimeout(handle as number),
  } = deps;

  const saved: Record<string, number> = {};
  for (const type of HELD_POOL_TYPES) {
    const current = pool.getMaxSimultaneousRequests(type);
    if (typeof current === 'number' && current > 0) {
      saved[type] = current;
      pool.setMaxSimultaneousRequests(type, 0);
    }
  }

  let released = false;
  let reason: string | null = null;
  let unsubscribe: (() => void) | null = null;
  let timer: unknown = null;

  const release: ImagePoolHold['release'] = why => {
    if (released) {
      return;
    }
    released = true;
    reason = why;
    for (const type of Object.keys(saved)) {
      pool.setMaxSimultaneousRequests(type, saved[type]);
    }
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    // Raising a limit does not wake the pool; the queued thumbnails would wait
    // for the next addRequest. Wake it explicitly when the pool allows.
    try {
      pool.startGrabbing?.();
    } catch (_) {
      /* best effort */
    }
  };

  if (Object.keys(saved).length === 0) {
    // Nothing to hold (pools already at 0 or unknown): behave as released.
    released = true;
    reason = 'manual';
  } else {
    unsubscribe = onFirstRender(() => release('first_render'));
    timer = schedule(() => release('timeout'), timeoutMs);
  }

  return {
    release,
    get released() {
      return released;
    },
    get reason() {
      return reason;
    },
    saved,
  };
}
