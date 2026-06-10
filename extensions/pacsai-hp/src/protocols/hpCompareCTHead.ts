import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT head/brain comparison. Head CT typically has a soft/brain-kernel axial recon
 * and a separate sharp bone-kernel axial recon ("...BONE"). We select them as
 * distinct series so the Brain and Bone stages show the correct recon (not the
 * same series with a different window — which OHIF wouldn't reliably re-apply,
 * since it preserves the VOI presentation per display set across stages).
 *
 * Each stage is current beside prior. The bone stage degrades (disabled) if no
 * dedicated bone series exists.
 */
export const hpCompareCTHead = buildCompareProtocol({
  id: '@pacsai/compareCTHead',
  name: 'CT Head Compare',
  description: 'Current vs prior CT head — brain & bone axial recons',
  modalities: ['CT'],
  bodyPartKeywords: ['head', 'brain'],
  selectors: [
    // Brain/soft-kernel axial (exclude the bone recon).
    { key: 'ax', keywords: ['ax'], excludeKeywords: ['bone'] },
    // Dedicated bone-kernel axial recon.
    { key: 'axbone', keywords: ['bone'] },
  ],
  stages: [
    { name: 'Axial Brain (current/prior)', selector: 'ax', voi: WINDOW.brain },
    { name: 'Axial Bone (current/prior)', selector: 'axbone', voi: WINDOW.bone },
  ],
});

export default hpCompareCTHead;
