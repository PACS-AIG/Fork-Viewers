import { Types } from '@ohif/core';

import { id } from './id';
import getHangingProtocolModule from './getHangingProtocolModule';
import getCommandsModule from './getCommandsModule';
import { priorOverlayItem, PRIOR_OVERLAY_ITEM_ID } from './overlays/priorOverlayItem';
import createScrollSyncSynchronizer from './sync/createScrollSyncSynchronizer';

/** Sync type registered for cross-study (current vs prior) relative scroll sync. */
export const SCROLL_SYNC_TYPE = 'pacsaiscroll';

/**
 * PACS-AI hanging protocols extension.
 *
 * Provides modality-aware current-vs-prior comparison protocols (CT / MR / CR-DX)
 * and a `loadRelevantPriors` command that auto-fetches the most relevant prior
 * study/studies and re-hangs them side by side with the current study.
 */
const pacsaiHpExtension: Types.Extensions.Extension = {
  id,

  /** Register the cross-study relative scroll synchronizer used by the protocols. */
  preRegistration: ({ servicesManager }: Types.Extensions.ExtensionParams) => {
    const { syncGroupService } = servicesManager.services;
    syncGroupService?.addSynchronizerType?.(SCROLL_SYNC_TYPE, createScrollSyncSynchronizer);
  },

  getHangingProtocolModule,
  getCommandsModule,
};

export default pacsaiHpExtension;
export { priorOverlayItem, PRIOR_OVERLAY_ITEM_ID };
