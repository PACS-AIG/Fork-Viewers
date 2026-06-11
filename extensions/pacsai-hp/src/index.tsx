import { Types } from '@ohif/core';

import { id } from './id';
import getHangingProtocolModule from './getHangingProtocolModule';
import getCommandsModule from './getCommandsModule';
import { priorOverlayItem, PRIOR_OVERLAY_ITEM_ID } from './overlays/priorOverlayItem';
import {
  seriesTypeOverlayItem,
  SERIES_TYPE_OVERLAY_ITEM_ID,
} from './overlays/seriesTypeOverlayItem';
import {
  studyDescriptionOverlayItem,
  STUDY_DESCRIPTION_OVERLAY_ITEM_ID,
} from './overlays/studyDescriptionOverlayItem';
import { patientInfoOverlayItems } from './overlays/patientInfoOverlayItems';
import createScrollSyncSynchronizer from './sync/createScrollSyncSynchronizer';
import getImagePlane from './utils/getImagePlane';
import getImageKernel from './utils/getImageKernel';
import { getStudyRole } from './priors/roleRegistry';
import { getSpineRegion } from './priors/metadata';

/** Sync type registered for cross-study (current vs prior) relative scroll sync. */
export const SCROLL_SYNC_TYPE = 'pacsaiscroll';

/** Custom HP attribute id: computed image plane (axial/coronal/sagittal). */
export const PLANE_ATTRIBUTE = 'pacsaiPlane';

/** Custom HP attribute id: reconstruction kernel class (soft/bone). */
export const KERNEL_ATTRIBUTE = 'pacsaiKernel';

/** Custom HP attribute id: comparison role (current/prior/sibling). */
export const ROLE_ATTRIBUTE = 'pacsaiRole';

/** Custom HP attribute id: spine region (cervical/thoracic/lumbar). */
export const SPINE_REGION_ATTRIBUTE = 'pacsaiSpineRegion';

/** Read the study description off a display set (StudyDescription lives on instances). */
function studyDescriptionOf(displaySet: any): string {
  return String(
    displaySet?.instances?.[0]?.StudyDescription ?? displaySet?.StudyDescription ?? ''
  );
}

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

    // Comparison role (current/prior/sibling). Current is derived from the live
    // activeStudyUID so the current viewport always matches — even on the first
    // hang, before any prior/sibling is loaded; prior/sibling come from the role
    // registry, populated by loadRelevantPriors just before it re-hangs.
    const roleForDisplaySet = (displaySet: any) => {
      const activeStudyUID = hangingProtocolService?.getState?.()?.activeStudyUID;
      return getStudyRole(displaySet?.StudyInstanceUID, activeStudyUID);
    };
    hangingProtocolService?.addCustomAttribute?.(
      ROLE_ATTRIBUTE,
      'Comparison role (current/prior/sibling)',
      roleForDisplaySet
    );

    // Spine region (cervical/thoracic/lumbar) from the study description, used by
    // the region-addressable whole-spine overview selectors. Generic 'spine'
    // (no region) and non-spine return undefined (won't tile into a region pane).
    const spineRegionForDisplaySet = (displaySet: any) => {
      const region = getSpineRegion(studyDescriptionOf(displaySet));
      return region && region.startsWith('spine-') ? region.slice('spine-'.length) : undefined;
    };
    hangingProtocolService?.addCustomAttribute?.(
      SPINE_REGION_ATTRIBUTE,
      'Spine region (cervical/thoracic/lumbar)',
      spineRegionForDisplaySet
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
  studyDescriptionOverlayItem,
  STUDY_DESCRIPTION_OVERLAY_ITEM_ID,
  patientInfoOverlayItems,
};
