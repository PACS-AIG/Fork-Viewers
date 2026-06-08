import buildCompareProtocol from './buildCompareProtocol';

/**
 * MR current-vs-prior comparison. Hangs the current MR next to up to 2 relevant
 * priors (MR commonly compares against prior MR or CT of the same region).
 */
export const hpCompareMR = buildCompareProtocol({
  id: '@pacsai/compareMR',
  name: 'MR Compare',
  description: 'Current vs prior MR, side by side',
  modalities: ['MR'],
  maxPriors: 2,
});

export default hpCompareMR;
