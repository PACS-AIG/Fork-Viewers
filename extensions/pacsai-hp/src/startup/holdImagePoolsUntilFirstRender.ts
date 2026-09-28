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
 * Rev 11 milestone 6 part 2: the hold is one holder (`first_render`) on the
 * image-pool governor, beside the embed bridge's `parked`, so neither can
 * restore a pool the other still holds. Given only a pool, it makes a private
 * governor (the behaviour on its own, as tested).
 *
 * The pure half takes its governor (or pool) and clock as parameters so it can
 * be tested without Cornerstone; installImagePoolHold() wires the real ones.
 */
import { createImagePoolGovernor, type GovernedPool, type ImagePoolGovernor } from './imagePoolGovernor';

export type HeldPoolType = 'thumbnail' | 'prefetch';
/** Not the `parked` hold's set (thumbnail only): until the first render, prefetch waits too. */
export const HELD_POOL_TYPES: readonly HeldPoolType[] = ['thumbnail', 'prefetch'];
export const DEFAULT_HOLD_TIMEOUT_MS = 8000;
export const FIRST_RENDER_HOLD = 'first_render';

export type HoldablePool = GovernedPool;

interface HoldTiming {
  /** Calls the listener once when the first grid viewport renders; returns an unsubscribe. */
  onFirstRender: (listener: () => void) => () => void;
  timeoutMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export type HoldDeps = HoldTiming &
  ({ governor: ImagePoolGovernor; pool?: undefined } | { pool: HoldablePool; governor?: undefined });

export interface ImagePoolHold {
  /** Release this hold. Idempotent. `reason` is for the debug log only. */
  release(reason: 'first_render' | 'timeout' | 'mode_exit' | 'manual'): void;
  readonly released: boolean;
  readonly reason: string | null;
  /** The limits the governor restores once no hold covers the pool, per pool. */
  readonly saved: Readonly<Record<string, number>>;
}

export function holdImagePoolsUntilFirstRender(deps: HoldDeps): ImagePoolHold {
  const {
    onFirstRender,
    timeoutMs = DEFAULT_HOLD_TIMEOUT_MS,
    setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: cancel = handle => globalThis.clearTimeout(handle as number),
  } = deps;
  const governor = deps.governor ? deps.governor : createImagePoolGovernor(deps.pool);

  const releaseHold = governor.hold(FIRST_RENDER_HOLD, HELD_POOL_TYPES);
  const saved: Record<string, number> = {};
  for (const type of HELD_POOL_TYPES) {
    const limit = governor.savedLimit(type);
    if (typeof limit === 'number') {
      saved[type] = limit;
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
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    // The governor restores (and wakes) a pool only when no other hold covers it.
    releaseHold();
  };

  if (Object.keys(saved).length === 0) {
    // Nothing to hold (pools already at 0 or unknown): behave as released.
    releaseHold();
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
