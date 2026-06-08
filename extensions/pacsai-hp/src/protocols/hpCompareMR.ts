import buildCompareProtocol, { PLANE_SELECTORS } from './buildCompareProtocol';

/**
 * Generic MR current-vs-prior comparison: axial / coronal / sagittal, current
 * beside prior. Used for any MR exam without a more specific protocol (spine,
 * brain). NOTE: relies on ax/cor/sag appearing in SeriesDescription; MR series
 * naming varies, so brain/spine get dedicated protocols.
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
