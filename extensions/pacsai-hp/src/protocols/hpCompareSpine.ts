import buildCompareProtocol, { PLANE_SELECTORS } from './buildCompareProtocol';

/**
 * Spine comparison (CT and MR). Spine is read SAGITTAL-first, then axial, then
 * coronal — so the stage order differs from the generic body protocols. Matches
 * studies whose description mentions spine/cervical/lumbar, out-weighting the
 * generic CT/MR protocols.
 */
const SPINE_KEYWORDS = ['spine', 'cervical', 'lumbar'];

const spineStages = [
  { name: 'Sagittal (current/prior)', selector: 'sag' },
  { name: 'Axial (current/prior)', selector: 'ax' },
  { name: 'Coronal (current/prior)', selector: 'cor' },
];

export const hpCompareCTSpine = buildCompareProtocol({
  id: '@pacsai/compareCTSpine',
  name: 'CT Spine Compare',
  description: 'Current vs prior CT spine — sagittal-first',
  modalities: ['CT'],
  bodyPartKeywords: SPINE_KEYWORDS,
  selectors: PLANE_SELECTORS,
  stages: spineStages,
});

export const hpCompareMRSpine = buildCompareProtocol({
  id: '@pacsai/compareMRSpine',
  name: 'MR Spine Compare',
  description: 'Current vs prior MR spine — sagittal-first',
  modalities: ['MR'],
  bodyPartKeywords: SPINE_KEYWORDS,
  selectors: PLANE_SELECTORS,
  stages: spineStages,
});

export default hpCompareCTSpine;
