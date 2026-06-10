import buildCompareProtocol from './buildCompareProtocol';

/**
 * MR brain comparison.
 *
 * Brain MR is read by SEQUENCE, and comparison is same-sequence AND same-plane
 * (axial is the primary review plane). So each stage constrains to axial (via the
 * computed plane) and a specific sequence, with keyword exclusions so lookalikes
 * don't cross-match (e.g. "T2* GRE" must not satisfy plain T2; "T2 FLAIR" is FLAIR,
 * not T2).
 *
 * Stages, each current beside prior: T1, T2, T2-star/SWI, FLAIR, DWI. Any sequence
 * the study lacks degrades (its stage shows current-only, or is skipped if absent).
 */
export const hpCompareMRBrain = buildCompareProtocol({
  id: '@pacsai/compareMRBrain',
  name: 'MR Brain Compare',
  description: 'Current vs prior MR brain — axial by sequence (T1/T2/T2*/FLAIR/DWI)',
  modalities: ['MR'],
  bodyPartKeywords: ['brain', 'head'],
  selectors: [
    { key: 't1', plane: 'axial', keywords: ['t1', 'mprage'], excludeKeywords: ['flair'] },
    {
      key: 't2',
      plane: 'axial',
      keywords: ['t2'],
      // Keep plain T2 only: exclude FLAIR and susceptibility-weighted lookalikes.
      excludeKeywords: ['flair', 'gre', 'swi', 'star', 't2*', '*', 'hemo'],
    },
    { key: 'gre', plane: 'axial', keywords: ['gre', 'swi', 't2*', 'susc', 'hemo'] },
    { key: 'flair', plane: 'axial', keywords: ['flair'] },
    { key: 'dwi', plane: 'axial', keywords: ['dwi', 'diff', 'trace'], excludeKeywords: ['adc'] },
  ],
  stages: [
    { name: 'T1 (current/prior)', selector: 't1' },
    { name: 'T2 (current/prior)', selector: 't2' },
    { name: 'T2*/SWI (current/prior)', selector: 'gre' },
    { name: 'FLAIR (current/prior)', selector: 'flair' },
    { name: 'DWI (current/prior)', selector: 'dwi' },
  ],
});

export default hpCompareMRBrain;
