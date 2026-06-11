import buildCompareProtocol, { PLANE_SELECTORS } from './buildCompareProtocol';

/**
 * Spine comparison (CT and MR). Spine is read SAGITTAL-first, then axial, then
 * coronal — so the stage order differs from the generic body protocols. Matches
 * studies whose description mentions spine/cervical/lumbar, out-weighting the
 * generic CT/MR protocols.
 */
const SPINE_KEYWORDS = ['spine', 'cervical', 'thoracic', 'lumbar'];

const spineStages = [
  { name: 'Sagittal (current/prior)', selector: 'sag' },
  { name: 'Axial (current/prior)', selector: 'ax' },
  { name: 'Coronal (current/prior)', selector: 'cor' },
];

// Whole-spine sagittal survey of a same-session C/T/L set, tiled cranio-caudally.
// Hangs as the lead stage when all three regions are loaded (see loadRelevantPriors,
// which fetches the same-day sibling spine studies). `region` order = display order.
const spineOverviewRegions = [
  { key: 'c', region: 'cervical' as const },
  { key: 't', region: 'thoracic' as const },
  { key: 'l', region: 'lumbar' as const },
];

export const hpCompareCTSpine = buildCompareProtocol({
  id: '@pacsai/compareCTSpine',
  name: 'CT Spine Compare',
  description: 'Current vs prior CT spine — sagittal-first',
  modalities: ['CT'],
  bodyPartKeywords: SPINE_KEYWORDS,
  selectors: PLANE_SELECTORS,
  stages: spineStages,
  overview: { name: 'Whole spine (sagittal)', regions: spineOverviewRegions, plane: 'sagittal' },
});

export const hpCompareMRSpine = buildCompareProtocol({
  id: '@pacsai/compareMRSpine',
  name: 'MR Spine Compare',
  description: 'Current vs prior MR spine — sagittal-first',
  modalities: ['MR'],
  bodyPartKeywords: SPINE_KEYWORDS,
  selectors: PLANE_SELECTORS,
  stages: spineStages,
  // T2 / STIR sagittal are the conventional whole-spine survey sequences.
  overview: {
    name: 'Whole spine (T2 sagittal)',
    regions: spineOverviewRegions,
    plane: 'sagittal',
    keywords: ['t2', 'stir'],
  },
});

export default hpCompareCTSpine;
