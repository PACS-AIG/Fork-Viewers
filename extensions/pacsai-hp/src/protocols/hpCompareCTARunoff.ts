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
    // Thick-slab MIP (any plane; this vendor emits an axial 10x5 MIP).
    { key: 'mip', keywords: ['mip'], excludeKeywords: NOT_DIAGNOSTIC },
  ],
  // Current vs prior (per view) — lead when a prior exists.
  stages: [
    { name: 'Runoff coronal (current/prior)', selector: 'cor', voi: WINDOW.cta },
    { name: 'Runoff sagittal (current/prior)', selector: 'sag', voi: WINDOW.cta },
    { name: 'Runoff axial source (current/prior)', selector: 'ax', voi: WINDOW.cta },
    { name: 'Runoff MIP (current/prior)', selector: 'mip', voi: WINDOW.cta },
  ],
  // No prior: pageable task groups. The cor+sag reformats are group 0 (default hang).
  currentStages: [
    { name: 'Runoff reformats (cor + sag)', selectors: ['cor', 'sag'], voi: WINDOW.cta },
    { name: 'Runoff axial source', selectors: ['ax'], voi: WINDOW.cta },
    { name: 'Runoff MIP', selectors: ['mip'], voi: WINDOW.cta },
  ],
  currentView: ['cor', 'sag', 'ax'],
});

export default hpCompareCTARunoff;
