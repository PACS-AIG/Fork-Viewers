import buildCompareProtocol, { PLANE_SELECTORS } from './buildCompareProtocol';

/**
 * Generic MR current-vs-prior comparison: axial / coronal / sagittal, current
 * beside prior. Fallback for any MR exam without a more specific protocol (spine,
 * brain). Multi-region sessions keep each study on its own dedicated protocol (see
 * loadRelevantPriors), so this stays a simple, predictable single-study comparison.
 * NOTE: relies on the computed `pacsaiPlane`; MR naming varies, so brain/spine get
 * dedicated protocols.
 */
export const hpCompareMR = buildCompareProtocol({
  id: '@pacsai/compareMR',
  name: 'MR Compare',
  description: 'Current vs prior MR — axial/coronal/sagittal, side by side',
  modalities: ['MR'],
  selectors: PLANE_SELECTORS,
  stages: [
    { name: 'Axial (current/prior)', selector: 'ax' },
    { name: 'Coronal (current/prior)', selector: 'cor' },
    { name: 'Sagittal (current/prior)', selector: 'sag' },
  ],
});

export default hpCompareMR;
