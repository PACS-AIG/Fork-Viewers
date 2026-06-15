import buildCompareProtocol from './buildCompareProtocol';

/**
 * MR abdomen / MRCP comparison.
 *
 * Abdominal MR is read by SEQUENCE, not just plane: T2 (axial + coronal — HASTE/
 * BLADE/TRUFI/SPACE), the T1 VIBE Dixon set (in-/opposed-phase + water/fat), DWI
 * (high-b trace + ADC), and the MRCP cholangiogram projections (thick-slab / radial
 * MIP / "wagon wheel"). The generic plane-only compareMR shows only one axial + one
 * coronal, leaving the rest of the sequences unhung — this lays them out and
 * out-weights generic MR for abdomen/MRCP studies.
 *
 * FIRST CUT — keywords are seeded from Siemens naming seen in real studies
 * (t2_haste/blade/trufi, t2_space, t1_vibe_dixon_*_in/opp/W/F, ep2d_diff_*_TRACEW/
 * ADC, *_MIP_Radials, "WAGON WHEEL"). They will need tuning for other vendors
 * (GE LAVA/SSFSE, Philips mDIXON); confirm the sequence set + reading order with the
 * abdominal MR radiologists.
 */

// Tokens marking the MRCP cholangiogram PROJECTION images (not the anatomical T2).
const MRCP_WORDS = ['mrcp', 'wagon', 'radial', 'mip'];

export const hpCompareMRAbdomen = buildCompareProtocol({
  id: '@pacsai/compareMRAbdomen',
  name: 'MR Abdomen / MRCP Compare',
  description: 'Current vs prior MR abdomen/MRCP — by sequence (T2, T1 Dixon, DWI, MRCP)',
  modalities: ['MR'],
  bodyPartKeywords: ['abdomen', 'mrcp', 'liver', 'hepat', 'pancrea', 'biliary'],
  // No-prior front-anchored fallback (below the task groups): core review sequences.
  currentView: ['t2ax', 't2cor', 't1opp', 'dwi'],
  selectors: [
    // T2 anatomical (axial/coronal). Exclude the Dixon / DWI / MRCP-projection series.
    {
      key: 't2ax',
      plane: 'axial',
      keywords: ['t2', 'haste', 'blade', 'trufi', 'truefisp', 'tse', 'ssfse', 'fiesta'],
      excludeKeywords: ['t1', 'dixon', 'vibe', 'diff', 'adc', 'trace', ...MRCP_WORDS],
    },
    {
      key: 't2cor',
      plane: 'coronal',
      keywords: ['t2', 'haste', 'space', 'tse'],
      excludeKeywords: ['t1', 'dixon', 'vibe', 'diff', 'adc', 'trace', ...MRCP_WORDS],
    },
    // T1 VIBE Dixon set — require a Dixon/VIBE/T1 token AND the phase/species suffix.
    // The single-letter suffixes (_W/_F) and '_in' are substring matches, so the
    // Dixon-token group is what keeps them from catching unrelated series.
    {
      key: 't1in',
      preferPlane: 'axial',
      keywordGroups: [['dixon', 'vibe', 't1'], ['_in', 'in-phase', 'inphase', '_ip']],
      excludeKeywords: ['opp', 'water', '_w', 'fat', '_f', ...MRCP_WORDS],
    },
    {
      key: 't1opp',
      preferPlane: 'axial',
      keywordGroups: [['dixon', 'vibe', 't1'], ['opp', 'opposed', '_op']],
      excludeKeywords: [...MRCP_WORDS],
    },
    {
      key: 't1w',
      preferPlane: 'axial',
      keywordGroups: [['dixon', 'vibe', 't1'], ['_w', 'water', '_wat']],
      excludeKeywords: ['_f', 'fat', 'opp', '_in', ...MRCP_WORDS],
    },
    {
      key: 't1f',
      preferPlane: 'axial',
      keywordGroups: [['dixon', 'vibe', 't1'], ['_f', '_fat']],
      excludeKeywords: ['_w', 'water', 'opp', '_in', ...MRCP_WORDS],
    },
    // Diffusion: high-b trace (exclude ADC / derived maps).
    {
      key: 'dwi',
      preferPlane: 'axial',
      keywords: ['diff', 'dwi', 'trace', 'tracew'],
      excludeKeywords: ['adc', 'exp', '_fa', 'dki', 'mip'],
    },
    { key: 'adc', preferPlane: 'axial', keywords: ['adc'] },
    // MRCP cholangiogram projections (thick-slab / radial MIP / wagon wheel). No plane
    // requirement — the rotational "wagon wheel" has no consistent orientation.
    { key: 'mrcp', keywords: MRCP_WORDS },
  ],
  // Current vs prior (per sequence) — these lead when a prior exists.
  stages: [
    { name: 'T2 axial (current/prior)', selector: 't2ax' },
    { name: 'T2 coronal (current/prior)', selector: 't2cor' },
    { name: 'T1 in-phase (current/prior)', selector: 't1in' },
    { name: 'T1 opposed (current/prior)', selector: 't1opp' },
    { name: 'T1 water (current/prior)', selector: 't1w' },
    { name: 'DWI (current/prior)', selector: 'dwi' },
    { name: 'MRCP (current/prior)', selector: 'mrcp' },
  ],
  // No prior: pageable task groups. T2 ax+cor is group 0 (the default hang); then the
  // Dixon 4-up, DWI+ADC, and the MRCP projections.
  currentStages: [
    { name: 'T2 (axial + coronal)', selectors: ['t2ax', 't2cor'] },
    { name: 'T1 Dixon (in / opp / water / fat)', selectors: ['t1in', 't1opp', 't1w', 't1f'] },
    { name: 'DWI + ADC', selectors: ['dwi', 'adc'] },
    { name: 'MRCP', selectors: ['mrcp'] },
  ],
});

export default hpCompareMRAbdomen;
