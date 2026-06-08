import buildCompareProtocol, { PLANE_SELECTORS, WINDOW } from './buildCompareProtocol';

/**
 * CT chest comparison. Axial is primary, reviewed at multiple window presets
 * (lung, soft tissue/mediastinum, bone), each current beside prior, then a
 * coronal comparison. Window presets are applied via the viewport's VOI.
 */
export const hpCompareCTChest = buildCompareProtocol({
  id: '@pacsai/compareCTChest',
  name: 'CT Chest Compare',
  description: 'Current vs prior CT chest — lung/soft/bone windows + coronal',
  modalities: ['CT'],
  bodyPartKeywords: ['chest', 'thorax', 'lung'],
  selectors: PLANE_SELECTORS,
  stages: [
    { name: 'Axial Lung (current/prior)', selector: 'ax', voi: WINDOW.lung },
    { name: 'Axial Soft Tissue (current/prior)', selector: 'ax', voi: WINDOW.softTissue },
    { name: 'Axial Bone (current/prior)', selector: 'ax', voi: WINDOW.bone },
    { name: 'Coronal (current/prior)', selector: 'cor' },
  ],
});

export default hpCompareCTChest;
