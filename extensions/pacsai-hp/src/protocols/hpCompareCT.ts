import buildCompareProtocol from './buildCompareProtocol';

/**
 * CT current-vs-prior comparison. Hangs the current CT next to up to 2 relevant
 * prior CTs (degrading to current+1 / current-only when fewer are available).
 */
export const hpCompareCT = buildCompareProtocol({
  id: '@pacsai/compareCT',
  name: 'CT Compare',
  description: 'Current vs prior CT, side by side',
  modalities: ['CT'],
  maxPriors: 2,
});

export default hpCompareCT;
