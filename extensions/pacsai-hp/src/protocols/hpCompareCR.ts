import buildCompareProtocol from './buildCompareProtocol';

/**
 * CR/DX (projection radiography) current-vs-prior comparison. Single image per
 * study, current beside prior. Projection images have one frame, so the series
 * floor is 0 and scout-exclusion is off.
 */
export const hpCompareCR = buildCompareProtocol({
  id: '@pacsai/compareCR',
  name: 'X-Ray Compare',
  description: 'Current vs prior radiograph, side by side',
  modalities: ['CR', 'DX', 'XR', 'RG'],
  seriesFloor: 0,
  excludeScouts: false,
  selectors: [{ key: 'img' }],
  stages: [{ name: 'Current/Prior', selector: 'img' }],
});

export default hpCompareCR;
