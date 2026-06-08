import buildCompareProtocol from './buildCompareProtocol';

/**
 * CR/DX (projection radiography) current-vs-prior comparison. Projection imaging
 * is typically read one-up, so this hangs current | single prior, degrading to
 * current-only when no prior is available.
 */
export const hpCompareCR = buildCompareProtocol({
  id: '@pacsai/compareCR',
  name: 'X-Ray Compare',
  description: 'Current vs prior radiograph, side by side',
  modalities: ['CR', 'DX', 'XR', 'RG'],
  maxPriors: 1,
});

export default hpCompareCR;
