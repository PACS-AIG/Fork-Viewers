import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT head/brain comparison.
 *
 * Head CT typically has a soft/brain-kernel axial recon plus a sharp bone-kernel
 * axial recon ("...BONE"), and coronal/sagittal reformats. We select the brain
 * and bone axials as DISTINCT series (not the same series with a different
 * window — OHIF preserves the VOI presentation per display set across stages, so
 * a window-only stage wouldn't reliably re-apply).
 *
 * Stages, each current beside prior: Axial Brain → Axial Bone → Coronal →
 * Sagittal. Any stage whose series is absent degrades (disabled). The trailing
 * current-only overview is the no-prior fallback.
 */
export const hpCompareCTHead = buildCompareProtocol({
  id: '@pacsai/compareCTHead',
  name: 'CT Head Compare',
  description: 'Current vs prior CT head — brain/bone axial + coronal/sagittal',
  modalities: ['CT'],
  bodyPartKeywords: ['head', 'brain'],
  // No-prior multi-view, most-important first. `axbone` is LAST so the descending
  // fallback adds a 4-up (brain ax + cor + sag + bone ax) when a bone recon exists,
  // and gracefully drops to the 3-up (ax/cor/sag) when it's absent — so the bone
  // window is always reachable without a prior, with no regression for no-bone studies.
  currentView: ['ax', 'cor', 'sag', 'axbone'],
  selectors: [
    // Plane via computed orientation; soft/bone via computed ConvolutionKernel class.
    // ax prefers ORIGINAL ImageType so the primary axial acquisition wins over an
    // oblique/derived axial REFORMATS when both are present (head-specific — spine
    // intentionally relies on reformats).
    { key: 'ax', plane: 'axial', kernel: 'soft', preferImageType: 'ORIGINAL' }, // brain/soft-kernel axial
    { key: 'axbone', plane: 'axial', kernel: 'bone' }, // bone-kernel axial recon
    { key: 'cor', plane: 'coronal', kernel: 'soft' },
    { key: 'sag', plane: 'sagittal', kernel: 'soft' },
  ],
  stages: [
    { name: 'Axial Brain (current/prior)', selector: 'ax', voi: WINDOW.brain },
    { name: 'Axial Bone (current/prior)', selector: 'axbone', voi: WINDOW.bone },
    { name: 'Coronal (current/prior)', selector: 'cor', voi: WINDOW.brain },
    { name: 'Sagittal (current/prior)', selector: 'sag', voi: WINDOW.brain },
  ],
});

export default hpCompareCTHead;
