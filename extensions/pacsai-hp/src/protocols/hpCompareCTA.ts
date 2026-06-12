import buildCompareProtocol from './buildCompareProtocol';

/**
 * CT angiography (head/neck) comparison.
 *
 * A CTA produces many series — thin diagnostic source axials (head + neck), MIPs,
 * CPR carotids, 3D, plus a bolus-tracking MONITORING acquisition and topograms.
 * The generic/head protocols mishandle it: they match on "head" and (worse) prefer
 * the ORIGINAL acquisition, which in a CTA is the MONITORING slice (chest/arch),
 * not the diagnostic recon. So CTA gets its own protocol, out-weighting head/generic
 * CT for "angio"/"CTA" studies, with vascular-appropriate views and NO
 * prefer-ORIGINAL. Non-diagnostic/derived series (monitoring, topogram, scout,
 * protocol, CPR, 3D-spin) are excluded from the tiled stages — they remain in the
 * series panel.
 *
 * Stages, each current beside prior: CTA Head axial (source) -> Head MIP -> Neck
 * axial -> Head coronal -> Head sagittal. No-prior overview: head axial + neck
 * axial + MIP.
 */
const CTA_KEYWORDS = ['angio', 'cta'];

// Non-diagnostic / derived series kept out of the tiled stages.
const NOT_DIAGNOSTIC = ['monitoring', 'topogram', 'scout', 'localizer', 'protocol', 'spin', 'cpr'];

export const hpCompareCTA = buildCompareProtocol({
  id: '@pacsai/compareCTA',
  name: 'CTA Head/Neck Compare',
  description: 'Current vs prior CT angiography (head/neck) — source axial, MIP, neck',
  modalities: ['CT'],
  bodyPartKeywords: CTA_KEYWORDS,
  // Out-weight compareCTHead (which also matches the "head" in "CT ANGIO HEAD/NECK").
  matchWeight: 150,
  selectors: [
    { key: 'axhead', plane: 'axial', keywords: ['head'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'neck'] },
    { key: 'mip', plane: 'axial', keywords: ['mip'] },
    { key: 'axneck', plane: 'axial', keywords: ['neck'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'head'] },
    { key: 'corhead', plane: 'coronal', keywords: ['head'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'neck'] },
    { key: 'saghead', plane: 'sagittal', keywords: ['head'], excludeKeywords: [...NOT_DIAGNOSTIC, 'mip', 'neck'] },
  ],
  stages: [
    { name: 'CTA Head axial (current/prior)', selector: 'axhead' },
    { name: 'CTA Head MIP (current/prior)', selector: 'mip' },
    { name: 'CTA Neck axial (current/prior)', selector: 'axneck' },
    { name: 'CTA Head coronal (current/prior)', selector: 'corhead' },
    { name: 'CTA Head sagittal (current/prior)', selector: 'saghead' },
  ],
  // No-prior multi-view: source head axial + neck axial + MIP.
  currentView: ['axhead', 'axneck', 'mip'],
});

export default hpCompareCTA;
