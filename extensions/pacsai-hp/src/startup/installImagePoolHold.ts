/**
 * Browser wiring for holdImagePoolsUntilFirstRender: the document's image-pool
 * governor (over Cornerstone's imageLoadPoolManager) as the pool owner, the
 * attempt trace's `first_pixels` (the first GRID viewport render, thumbnails
 * excluded) as the release signal. Called from the mode's onModeEnter; the
 * returned hold is released again on onModeExit so a study switch starts
 * clean. A `parked` hold from the embed bridge may cover the thumbnail pool
 * too; the governor restores it only when both are gone.
 */
import { utils } from '@ohif/core';
import { getImagePoolGovernor } from './browserImagePoolGovernor';
import {
  holdImagePoolsUntilFirstRender,
  DEFAULT_HOLD_TIMEOUT_MS,
  type ImagePoolHold,
} from './holdImagePoolsUntilFirstRender';

export default function installImagePoolHold(timeoutMs = DEFAULT_HOLD_TIMEOUT_MS): ImagePoolHold | null {
  const { attempt } = utils;
  if (!attempt.needs('first_pixels')) {
    // Re-entered for a study whose first frame is already up in THIS document:
    // nothing to hold. (needs(), not has(): has() spans the attempt's
    // documents, and a reloaded document owes its own first render.)
    return null;
  }
  return holdImagePoolsUntilFirstRender({
    governor: getImagePoolGovernor(),
    onFirstRender: listener =>
      attempt.subscribe(e => {
        if (e.stage === 'first_pixels' && e.ok) {
          listener();
        }
      }),
    timeoutMs,
  });
}
