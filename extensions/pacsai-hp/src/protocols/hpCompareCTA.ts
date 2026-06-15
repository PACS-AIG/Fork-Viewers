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
 * Diagnostic views: source axials (head, neck), head MIPs (axial COW + cor/sag),
 * carotid/neck MIPs (cor/sag, + axial for vendors that emit it), head reformats
 * (cor/sag), neck reformats (cor/sag), and L/R carotid CPRs. Non-diagnostic/derived
 * series (monitoring, topogram, scout, protocol) and ALL color/RGB series (3D-spin,
 * RAPID/iSchemaView renders, perfusion maps — via `excludeColorSeries`) are excluded
 * from the tiled stages; they remain in the series panel. Excluding color also keeps
 * the RGB series that trip cornerstone's thumbnail renderer out of the auto-hang.
 *
 * Stroke CTAs usually have NO prior, so beyond the current/prior compare stages this
 * protocol defines pageable current-only GROUP stages (`currentStages`): source axials,
 * then MIPs, then CPR carotids, then head reformats, then neck reformats — each a 2-up
 * you can page through. With a prior, the per-view current|prior stages lead instead.
 */
const CTA_KEYWORDS = ['angio', 'cta'];

// Body regions that are angio studies but NOT head/neck — carved out so they don't
// mis-hang on this protocol's head/neck selectors. A chest CTA (PE) routes to
// compareCTAChest; a peripheral/extremity runoff routes to compareCTARunoff; the rest
// (abdominal / thoracic-aorta CTA) fall to generic CT. NOTE: matching is on the STUDY
// description, so include the body-region words that appear there ("lower extremity",
// not the series-level "runoff").
const NOT_HEAD_NECK = [
  'chest',
  'thorax',
  'pulmonary',
  'abdomen',
  'pelvis',
  'aorta',
  'runoff',
  'extremity',
  'leg',
  'femoral',
  'popliteal',
  'peripheral',
];

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
  // Drop the RAPID/iSchemaView color renders, perfusion maps and 3D-spin from the
  // diagnostic stages (also avoids the RGB thumbnail crash auto-hanging them).
  excludeColorSeries: true,
  selectors: [
    // Source axials. `axhead` does NOT require a "head" token: many cerebral CTAs are a
    // single combined head+neck source acquisition named e.g. "ANGIOGRAM CTA" / "NCCT" /
    // "SCANS" with no region word — so it matches any axial source recon (largest wins,
    // i.e. the thin angio source), just excluding MIPs/neck/cpr. `axneck` stays
    // neck-specific so a separate neck source recon still lands in its own pane.
    { key: 'axhead', plane: 'axial', excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'neck', 'cpr'] },
    { key: 'axneck', plane: 'axial', keywords: ['neck'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'head', 'cpr'] },
    // MIPs — head (intracranial / circle-of-Willis) vs neck (carotid / vertebral),
    // PER PLANE so every MIP orientation hangs (this vendor emits axial COW + cor/sag
    // head + cor/sag neck). A head MIP is any MIP that isn't neck/carotid (covers the
    // COW slab, which carries no "head" token); a neck MIP must POSITIVELY name
    // neck/carotid (so the COW slab is never mistaken for a carotid MIP).
    { key: 'miphead_ax', plane: 'axial', keywords: ['mip'], excludeKeywords: [...NOT_DIAGNOSTIC, 'neck', 'carotid', 'cpr'] },
    { key: 'miphead_cor', plane: 'coronal', keywords: ['mip'], excludeKeywords: [...NOT_DIAGNOSTIC, 'neck', 'carotid', 'cpr'] },
    { key: 'miphead_sag', plane: 'sagittal', keywords: ['mip'], excludeKeywords: [...NOT_DIAGNOSTIC, 'neck', 'carotid', 'cpr'] },
    { key: 'mipneck_cor', plane: 'coronal', keywordGroups: [['mip'], ['neck', 'carotid']], excludeKeywords: [...NOT_DIAGNOSTIC, 'cpr'] },
    { key: 'mipneck_sag', plane: 'sagittal', keywordGroups: [['mip'], ['neck', 'carotid']], excludeKeywords: [...NOT_DIAGNOSTIC, 'cpr'] },
    { key: 'mipneck_ax', plane: 'axial', keywordGroups: [['mip'], ['neck', 'carotid']], excludeKeywords: [...NOT_DIAGNOSTIC, 'cpr'] },
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
    { name: 'CTA Source axial (current/prior)', selector: 'axhead', voi: WINDOW.cta },
    { name: 'CTA Neck axial (current/prior)', selector: 'axneck', voi: WINDOW.cta },
    { name: 'CTA Head MIP axial (current/prior)', selector: 'miphead_ax', voi: WINDOW.cta },
    { name: 'CTA Head MIP coronal (current/prior)', selector: 'miphead_cor', voi: WINDOW.cta },
    { name: 'CTA Head MIP sagittal (current/prior)', selector: 'miphead_sag', voi: WINDOW.cta },
    { name: 'CTA Carotid MIP coronal (current/prior)', selector: 'mipneck_cor', voi: WINDOW.cta },
    { name: 'CTA Carotid MIP sagittal (current/prior)', selector: 'mipneck_sag', voi: WINDOW.cta },
    { name: 'CTA Carotid MIP axial (current/prior)', selector: 'mipneck_ax', voi: WINDOW.cta },
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
    { name: 'CTA Head MIP (ax + cor + sag)', selectors: ['miphead_ax', 'miphead_cor', 'miphead_sag'], voi: WINDOW.cta },
    { name: 'CTA Carotid MIP (cor + sag)', selectors: ['mipneck_cor', 'mipneck_sag'], voi: WINDOW.cta },
    // Axial head+carotid MIP pair — back-compat for vendors whose MIPs are axial only
    // (auto-hangs when both axial MIPs exist; inert when a vendor has no axial neck MIP).
    { name: 'CTA MIP axial (head + carotid)', selectors: ['miphead_ax', 'mipneck_ax'], voi: WINDOW.cta },
    { name: 'CTA CPR carotid (L + R)', selectors: ['cprlt', 'cprrt'], voi: WINDOW.cta },
    { name: 'CTA Head reformats (cor + sag)', selectors: ['corhead', 'saghead'], voi: WINDOW.cta },
    { name: 'CTA Neck reformats (cor + sag)', selectors: ['corneck', 'sagneck'], voi: WINDOW.cta },
  ],
  // Densest-fully-matched current-only fallback (below the group stages).
  currentView: ['axhead', 'miphead_ax', 'mipneck_cor'],
});

export default hpCompareCTA;
