import buildCompareProtocol, { PLANE_SELECTORS } from './buildCompareProtocol';

/**
 * Generic CT current-vs-prior comparison: axial / coronal / sagittal, current
 * beside prior. Used for any CT exam that doesn't have a more specific protocol
 * (spine, chest, head).
 */
export const hpCompareCT = buildCompareProtocol({
  id: '@pacsai/compareCT',
  name: 'CT Compare',
  description: 'Current vs prior CT — axial/coronal/sagittal, side by side',
  modalities: ['CT'],
  selectors: PLANE_SELECTORS,
  stages: [
    { name: 'Axial (current/prior)', selector: 'ax' },
    { name: 'Coronal (current/prior)', selector: 'cor' },
    { name: 'Sagittal (current/prior)', selector: 'sag' },
  ],
});

export default hpCompareCT;
