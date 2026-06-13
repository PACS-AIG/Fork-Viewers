import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT angiography (head/neck) comparison.
 *
 * A CTA produces many series — thin diagnostic source axials (head + neck), MIPs
 * (head + carotid), curved-planar reformats of each carotid (CPR), coronal/sagittal
 * reformats of head and neck, plus a bolus-tracking MONITORING acquisition, topograms,
 * and an RGB 3D-spin volume. The generic/head protocols mishandle it: they match on
 * "head" and (worse) prefer the ORIGINAL acquisition, which in a CTA is the MONITORING
 * slice (chest/arch), not the diagnostic recon. So CTA gets its own protocol,
 * out-weighting head/generic CT for HEAD/NECK "angio"/"CTA" studies, with vascular
 * windowing and NO prefer-ORIGINAL. Body-region angio (chest PE, abdominal/aorta/
 * runoff) is excluded here — a chest CTA routes to compareCTAChest instead.
 *
 * Diagnostic views: source axials (head, neck), MIPs (head, carotid), head reformats
 * (cor/sag), neck reformats (cor/sag), and L/R carotid CPRs. Non-diagnostic/derived
 * series (monitoring, topogram, scout, protocol, 3D-spin) are excluded from the tiled
 * stages — they remain in the series panel. The RGB 3D-spin is also the series that
 * trips cornerstone's thumbnail renderer, so keeping it out is doubly intentional.
 *
 * Stroke CTAs usually have NO prior, so beyond the current/prior compare stages this
 * protocol defines pageable current-only GROUP stages (`currentStages`): source axials,
 * then MIPs, then CPR carotids, then head reformats, then neck reformats — each a 2-up
 * you can page through. With a prior, the per-view current|prior stages lead instead.
 */
const CTA_KEYWORDS = ['angio', 'cta'];

// Body regions that are angio studies but NOT head/neck — carved out so they don't
// mis-hang on this protocol's head/neck selectors. A chest CTA (PE) instead routes to
// compareCTAChest; the rest (abdominal/thoracic-aorta/runoff CTA) fall to generic CT.
const NOT_HEAD_NECK = ['chest', 'thorax', 'pulmonary', 'abdomen', 'pelvis', 'aorta', 'runoff'];

// Non-diagnostic / derived series kept out of the tiled stages. NOTE: 'cpr' is NOT
// here — curved-planar carotid reformats are diagnostic (carotid stenosis) and get
// their own views below. 'spin' stays (excludes the RGB 3D-spin volume).
const NOT_DIAGNOSTIC = ['monitoring', 'topogram', 'scout', 'localizer', 'protocol', 'spin'];

export const hpCompareCTA = buildCompareProtocol({
  id: '@pacsai/compareCTA',
  name: 'CTA Head/Neck Compare',
  description:
    'Current vs prior CT angiography (head/neck) — source axials, MIPs, reformats, CPR carotids',
  modalities: ['CT'],
  bodyPartKeywords: CTA_KEYWORDS,
  // Scope to head/neck angio: claim "angio"/"cta" studies but NOT body-region angio
  // (chest PE → compareCTAChest; abdo/aorta/runoff → generic CT), which would
  // otherwise out-weight their own protocols yet match none of the head/neck selectors.
  bodyPartExcludeKeywords: NOT_HEAD_NECK,
  // Out-weight compareCTHead (which also matches the "head" in "CT ANGIO HEAD/NECK").
  matchWeight: 150,
  selectors: [
    // Source axials.
    { key: 'axhead', plane: 'axial', keywords: ['head'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'neck', 'cpr'] },
    { key: 'axneck', plane: 'axial', keywords: ['neck'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'head', 'cpr'] },
    // MIPs — split head vs carotid/neck (each lands in its own pane).
    { key: 'miphead', plane: 'axial', keywords: ['mip'], excludeKeywords: [...NOT_DIAGNOSTIC, 'carotid', 'neck'] },
    { key: 'mipneck', plane: 'axial', keywords: ['mip'], excludeKeywords: [...NOT_DIAGNOSTIC, 'head'] },
    // Head reformats.
    { key: 'corhead', plane: 'coronal', keywords: ['head'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'neck', 'cpr'] },
    { key: 'saghead', plane: 'sagittal', keywords: ['head'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'neck', 'cpr'] },
    // Neck reformats.
    { key: 'corneck', plane: 'coronal', keywords: ['neck'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'head', 'cpr'] },
    { key: 'sagneck', plane: 'sagittal', keywords: ['neck'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'head', 'cpr'] },
    // Carotid CPRs — curved-planar, no reliable plane. Left vs right via the LT/RT
    // token in the description (each side excludes the other).
    { key: 'cprlt', keywords: ['cpr'], excludeKeywords: [...NOT_DIAGNOSTIC, 'rt'] },
    { key: 'cprrt', keywords: ['cpr'], excludeKeywords: [...NOT_DIAGNOSTIC, 'lt'] },
  ],
  // Current|prior compare stages (one per view) — lead when a prior exists.
  stages: [
    { name: 'CTA Head axial (current/prior)', selector: 'axhead', voi: WINDOW.cta },
    { name: 'CTA Neck axial (current/prior)', selector: 'axneck', voi: WINDOW.cta },
    { name: 'CTA Head MIP (current/prior)', selector: 'miphead', voi: WINDOW.cta },
    { name: 'CTA Carotid MIP (current/prior)', selector: 'mipneck', voi: WINDOW.cta },
    { name: 'CTA Head coronal (current/prior)', selector: 'corhead', voi: WINDOW.cta },
    { name: 'CTA Head sagittal (current/prior)', selector: 'saghead', voi: WINDOW.cta },
    { name: 'CTA Neck coronal (current/prior)', selector: 'corneck', voi: WINDOW.cta },
    { name: 'CTA Neck sagittal (current/prior)', selector: 'sagneck', voi: WINDOW.cta },
    { name: 'CTA LT CPR carotid (current/prior)', selector: 'cprlt', voi: WINDOW.cta },
    { name: 'CTA RT CPR carotid (current/prior)', selector: 'cprrt', voi: WINDOW.cta },
  ],
  // No prior (the usual stroke case): pageable 2-up current-only groups, by task.
  currentStages: [
    { name: 'CTA Source axial (head + neck)', selectors: ['axhead', 'axneck'], voi: WINDOW.cta },
    { name: 'CTA MIP (head + carotid)', selectors: ['miphead', 'mipneck'], voi: WINDOW.cta },
    { name: 'CTA CPR carotid (L + R)', selectors: ['cprlt', 'cprrt'], voi: WINDOW.cta },
    { name: 'CTA Head reformats (cor + sag)', selectors: ['corhead', 'saghead'], voi: WINDOW.cta },
    { name: 'CTA Neck reformats (cor + sag)', selectors: ['corneck', 'sagneck'], voi: WINDOW.cta },
  ],
  // Densest-fully-matched current-only fallback (below the group stages).
  currentView: ['axhead', 'axneck', 'mipneck'],
});

export default hpCompareCTA;
