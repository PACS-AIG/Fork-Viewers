/**
 * Rev 11 milestone 7 (8 Nov 2026): the custom hanging-protocol attributes the
 * sixteen protocols match on, registered on a HangingProtocolService. Moved
 * here from the extension's preRegistration (index.tsx) without a change, so
 * the protocols' regression fixtures (hangingFixtures.test.ts) hang their
 * studies with exactly the attributes the viewer registers.
 */
import getImagePlane from '../utils/getImagePlane';
import getImageKernel from '../utils/getImageKernel';
import getImageColor from '../utils/getImageColor';
import { getStudyRole } from '../priors/roleRegistry';
import { getSpineRegion } from '../priors/metadata';
import { ALL_IN_ONE_MARKER, isNonImageDisplaySet } from '../allinone/buildAllInOneDisplaySet';
import { hangingIgnoresPriors } from '../allinone/browsingMode';

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
 * Custom HP attribute id: 'image' for an image series, 'nonimage' for a non-image
 * object or derived overlay (SR, SEG, KO, …). Every image selector of the compare
 * protocols requires 'image', so a text report never hangs in an image pane.
 */
export const IMAGE_ATTRIBUTE = 'pacsaiImage';

/**
 * 'dynamic' when the displaySet is a time-resolved (4D) volume — a raw perfusion /
 * dynamic acquisition (incl. ones detected via the pacsai AcquisitionNumber
 * fallback, see perfusion/initPerfusion4DProvider) — else 'static'. Lets protocol
 * selectors target the cine-able 4D source directly (SelectorDef.dynamic).
 */
export const DYNAMIC_ATTRIBUTE = 'pacsaiDynamic';

/**
 * Custom HP attribute id: spine region + timepoint, e.g. `lumbar-session`,
 * `cervical-prior`. `session` = current/sibling (same acquisition session);
 * `prior` = a loaded comparison prior of that region. Drives both the whole-spine
 * survey (region-session panes) and the per-region current-vs-prior compare.
 */
export const REGION_TIMEPOINT_ATTRIBUTE = 'pacsaiRegionTimepoint';

/** Read the study description off a display set (StudyDescription lives on instances). */
function studyDescriptionOf(displaySet: any): string {
  return String(displaySet?.instances?.[0]?.StudyDescription ?? displaySet?.StudyDescription ?? '');
}

/** The services the attributes read: the hanging service itself and the display sets. */
export interface HangingAttributeServices {
  hangingProtocolService?: {
    addCustomAttribute?: (id: string, name: string, fn: (displaySet: any) => unknown) => void;
    getState?: () => { activeStudyUID?: string } | undefined;
  };
  displaySetService?: { getActiveDisplaySets?: () => any[] };
}

/** Registers every custom attribute the compare protocols match on. */
export function registerHangingAttributes({
  hangingProtocolService,
  displaySetService,
}: HangingAttributeServices): void {
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

  // Time-resolved (4D) class so protocols can hang the cine-able raw source of a
  // perfusion study (SelectorDef.dynamic → the CT-perfusion 4D stage).
  hangingProtocolService?.addCustomAttribute?.(
    DYNAMIC_ATTRIBUTE,
    'Time-resolved 4D class (dynamic/static)',
    (displaySet: any) => (displaySet?.isDynamicVolume ? 'dynamic' : 'static')
  );

  // Diffusion b-value of a split DWI displaySet, so the DWI stage can prefer the
  // high-b trace (b1000) over b0. undefined for non-diffusion / unsplit series.
  hangingProtocolService?.addCustomAttribute?.(
    BVALUE_ATTRIBUTE,
    'Diffusion b-value',
    (displaySet: any) =>
      typeof displaySet?.diffusionBValue === 'number' ? displaySet.diffusionBValue : undefined
  );

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

  // Image series or not (22 Oct): an X-ray compare tiled a Basic Text SR beside
  // the chest views, and its viewport threw on a long text value sent as a bulk
  // data reference, taking the whole viewer down. Image selectors require 'image'.
  hangingProtocolService?.addCustomAttribute?.(
    IMAGE_ATTRIBUTE,
    'Image series (image/nonimage)',
    (displaySet: Parameters<typeof isNonImageDisplaySet>[0]) =>
      isNonImageDisplaySet(displaySet) ? 'nonimage' : 'image'
  );

  // Comparison role (current/prior/sibling) AS SEEN BY THE MATCHER. Current is
  // derived from the live activeStudyUID so the current viewport always matches —
  // even on the first hang, before any prior/sibling is loaded; prior/sibling come
  // from the role registry, populated by loadRelevantPriors just before it re-hangs.
  //
  // The 'Current + all-in-one' browsing mode suppresses the PRIOR role here (and in
  // the region-timepoint attribute below, which is derived from it), so a loaded
  // prior simply has no hanging role: every prior-requiring selector goes unmatched,
  // its 2-up stage falls `disabled`, and the engine takes the same current-only path
  // as a study with no prior at all — while siblings keep hanging as 'session'. The
  // registry itself stays truthful, so the CURRENT/PRIOR overlay pill and the
  // left-rail markers still identify a loaded prior.
  const hangRoleFor = (displaySet: any) => {
    const activeStudyUID = hangingProtocolService?.getState?.()?.activeStudyUID;
    const role = getStudyRole(displaySet?.StudyInstanceUID, activeStudyUID);
    return role === 'prior' && hangingIgnoresPriors() ? undefined : role;
  };
  hangingProtocolService?.addCustomAttribute?.(
    ROLE_ATTRIBUTE,
    'Comparison role (current/prior/sibling)',
    hangRoleFor
  );

  // Spine region + timepoint (e.g. 'lumbar-session', 'cervical-prior'), used by
  // the region-addressable whole-spine survey (region-session panes) and the
  // per-region current-vs-prior compare. session = current/sibling, prior = a
  // loaded comparison prior. Generic 'spine' / non-spine / unknown -> undefined.
  // Uses the SAME (possibly prior-suppressed) hanging role as ROLE_ATTRIBUTE, so
  // 'Current + all-in-one' drops the per-region prior compares too and leaves the
  // survey / per-region session views — which is the whole point of that mode.
  const regionTimepointForDisplaySet = (displaySet: any) => {
    const role = hangRoleFor(displaySet);
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
}

export default registerHangingAttributes;
