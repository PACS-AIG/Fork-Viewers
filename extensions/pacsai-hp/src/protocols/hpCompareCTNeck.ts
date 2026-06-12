import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT neck (soft tissue) comparison.
 *
 * A contrast neck CT (e.g. "CT NECK SOFT TISSUE W CONTRAST") is read on soft-tissue
 * windowing across axial + coronal + sagittal. Dedicated so it out-weights the
 * generic CT fallback and applies the mediastinal/soft-tissue window. CTA head/neck
 * still wins for angio studies (matchWeight 150 vs the default 100 here), so this
 * only claims plain neck soft-tissue exams — "CT ANGIO HEAD/NECK" goes to compareCTA.
 *
 * With a prior, the per-view current|prior stages lead (Axial → Coronal → Sagittal).
 * No prior: the three planes tile together (current-only), degrading as views are
 * absent. Neck CTs are a single soft-tissue recon per plane, so no kernel/MIP split
 * is needed — just exclude any derived MIP from the diagnostic planes.
 */
export const hpCompareCTNeck = buildCompareProtocol({
  id: '@pacsai/compareCTNeck',
  name: 'CT Neck Compare',
  description: 'Current vs prior CT neck (soft tissue) — axial/coronal/sagittal',
  modalities: ['CT'],
  bodyPartKeywords: ['neck'],
  // No-prior multi-view: axial + coronal + sagittal.
  currentView: ['ax', 'cor', 'sag'],
  selectors: [
    { key: 'ax', plane: 'axial', excludeKeywords: ['mip'] },
    { key: 'cor', plane: 'coronal', excludeKeywords: ['mip'] },
    { key: 'sag', plane: 'sagittal', excludeKeywords: ['mip'] },
  ],
  stages: [
    { name: 'Axial (current/prior)', selector: 'ax', voi: WINDOW.softTissue },
    { name: 'Coronal (current/prior)', selector: 'cor', voi: WINDOW.softTissue },
    { name: 'Sagittal (current/prior)', selector: 'sag', voi: WINDOW.softTissue },
  ],
});

export default hpCompareCTNeck;
