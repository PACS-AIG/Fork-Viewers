/**
 * Browser wiring for holdImagePoolsUntilFirstRender: the document's image-pool
 * governor (over Cornerstone's imageLoadPoolManager) as the pool owner, the
 * attempt trace's `first_pixels` (the first GRID viewport render with an image
 * in it, thumbnails excluded) as the release signal — or a volume viewport's
 * first grid render, image or not (the observers' onGridRender), since its
 * frames stream through the prefetch pool the hold keeps at 0 and would never
 * make that image before the timeout. Called from the mode's onModeEnter; the
 * returned hold is released again on onModeExit so a study switch starts
 * clean. A `parked` hold from the embed bridge may cover the thumbnail pool
 * too; the governor restores it only when both are gone. A park releases this
 * hold (`parked`), at once when the mode enters already parked: nothing is
 * drawn while parked (installParkedSuspend.ts), so waiting for the first
 * render would keep prefetch and volume streaming at 0 for the whole timeout.
 */
import { utils } from '@ohif/core';
import { onGridRender } from '../attempt/initAttemptObservers';
import { getEmbedBridge } from '../embed/browser';
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
    onFirstRender: listener => {
      const offPixels = attempt.subscribe(e => {
        if (e.stage === 'first_pixels' && e.ok) {
          listener('first_render');
        }
      });
      const offVolume = onGridRender(({ isVolume }) => {
        if (isVolume) {
          listener('volume_render');
        }
      });
      const offParked =
        getEmbedBridge()?.onVisibilityChange(state => {
          if (state === 'parked') {
            listener('parked');
          }
        }) ?? (() => undefined);
      return () => {
        offPixels();
        offVolume();
        offParked();
      };
    },
    timeoutMs,
  });
}
