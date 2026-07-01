import buildCompareProtocol from './buildCompareProtocol';

/**
 * MR brain comparison.
 *
 * Brain MR is read by SEQUENCE. Axial is the usual review plane, but T1 is often
 * a 3D sagittal-acquired MPRAGE (no separate axial), so plane is a *preference*
 * (preferPlane), not a hard requirement — axial wins when present, otherwise the
 * available plane still matches.
 *
 * Sequence keywords handle vendor naming, especially Siemens:
 *  - FLAIR is often "dark-fluid" / "tirm" (not the literal word "flair").
 *  - T2 must exclude FLAIR (dark-fluid), SWI/GRE and MIPs.
 *  - SWI/GRE is the susceptibility stage (exclude MIP overlays).
 *  - DWI is the trace image (exclude ADC / derived maps). When the series is
 *    split by b-value (see the DWI splitter), the DWI selector prefers the high-b
 *    trace (b1000) over b0 via preferHighBValue.
 *
 * Stages, each current beside prior: T1, T2, FLAIR, SWI/GRE, DWI. Plus a
 * current-only "DWI (high-b) + ADC" pair — the restricted-diffusion read.
 */
const FLAIR_WORDS = ['flair', 'dark-fluid', 'dark_fluid', 'darkfluid', 'tirm'];
const SHARP_WORDS = ['swi', 'gre', 't2*', 'star', 'susc', 'hemo'];

export const hpCompareMRBrain = buildCompareProtocol({
  id: '@pacsai/compareMRBrain',
  name: 'MR Brain Compare',
  description: 'Current vs prior MR brain — by sequence (T1/T2/FLAIR/SWI/DWI)',
  modalities: ['MR'],
  bodyPartKeywords: ['brain', 'head'],
  // No-prior multi-view: the core sequences (T1/T2/FLAIR/DWI) tiled 1×4.
  currentView: ['t1', 't2', 'flair', 'dwi'],
  selectors: [
    {
      key: 't1',
      preferPlane: 'axial',
      keywords: ['t1', 'mprage', 'bravo', 'spgr', 'tfl', 'vibe'],
      excludeKeywords: [...FLAIR_WORDS, ...SHARP_WORDS, 'mip'],
    },
    {
      key: 't2',
      preferPlane: 'axial',
      keywords: ['t2', 'haste', 'tse', 'frfse'],
      excludeKeywords: [...FLAIR_WORDS, ...SHARP_WORDS, 'mip', 'fl3d'],
    },
    {
      key: 'flair',
      preferPlane: 'axial',
      keywords: FLAIR_WORDS,
      excludeKeywords: ['mip'],
    },
    {
      key: 'swi',
      preferPlane: 'axial',
      keywords: SHARP_WORDS,
      excludeKeywords: ['mip'], // exclude SWI mIP overlays
    },
    {
      key: 'dwi',
      preferPlane: 'axial',
      keywords: ['dwi', 'diff', 'trace', 'tracew'],
      excludeKeywords: ['adc', 'exp', '_fa', 'mip'], // exclude ADC / derived maps
      // When the series is split by b-value, hang the high-b trace (b1000), not b0.
      preferHighBValue: true,
    },
    {
      key: 'adc',
      preferPlane: 'axial',
      keywords: ['adc'],
      // Exclude the exponential/eADC map and FA/MIP — read the true ADC.
      excludeKeywords: ['eadc', 'exp', '_fa', 'mip'],
    },
  ],
  stages: [
    { name: 'T1 (current/prior)', selector: 't1' },
    { name: 'T2 (current/prior)', selector: 't2' },
    { name: 'FLAIR (current/prior)', selector: 'flair' },
    { name: 'SWI/GRE (current/prior)', selector: 'swi' },
    { name: 'DWI (current/prior)', selector: 'dwi' },
  ],
  // Restricted-diffusion read: the high-b trace beside the ADC (current study).
  // Auto-eligible only when both are present; otherwise pageable.
  currentStages: [{ name: 'DWI (high-b) + ADC', selectors: ['dwi', 'adc'] }],
});

export default hpCompareMRBrain;
