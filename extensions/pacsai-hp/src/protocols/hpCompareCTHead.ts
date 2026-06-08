import buildCompareProtocol, { PLANE_SELECTORS, WINDOW } from './buildCompareProtocol';

/**
 * CT head/brain comparison. Axial review at brain and bone windows, current
 * beside prior. (Non-contrast head CT is essentially axial-only.)
 */
export const hpCompareCTHead = buildCompareProtocol({
  id: '@pacsai/compareCTHead',
  name: 'CT Head Compare',
  description: 'Current vs prior CT head — brain/bone windows',
  modalities: ['CT'],
  bodyPartKeywords: ['head', 'brain'],
  selectors: PLANE_SELECTORS,
  stages: [
    { name: 'Axial Brain (current/prior)', selector: 'ax', voi: WINDOW.brain },
    { name: 'Axial Bone (current/prior)', selector: 'ax', voi: WINDOW.bone },
  ],
});

export default hpCompareCTHead;
