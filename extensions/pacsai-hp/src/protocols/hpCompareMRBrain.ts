import buildCompareProtocol from './buildCompareProtocol';

/**
 * MR brain comparison. MR brain is organized by SEQUENCE rather than plane, so
 * stages compare the same sequence (T1 / T2 / FLAIR / DWI) current beside prior.
 * Sequences are matched by SeriesDescription keywords (T2 excludes FLAIR so the
 * "T2 FLAIR" series doesn't get grabbed as plain T2).
 */
export const hpCompareMRBrain = buildCompareProtocol({
  id: '@pacsai/compareMRBrain',
  name: 'MR Brain Compare',
  description: 'Current vs prior MR brain — by sequence (T1/T2/FLAIR/DWI)',
  modalities: ['MR'],
  bodyPartKeywords: ['brain', 'head'],
  selectors: [
    { key: 't1', keywords: ['t1'] },
    { key: 't2', keywords: ['t2'], excludeKeywords: ['flair'] },
    { key: 'flair', keywords: ['flair'] },
    { key: 'dwi', keywords: ['dwi', 'diff'] },
  ],
  stages: [
    { name: 'T1 (current/prior)', selector: 't1' },
    { name: 'T2 (current/prior)', selector: 't2' },
    { name: 'FLAIR (current/prior)', selector: 'flair' },
    { name: 'DWI (current/prior)', selector: 'dwi' },
  ],
});

export default hpCompareMRBrain;
