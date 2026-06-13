import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT angiography of the chest (pulmonary embolism / PE study) comparison.
 *
 * A chest CTA ("CT ANGIO CHEST", "CTA CHEST PE") is a contrast-enhanced chest CT read
 * for pulmonary-artery filling defects: the primary view is the thin soft-kernel
 * contrast axial at a PE/vascular window (WW700/WC100) to track clot into the segmental
 * branches, plus a lung-kernel axial at a lung window for the parenchyma, and cor/sag
 * reformats (vascular window). Some scanners also emit a slab MIP.
 *
 * It is distinct from compareCTChest (a non-contrast/routine chest CT, read at a plain
 * mediastinal window) only in the windowing: the soft axial and reformats hang at the
 * PE window here, not standard soft-tissue. It out-weights both compareCTChest and the
 * head/neck compareCTA by requiring BOTH an "angio"/"cta" token AND a chest token — so
 * it claims only chest angio, while compareCTA (now chest-excluded) keeps head/neck and
 * compareCTChest keeps plain chest CT.
 *
 * With a prior, the per-view current|prior stages lead (Axial Soft/PE → Axial Lung →
 * Coronal → Sagittal → Axial MIP). PE studies often have no prior, so beyond those the
 * protocol defines pageable current-only GROUP stages: the soft+lung+coronal trio (the
 * default hang), then the cor/sag reformats, then the axial MIP.
 */
export const hpCompareCTAChest = buildCompareProtocol({
  id: '@pacsai/compareCTAChest',
  name: 'CTA Chest (PE) Compare',
  description:
    'Current vs prior CT angiography chest (PE) — soft/PE & lung axial, coronal/sagittal, axial MIP',
  modalities: ['CT'],
  // Require BOTH a chest token AND an angio token (AND-ed groups), so this claims only
  // chest angio — not plain chest CT (compareCTChest) nor head/neck angio (compareCTA).
  bodyPartKeywords: ['chest', 'thorax', 'pulmonary'],
  requireKeywordGroups: [['angio', 'cta']],
  matchWeight: 150,
  // No-prior multi-view fallback (below the group stages): soft/PE + lung + coronal.
  currentView: ['axsoft', 'axlung', 'cor'],
  selectors: [
    { key: 'axsoft', plane: 'axial', kernel: 'soft', excludeKeywords: ['mip'] },
    { key: 'axlung', plane: 'axial', kernel: 'lung', excludeKeywords: ['mip'] },
    { key: 'cor', plane: 'coronal', excludeKeywords: ['mip'] },
    { key: 'sag', plane: 'sagittal', excludeKeywords: ['mip'] },
    // Axial slab MIP — read at the PE/vascular window.
    { key: 'mip', plane: 'axial', keywords: ['mip'] },
  ],
  stages: [
    // PE read leads: contrast soft axial at the vascular/PE window.
    { name: 'Axial Soft/PE (current/prior)', selector: 'axsoft', voi: WINDOW.cta },
    { name: 'Axial Lung (current/prior)', selector: 'axlung', voi: WINDOW.lung },
    { name: 'Coronal (current/prior)', selector: 'cor', voi: WINDOW.cta },
    { name: 'Sagittal (current/prior)', selector: 'sag', voi: WINDOW.cta },
    { name: 'Axial MIP (current/prior)', selector: 'mip', voi: WINDOW.cta },
  ],
  // No prior: pageable current-only groups, by task. The soft+lung+coronal trio is
  // group 0, so it stays the default auto-hang; sag and MIP become pageable.
  currentStages: [
    { name: 'Axial soft/PE + lung + coronal', selectors: ['axsoft', 'axlung', 'cor'] },
    { name: 'Reformats (cor + sag)', selectors: ['cor', 'sag'] },
    { name: 'Axial MIP', selectors: ['mip'] },
  ],
});

export default hpCompareCTAChest;
