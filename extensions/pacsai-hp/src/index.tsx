import { Types } from '@ohif/core';

import { id } from './id';
import getHangingProtocolModule from './getHangingProtocolModule';
import getCommandsModule from './getCommandsModule';
import { priorOverlayItem, PRIOR_OVERLAY_ITEM_ID } from './overlays/priorOverlayItem';
import {
  seriesTypeOverlayItem,
  SERIES_TYPE_OVERLAY_ITEM_ID,
} from './overlays/seriesTypeOverlayItem';
import createScrollSyncSynchronizer from './sync/createScrollSyncSynchronizer';
import getImagePlane from './utils/getImagePlane';
import getImageKernel from './utils/getImageKernel';

/** Sync type registered for cross-study (current vs prior) relative scroll sync. */
export const SCROLL_SYNC_TYPE = 'pacsaiscroll';

/** Custom HP attribute id: computed image plane (axial/coronal/sagittal). */
export const PLANE_ATTRIBUTE = 'pacsaiPlane';

/** Custom HP attribute id: reconstruction kernel class (soft/bone). */
export const KERNEL_ATTRIBUTE = 'pacsaiKernel';

/**
 * PACS-AI hanging protocols extension.
 *
 * Provides modality-aware current-vs-prior comparison protocols (CT / MR / CR-DX)
 * and a `loadRelevantPriors` command that auto-fetches the most relevant prior
 * study/studies and re-hangs them side by side with the current study.
 */
const pacsaiHpExtension: Types.Extensions.Extension = {
  id,

  preRegistration: ({ servicesManager }: Types.Extensions.ExtensionParams) => {
    const { syncGroupService, hangingProtocolService, displaySetService } =
      servicesManager.services;

    // Cross-study relative scroll synchronizer used by the protocols.
    syncGroupService?.addSynchronizerType?.(SCROLL_SYNC_TYPE, createScrollSyncSynchronizer);

    // Computed image-plane attribute so plane selectors work even when the
    // SeriesDescription omits ax/cor/sag (e.g. MPR reformats). Coronal/sagittal of
    // oblique head reformats need the study's other display sets (the axial
    // reformat defines the head frame), so pass same-study siblings.
    const planeForDisplaySet = (displaySet: any) => {
      const siblings = displaySetService
        ?.getActiveDisplaySets?.()
        ?.filter((d: any) => d?.StudyInstanceUID === displaySet?.StudyInstanceUID);
      return getImagePlane(displaySet, siblings);
    };
    hangingProtocolService?.addCustomAttribute?.(
      PLANE_ATTRIBUTE,
      'Computed image plane (axial/coronal/sagittal)',
      planeForDisplaySet
    );

    // Reconstruction kernel class (soft/bone) from ConvolutionKernel, so the
    // bone stage can find a bone recon even when the description omits "bone".
    hangingProtocolService?.addCustomAttribute?.(
      KERNEL_ATTRIBUTE,
      'Reconstruction kernel class (soft/bone)',
      getImageKernel
    );
  },

  getHangingProtocolModule,
  getCommandsModule,
};

export default pacsaiHpExtension;
export {
  priorOverlayItem,
  PRIOR_OVERLAY_ITEM_ID,
  seriesTypeOverlayItem,
  SERIES_TYPE_OVERLAY_ITEM_ID,
};
