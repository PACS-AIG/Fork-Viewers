import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT chest comparison.
 *
 * Chest CT is read at (at least) a lung window on a sharp/lung-kernel recon and a
 * mediastinal (soft-tissue) window on a soft-kernel recon — these are DISTINCT
 * series, not the same series re-windowed (OHIF preserves the VOI per display set
 * across stages, so window-only stages wouldn't reliably re-apply). We select
 * them by computed kernel class (soft vs lung) and plane. The axial MIP (a sharp
 * slab MIP, here a Br60 contrast recon) is its own view at a mediastinal window.
 *
 * With a prior, the per-view current|prior stages lead (Axial Lung → Axial Soft →
 * Coronal → Sagittal → Axial MIP). Chest CTs often have no prior, so beyond those
 * the protocol defines pageable current-only GROUP stages: the lung+soft+coronal
 * trio (the default hang), then the cor/sag reformats, then the axial MIP — so sag
 * and the MIP are reachable without a prior.
 */
export const hpCompareCTChest = buildCompareProtocol({
  id: '@pacsai/compareCTChest',
  name: 'CT Chest Compare',
  description: 'Current vs prior CT chest — lung & soft-tissue axial, coronal/sagittal, axial MIP',
  modalities: ['CT'],
  bodyPartKeywords: ['chest', 'thorax', 'lung'],
  // No-prior multi-view fallback (below the group stages): lung + soft + coronal.
  currentView: ['axlung', 'axsoft', 'cor'],
  selectors: [
    // Prefer a lung-kernel recon, but fall back to the soft axial (read at a lung
    // window) when the study has none — so the lung pane always fills.
    { key: 'axlung', plane: 'axial', preferKernel: 'lung', excludeKeywords: ['mip'] },
    { key: 'axsoft', plane: 'axial', kernel: 'soft', excludeKeywords: ['mip'] },
    { key: 'cor', plane: 'coronal', excludeKeywords: ['mip'] },
    { key: 'sag', plane: 'sagittal', excludeKeywords: ['mip'] },
    // Axial slab MIP (vascular/mediastinal); read at a soft-tissue window.
    { key: 'mip', plane: 'axial', keywords: ['mip'] },
  ],
  stages: [
    { name: 'Axial Lung (current/prior)', selector: 'axlung', voi: WINDOW.lung },
    { name: 'Axial Soft Tissue (current/prior)', selector: 'axsoft', voi: WINDOW.softTissue },
    { name: 'Coronal (current/prior)', selector: 'cor', voi: WINDOW.softTissue },
    { name: 'Sagittal (current/prior)', selector: 'sag', voi: WINDOW.softTissue },
    { name: 'Axial MIP (current/prior)', selector: 'mip', voi: WINDOW.softTissue },
  ],
  // No prior: pageable current-only groups, by task. The lung+soft+coronal trio is
  // group 0, so it stays the default auto-hang; sag and MIP become pageable.
  currentStages: [
    { name: 'Axial lung + soft + coronal', selectors: ['axlung', 'axsoft', 'cor'] },
    { name: 'Reformats (cor + sag)', selectors: ['cor', 'sag'] },
    { name: 'Axial MIP', selectors: ['mip'] },
  ],
  // "All-in-one CT": the ONE soft axial in two linked-scroll panes at lung +
  // mediastinal windows. Complements the kernel-based stages above — useful when
  // the study has no dedicated lung-kernel recon (window-only lung on the soft
  // series) or to compare windows on identical pixels.
  multiWlStages: [
    {
      name: 'Lung · Mediastinum (one series)',
      selector: 'axsoft',
      panes: [
        { name: 'Lung', voi: WINDOW.lung },
        { name: 'Mediastinum', voi: WINDOW.softTissue },
      ],
    },
  ],
});

export default hpCompareCTChest;
