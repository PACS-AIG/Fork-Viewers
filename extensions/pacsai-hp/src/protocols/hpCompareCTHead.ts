import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT head/brain comparison.
 *
 * Head CT typically has a soft/brain-kernel axial recon plus a sharp bone-kernel
 * axial recon ("...BONE"), and coronal/sagittal reformats. We select the brain
 * and bone axials as DISTINCT series (not the same series with a different
 * window — OHIF preserves the VOI presentation per display set across stages, so
 * a window-only stage wouldn't reliably re-apply).
 *
 * Stages, each current beside prior: Axial Brain → Axial Bone → Coronal →
 * Sagittal. Any stage whose series is absent degrades (disabled). The trailing
 * current-only overview is the no-prior fallback.
 */
export const hpCompareCTHead = buildCompareProtocol({
  id: '@pacsai/compareCTHead',
  name: 'CT Head Compare',
  description: 'Current vs prior CT head — brain/bone axial + coronal/sagittal',
  modalities: ['CT'],
  bodyPartKeywords: ['head', 'brain'],
  selectors: [
    { key: 'ax', keywords: ['ax'], excludeKeywords: ['bone'] }, // brain/soft-kernel axial
    { key: 'axbone', keywords: ['bone'] }, // bone-kernel axial recon
    { key: 'cor', keywords: ['cor'], excludeKeywords: ['bone'] },
    { key: 'sag', keywords: ['sag'], excludeKeywords: ['bone'] },
  ],
  stages: [
    { name: 'Axial Brain (current/prior)', selector: 'ax', voi: WINDOW.brain },
    { name: 'Axial Bone (current/prior)', selector: 'axbone', voi: WINDOW.bone },
    { name: 'Coronal (current/prior)', selector: 'cor', voi: WINDOW.brain },
    { name: 'Sagittal (current/prior)', selector: 'sag', voi: WINDOW.brain },
  ],
});

export default hpCompareCTHead;
