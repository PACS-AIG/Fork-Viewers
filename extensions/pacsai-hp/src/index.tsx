import { Types } from '@ohif/core';

import { id } from './id';
import getHangingProtocolModule from './getHangingProtocolModule';
import getCommandsModule from './getCommandsModule';
import getToolbarModule from './getToolbarModule';
import {
  studyRoleOverlayItem,
  STUDY_ROLE_OVERLAY_ITEM_ID,
} from './overlays/studyRoleOverlayItem';
import {
  seriesTypeOverlayItem,
  SERIES_TYPE_OVERLAY_ITEM_ID,
} from './overlays/seriesTypeOverlayItem';
import {
  studyDescriptionOverlayItem,
  STUDY_DESCRIPTION_OVERLAY_ITEM_ID,
} from './overlays/studyDescriptionOverlayItem';
import { patientInfoOverlayItems } from './overlays/patientInfoOverlayItems';
import {
  clinicalContextOverlayItem,
  CLINICAL_CONTEXT_OVERLAY_ITEM_ID,
} from './overlays/clinicalContextOverlayItem';
import createScrollSyncSynchronizer from './sync/createScrollSyncSynchronizer';
import createAllInOneScrollSynchronizer from './sync/createAllInOneScrollSynchronizer';
import getImagePlane from './utils/getImagePlane';
import getImageKernel from './utils/getImageKernel';
import getImageColor from './utils/getImageColor';
import installRgbStackViewportFix from './utils/installRgbStackViewportFix';
import { getStudyRole } from './priors/roleRegistry';
import { getSpineRegion } from './priors/metadata';
import { ALL_IN_ONE_MARKER } from './allinone/buildAllInOneDisplaySet';
import initAllInOneAutoRefresh from './allinone/initAllInOneAutoRefresh';
import initAllInOneScrollSyncBinding from './allinone/initAllInOneScrollSyncBinding';

/** Sync type registered for cross-study (current vs prior) relative scroll sync. */
export const SCROLL_SYNC_TYPE = 'pacsaiscroll';

/** Sync type for the all-in-one compare: plane-grouped scroll (sagittal↔sagittal, …). */
export const ALL_IN_ONE_SCROLL_SYNC_TYPE = 'pacsaiallinonescroll';

/** Custom HP attribute id: computed image plane (axial/coronal/sagittal). */
export const PLANE_ATTRIBUTE = 'pacsaiPlane';

/** Custom HP attribute id: reconstruction kernel class (soft/bone). */
export const KERNEL_ATTRIBUTE = 'pacsaiKernel';

/** Custom HP attribute id: comparison role (current/prior/sibling). */
export const ROLE_ATTRIBUTE = 'pacsaiRole';

/** Custom HP attribute id: color class (rgb/mono), to exclude derived color series. */
export const COLOR_ATTRIBUTE = 'pacsaiColor';

/**
 * Custom HP attribute id: diffusion b-value of a (split) DWI displaySet, stamped
 * by the DWI splitter (`diffusionBValue`). Lets a selector prefer the high-b trace
 * (e.g. b1000) over b0; undefined for non-diffusion / unsplit series.
 */
export const BVALUE_ATTRIBUTE = 'pacsaiBValue';

/** Custom HP attribute id: marks the synthetic all-in-one composite stack. */
export const ALL_IN_ONE_ATTRIBUTE = 'pacsaiAllInOne';

/**
 * Custom HP attribute id: spine region + timepoint, e.g. `lumbar-session`,
 * `cervical-prior`. `session` = current/sibling (same acquisition session);
 * `prior` = a loaded comparison prior of that region. Drives both the whole-spine
 * survey (region-session panes) and the per-region current-vs-prior compare.
 */
export const REGION_TIMEPOINT_ATTRIBUTE = 'pacsaiRegionTimepoint';

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

  preRegistration: ({ servicesManager, extensionManager }: Types.Extensions.ExtensionParams) => {
    const { syncGroupService, hangingProtocolService, displaySetService } =
      servicesManager.services;

    // Cross-study relative scroll synchronizer used by the protocols.
    syncGroupService?.addSynchronizerType?.(SCROLL_SYNC_TYPE, createScrollSyncSynchronizer);
    // Plane-grouped scroll sync for the all-in-one compare (sagittal↔sagittal, etc.).
    syncGroupService?.addSynchronizerType?.(
      ALL_IN_ONE_SCROLL_SYNC_TYPE,
      createAllInOneScrollSynchronizer
    );

    // Fix cornerstone3D's RGB StackViewport crash (size-vs-components RangeError)
    // so color series — RAPID perfusion/angio maps, 3D-spin, iMAR — render and
    // thumbnail without breaking the viewport. Idempotent.
    installRgbStackViewportFix((...args) => console.warn('[pacsai-hp]', ...args));

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

    // Color class (rgb/mono) so diagnostic selectors can exclude derived color
    // series — RAPID/iSchemaView summary renders, perfusion maps, 3D-spin volumes —
    // which aren't source/MIP series and also trip cornerstone's RGB render crash.
    hangingProtocolService?.addCustomAttribute?.(
      COLOR_ATTRIBUTE,
      'Color class (rgb/mono)',
      getImageColor
    );

    // Diffusion b-value of a split DWI displaySet, so the DWI stage can prefer the
    // high-b trace (b1000) over b0. undefined for non-diffusion / unsplit series.
    hangingProtocolService?.addCustomAttribute?.(BVALUE_ATTRIBUTE, 'Diffusion b-value', (
      displaySet: any
    ) => (typeof displaySet?.diffusionBValue === 'number' ? displaySet.diffusionBValue : undefined));

    // All-in-one composite marker: 'allinone' for the synthetic concatenated stack
    // (built by loadRelevantPriors), 'series' for every real series. Lets the
    // all-in-one stage match ONLY the composite (equals 'allinone') and every
    // diagnostic selector exclude it (equals 'series'), so the composite never
    // lands in a normal plane/kernel pane.
    hangingProtocolService?.addCustomAttribute?.(
      ALL_IN_ONE_ATTRIBUTE,
      'All-in-one composite marker (allinone/series)',
      (displaySet: any) => (displaySet?.isAllInOne ? ALL_IN_ONE_MARKER : 'series')
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

    // Spine region + timepoint (e.g. 'lumbar-session', 'cervical-prior'), used by
    // the region-addressable whole-spine survey (region-session panes) and the
    // per-region current-vs-prior compare. session = current/sibling, prior = a
    // loaded comparison prior. Generic 'spine' / non-spine / unknown -> undefined.
    const regionTimepointForDisplaySet = (displaySet: any) => {
      const activeStudyUID = hangingProtocolService?.getState?.()?.activeStudyUID;
      const role = getStudyRole(displaySet?.StudyInstanceUID, activeStudyUID);
      const timepoint =
        role === 'current' || role === 'sibling' ? 'session' : role === 'prior' ? 'prior' : undefined;
      if (!timepoint) {
        return undefined;
      }
      const region = getSpineRegion(studyDescriptionOf(displaySet));
      if (!region || !region.startsWith('spine-')) {
        return undefined;
      }
      return `${region.slice('spine-'.length)}-${timepoint}`;
    };
    hangingProtocolService?.addCustomAttribute?.(
      REGION_TIMEPOINT_ATTRIBUTE,
      'Spine region + timepoint (session/prior)',
      regionTimepointForDisplaySet
    );

    // Keep the all-in-one composites in sync with late-streaming series (covers the
    // single-study path, which builds once with no poll). Debounced; re-hangs only
    // when a composite is first created. One app-lifetime subscription (the
    // displaySetService singleton persists across mode enter/exit).
    initAllInOneAutoRefresh({ servicesManager, extensionManager });

    // Re-assert the all-in-one compare scroll-sync binding after each layout settles.
    // The stage's syncGroups are applied at ELEMENT_ENABLED, but the late-built
    // composites mean the 2-up is often reached by transitioning from a no-sync stage
    // while the grid keeps a viewport's element — so that pane never re-binds and the
    // sync silently dies (intermittent). This rebinds any unbound all-in-one pane.
    initAllInOneScrollSyncBinding({ servicesManager });
  },

  getHangingProtocolModule,
  getCommandsModule,
  getToolbarModule,
};

export default pacsaiHpExtension;
export {
  studyRoleOverlayItem,
  STUDY_ROLE_OVERLAY_ITEM_ID,
  seriesTypeOverlayItem,
  SERIES_TYPE_OVERLAY_ITEM_ID,
  studyDescriptionOverlayItem,
  STUDY_DESCRIPTION_OVERLAY_ITEM_ID,
  patientInfoOverlayItems,
  clinicalContextOverlayItem,
  CLINICAL_CONTEXT_OVERLAY_ITEM_ID,
  getStudyRole,
};
