/**
 * The document's one image-pool governor, over Cornerstone's
 * imageLoadPoolManager (see imagePoolGovernor.ts), and the embed bridge's
 * `parked` hold on it.
 */
import { imageLoadPoolManager } from '@cornerstonejs/core';
import {
  createImagePoolGovernor,
  holdPoolsWhileParked,
  type EmbedVisibilitySubscribe,
  type GovernedPool,
  type ImagePoolGovernor,
} from './imagePoolGovernor';

let governor: ImagePoolGovernor | null = null;
let parkedHoldInstalled = false;

export function getImagePoolGovernor(): ImagePoolGovernor {
  if (!governor) {
    // Cornerstone types the pool with its RequestType enum; the values are these strings.
    governor = createImagePoolGovernor(imageLoadPoolManager as unknown as GovernedPool);
  }
  return governor;
}

/**
 * Hold the thumbnail pool while the report window parks this frame. Once per
 * document: the bridge's visibility is per document, not per mode enter, and a
 * listener added while already parked is told so at once.
 */
export function installParkedPoolHold(onVisibilityChange: EmbedVisibilitySubscribe): void {
  if (parkedHoldInstalled) {
    return;
  }
  parkedHoldInstalled = true;
  holdPoolsWhileParked(getImagePoolGovernor(), onVisibilityChange);
}
