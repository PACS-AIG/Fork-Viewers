import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT chest comparison.
 *
 * Chest CT is read at (at least) a lung window on a sharp/lung-kernel recon and a
 * mediastinal (soft-tissue) window on a soft-kernel recon — these are DISTINCT
 * series, not the same series re-windowed (OHIF preserves the VOI per display set
 * across stages, so window-only stages wouldn't reliably re-apply). We select
 * them by computed kernel class (soft vs lung) and plane, excluding MIPs.
 *
 * Stages, each current beside prior: Axial Lung → Axial Soft Tissue → Coronal →
 * Sagittal. Any stage whose series is absent degrades (disabled / skipped).
 */
export const hpCompareCTChest = buildCompareProtocol({
  id: '@pacsai/compareCTChest',
  name: 'CT Chest Compare',
  description: 'Current vs prior CT chest — lung & soft-tissue axial + coronal/sagittal',
  modalities: ['CT'],
  bodyPartKeywords: ['chest', 'thorax', 'lung'],
  // No-prior multi-view: axial lung + axial soft-tissue + coronal.
  currentView: ['axlung', 'axsoft', 'cor'],
  selectors: [
    { key: 'axlung', plane: 'axial', kernel: 'lung', excludeKeywords: ['mip'] },
    { key: 'axsoft', plane: 'axial', kernel: 'soft', excludeKeywords: ['mip'] },
    { key: 'cor', plane: 'coronal', excludeKeywords: ['mip'] },
    { key: 'sag', plane: 'sagittal', excludeKeywords: ['mip'] },
  ],
  stages: [
    { name: 'Axial Lung (current/prior)', selector: 'axlung', voi: WINDOW.lung },
    { name: 'Axial Soft Tissue (current/prior)', selector: 'axsoft', voi: WINDOW.softTissue },
    { name: 'Coronal (current/prior)', selector: 'cor', voi: WINDOW.softTissue },
    { name: 'Sagittal (current/prior)', selector: 'sag', voi: WINDOW.softTissue },
  ],
});

export default hpCompareCTChest;
