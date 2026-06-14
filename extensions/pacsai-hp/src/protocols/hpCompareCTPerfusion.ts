import buildCompareProtocol from './buildCompareProtocol';

/**
 * CT perfusion (acute stroke) comparison.
 *
 * A CT perfusion study's diagnostic content is the post-processed parameter maps
 * (here iSchemaView RAPID): the CBF/Tmax MISMATCH (ischemic core vs salvageable
 * penumbra), the individual CBF / CBV / Tmax threshold maps, a combined colored
 * parameter-map panel, and a one-page CT-P summary. These maps are COLOR (RGB)
 * series — so, unlike every other compare protocol, this one must KEEP color
 * (no `excludeColorSeries`); excluding it would leave nothing to hang. The raw
 * dynamic 4D acquisition ("VPCT DynMulti4D CTP", a 360-frame mono source) is not
 * reviewed directly and is left to the series panel / catch-all.
 *
 * Generic compareCT mishandles this: it only knows ax/cor/sag mono planes, so it
 * grabs the mono 4D source and ignores every map. This protocol selects the RAPID
 * outputs by name and leads with the mismatch, then a pageable 4-up (CBF + CBV +
 * Tmax + Mismatch), then the combined colored panel and the CT-P summary.
 *
 * NOTE: these RGB maps are the series tied to the cornerstone thumbnail crash;
 * hanging them in a viewport is a different render path, but this protocol is only
 * confirmed working once the maps render (not crash) in a real load.
 */
export const hpCompareCTPerfusion = buildCompareProtocol({
  id: '@pacsai/compareCTPerfusion',
  name: 'CT Perfusion (Stroke) Compare',
  description:
    'CT perfusion (acute stroke) — RAPID mismatch, CBF/CBV/Tmax maps, colored panel, CT-P summary',
  modalities: ['CT'],
  bodyPartKeywords: ['perfusion', 'ctp'],
  matchWeight: 150,
  // Perfusion parameter maps are RGB — keep color (the default excludeColorSeries=false).
  selectors: [
    // CBF/Tmax mismatch (core vs penumbra) — the lead view.
    { key: 'mismatch', keywords: ['mismatch'] },
    // Individual threshold maps.
    { key: 'cbf', keywords: ['cbf'], excludeKeywords: ['mismatch'] },
    { key: 'cbv', keywords: ['cbv'] },
    { key: 'tmax', keywords: ['tmax'], excludeKeywords: ['mismatch'] },
    // Combined colored parameter-map panel and the one-page summary.
    { key: 'pmaps', keywords: ['parameter', 'colored'] },
    { key: 'summary', keywords: ['summary'], excludeKeywords: ['slices'] },
  ],
  // Current|prior compare stages (rare for acute stroke, but supported with a prior).
  stages: [
    { name: 'Perfusion mismatch (current/prior)', selector: 'mismatch' },
    { name: 'Perfusion CBF (current/prior)', selector: 'cbf' },
    { name: 'Perfusion CBV (current/prior)', selector: 'cbv' },
    { name: 'Perfusion Tmax (current/prior)', selector: 'tmax' },
    { name: 'Perfusion maps colored (current/prior)', selector: 'pmaps' },
    { name: 'Perfusion CT-P summary (current/prior)', selector: 'summary' },
  ],
  // No prior (the usual acute case): pageable current-only groups, by task.
  currentStages: [
    { name: 'Perfusion mismatch (CBF/Tmax)', selectors: ['mismatch'] },
    { name: 'Perfusion maps (CBF + CBV + Tmax + Mismatch)', selectors: ['cbf', 'cbv', 'tmax', 'mismatch'] },
    { name: 'Perfusion parameter maps (colored)', selectors: ['pmaps'] },
    { name: 'Perfusion CT-P summary', selectors: ['summary'] },
  ],
  // Densest-fully-matched current-only fallback (below the group stages).
  currentView: ['mismatch', 'cbf', 'cbv', 'tmax'],
});

export default hpCompareCTPerfusion;
