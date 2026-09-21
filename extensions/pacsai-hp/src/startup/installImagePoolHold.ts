/**
 * Browser wiring for holdImagePoolsUntilFirstRender: Cornerstone's
 * imageLoadPoolManager as the pool, the attempt trace's `first_pixels` (the
 * first GRID viewport render, thumbnails excluded) as the release signal.
 * Called from the mode's onModeEnter; the returned hold is released again on
 * onModeExit so a study switch starts clean.
 */
import { utils } from '@ohif/core';
import { imageLoadPoolManager } from '@cornerstonejs/core';
import {
  holdImagePoolsUntilFirstRender,
  DEFAULT_HOLD_TIMEOUT_MS,
  type ImagePoolHold,
} from './holdImagePoolsUntilFirstRender';

export default function installImagePoolHold(timeoutMs = DEFAULT_HOLD_TIMEOUT_MS): ImagePoolHold | null {
  const { attempt } = utils;
  if (attempt.has('first_pixels')) {
    // Re-entered for a study whose first frame is already up: nothing to hold.
    return null;
  }
  const pool = imageLoadPoolManager as unknown as {
    getMaxSimultaneousRequests(type: string): number | undefined;
    setMaxSimultaneousRequests(type: string, max: number): void;
    startGrabbing?: () => void;
  };
  return holdImagePoolsUntilFirstRender({
    pool,
    onFirstRender: listener =>
      attempt.subscribe(e => {
        if (e.stage === 'first_pixels' && e.ok) {
          listener();
        }
      }),
    timeoutMs,
  });
}
