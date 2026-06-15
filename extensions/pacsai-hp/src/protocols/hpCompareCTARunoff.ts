import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT angiography of the extremities / peripheral runoff comparison.
 *
 * A lower- (or upper-) extremity CTA runoff is a long contrast-enhanced acquisition
 * from the aorto-iliac vessels to the feet, read for stenosis/occlusion. The vessels
 * are followed longitudinally on the CORONAL (and sagittal) reformats and a thick-slab
 * MIP, with the thin axial source for cross-sectional lumen / mural calcium. It is
 * distinct from head/neck compareCTA (no carotid CPR / circle-of-Willis MIPs, different
 * reformats), so it requires an "angio"/"cta" token AND an extremity/runoff token —
 * claiming only peripheral CTA and out-weighting both compareCTA and generic CT.
 *
 * FIRST CUT — keywords seeded from Siemens "CTA RUNOFF … Bv40 … iMAR" naming; the thick
 * MIP here is axial (10x5). Confirm the view set + reading order with the vascular rads
 * (peripheral runoff is often reviewed station-by-station: aorto-iliac → thigh → calf →
 * foot, and some prefer a coronal MIP/CPR lead).
 */
const CTA_WORDS = ['angio', 'cta'];

// Bolus-tracking / scout / derived series kept out of the diagnostic stages.
// 'monitoring' also catches the 'premonitoring' bolus-tracking series.
const NOT_DIAGNOSTIC = ['monitoring', 'topogram', 'scout', 'localizer', 'protocol', 'spin'];

export const hpCompareCTARunoff = buildCompareProtocol({
  id: '@pacsai/compareCTARunoff',
  name: 'CTA Runoff (Extremity) Compare',
  description:
    'Current vs prior CT angiography runoff (extremity) — coronal/sagittal reformats, axial source, MIP',
  modalities: ['CT'],
  // Require BOTH an extremity/runoff token AND an angio token, so this claims only
  // peripheral CTA (not plain extremity CT, nor head/neck/chest angio).
  bodyPartKeywords: ['extremity', 'runoff', 'lower limb', 'leg', 'femoral', 'peripheral'],
  requireKeywordGroups: [CTA_WORDS],
  matchWeight: 150,
  // Drop derived color (3D-spin / VR renders) from the diagnostic stages; also avoids
  // the RGB thumbnail crash auto-hanging them.
  excludeColorSeries: true,
  selectors: [
    // Longitudinal vessel review — coronal/sagittal reformats are primary for runoff.
    { key: 'cor', plane: 'coronal', excludeKeywords: [...NOT_DIAGNOSTIC, 'mip'] },
    { key: 'sag', plane: 'sagittal', excludeKeywords: [...NOT_DIAGNOSTIC, 'mip'] },
    // Thin axial source — cross-sectional lumen / mural calcium.
    { key: 'ax', plane: 'axial', excludeKeywords: [...NOT_DIAGNOSTIC, 'mip'] },
    // Thick-slab MIP, split by plane: the CORONAL MIP is the classic whole-tree runoff
    // overview. Some vendors emit only an axial MIP, so keep an axial MIP view too.
    { key: 'mipcor', plane: 'coronal', keywords: ['mip'], excludeKeywords: NOT_DIAGNOSTIC },
    { key: 'mipsag', plane: 'sagittal', keywords: ['mip'], excludeKeywords: NOT_DIAGNOSTIC },
    { key: 'mipax', plane: 'axial', keywords: ['mip'], excludeKeywords: NOT_DIAGNOSTIC },
  ],
  // Current vs prior (per view) — lead when a prior exists.
  stages: [
    { name: 'Runoff coronal (current/prior)', selector: 'cor', voi: WINDOW.cta },
    { name: 'Runoff coronal MIP (current/prior)', selector: 'mipcor', voi: WINDOW.cta },
    { name: 'Runoff sagittal (current/prior)', selector: 'sag', voi: WINDOW.cta },
    { name: 'Runoff axial source (current/prior)', selector: 'ax', voi: WINDOW.cta },
    { name: 'Runoff axial MIP (current/prior)', selector: 'mipax', voi: WINDOW.cta },
  ],
  // No prior: pageable task groups. A selector repeated twice tiles both per-leg series
  // (bilateral runoff). Order leads with the bilateral coronal reformats when present,
  // then falls back to coronal+sagittal (unilateral), the MIPs, and the axial source.
  currentStages: [
    // Bilateral: the two per-leg oblique coronal reformats side by side.
    { name: 'Runoff coronal — both legs', selectors: ['cor', 'cor'], voi: WINDOW.cta },
    // Bilateral coronal MIP (whole arterial tree, per leg).
    { name: 'Runoff coronal MIP — both legs', selectors: ['mipcor', 'mipcor'], voi: WINDOW.cta },
    // Unilateral-friendly: coronal + sagittal reformat.
    { name: 'Runoff reformats (cor + sag)', selectors: ['cor', 'sag'], voi: WINDOW.cta },
    // Coronal reformat beside its coronal MIP.
    { name: 'Runoff coronal (reformat + MIP)', selectors: ['cor', 'mipcor'], voi: WINDOW.cta },
    // Axial source beside the axial MIP (vendors whose only MIP is axial).
    { name: 'Runoff axial (source + MIP)', selectors: ['ax', 'mipax'], voi: WINDOW.cta },
    { name: 'Runoff axial source', selectors: ['ax'], voi: WINDOW.cta },
  ],
  currentView: ['cor', 'sag', 'ax'],
});

export default hpCompareCTARunoff;
