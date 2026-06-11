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

// Whole-spine survey of a same-session C/T/L set, tiled cranio-caudally (see
// loadRelevantPriors, which fetches the same-day sibling spine studies). `region`
// order = display order (cervical -> thoracic -> lumbar).
const spineOverviewRegions = [
  { key: 'c', region: 'cervical' as const },
  { key: 't', region: 'thoracic' as const },
  { key: 'l', region: 'lumbar' as const },
];

// The radiologist reads the whole spine sequence-by-sequence; each sagittal
// sequence is its own 3-up stage, in review order. Keywords disambiguate the
// (often overlapping) descriptions: STIR series also carry "t2", and the
// post-contrast T1 carries "post" — hence the excludes.
const spineMRSagViews = [
  { key: 't2', name: 'Whole spine T2 sag', plane: 'sagittal' as const, keywords: ['t2'], excludeKeywords: ['stir'] },
  { key: 'stir', name: 'Whole spine STIR sag', plane: 'sagittal' as const, keywords: ['stir'] },
  { key: 't1', name: 'Whole spine T1 sag', plane: 'sagittal' as const, keywords: ['t1'], excludeKeywords: ['post'] },
  { key: 't1post', name: 'Whole spine T1 sag +C', plane: 'sagittal' as const, keywords: ['post'] },
];

// CT has no T2/STIR/T1 — a single sagittal (bone/soft reformat) whole-spine view.
const spineCTSagViews = [
  { key: 'sag', name: 'Whole spine (sagittal)', plane: 'sagittal' as const },
];

// Per-region drill-down, one stage per sequence (axials, which aren't tiled across
// regions). Applied to every loaded region. Keywords disambiguate: the straight
// axial T2 excludes the disc-angled obliques (msma/LSP) and the post-contrast run;
// the obliques are keyed by 'msma'; the post-contrast axial by 'post'.
const spineMRDetailViews = [
  { key: 'axt2', name: 'axial T2', plane: 'axial' as const, keywords: ['t2'], excludeKeywords: ['stir', 'msma', 'post'] },
  { key: 'axobl', name: 'axial T2 (disc)', plane: 'axial' as const, keywords: ['msma'] },
  { key: 'axt1post', name: 'axial T1 +C', plane: 'axial' as const, keywords: ['post'] },
];

// CT per-region drill: straight axial.
const spineCTDetailViews = [
  { key: 'ax', name: 'axial', plane: 'axial' as const },
];

export const hpCompareCTSpine = buildCompareProtocol({
  id: '@pacsai/compareCTSpine',
  name: 'CT Spine Compare',
  description: 'Current vs prior CT spine — sagittal-first',
  modalities: ['CT'],
  bodyPartKeywords: SPINE_KEYWORDS,
  selectors: PLANE_SELECTORS,
  stages: spineStages,
  overview: { regions: spineOverviewRegions, views: spineCTSagViews },
  detail: { views: spineCTDetailViews },
});

export const hpCompareMRSpine = buildCompareProtocol({
  id: '@pacsai/compareMRSpine',
  name: 'MR Spine Compare',
  description: 'Current vs prior MR spine — sagittal-first',
  modalities: ['MR'],
  bodyPartKeywords: SPINE_KEYWORDS,
  selectors: PLANE_SELECTORS,
  stages: spineStages,
  overview: { regions: spineOverviewRegions, views: spineMRSagViews },
  detail: { views: spineMRDetailViews },
});

export default hpCompareCTSpine;
