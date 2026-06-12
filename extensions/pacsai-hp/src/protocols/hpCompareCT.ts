import buildCompareProtocol, { PLANE_SELECTORS } from './buildCompareProtocol';
import { SESSION_REGIONS, SESSION_VIEWS } from './sessionRegions';

/**
 * Generic CT current-vs-prior comparison, also the multi-region SESSION protocol:
 * per body-part region (head, neck, spine, chest, abdomen, …) it lays out that
 * region's current vs its own prior, region-major and navigated sequentially — so a
 * same-session multi-region CT set (e.g. CT head + CT cervical) is reviewed in one
 * window without re-opening, each region keeping its own plane layout (no
 * cross-region tiling). Regions absent from the session are skipped. The loader runs
 * this for mixed/non-spine multi-region sets; single-study and continuous-spine
 * cases use the dedicated protocols.
 */
export const hpCompareCT = buildCompareProtocol({
  id: '@pacsai/compareCT',
  name: 'CT Compare',
  description: 'Current vs prior CT — per-region, side by side',
  modalities: ['CT'],
  selectors: PLANE_SELECTORS,
  stages: [
    { name: 'Axial (current/prior)', selector: 'ax' },
    { name: 'Coronal (current/prior)', selector: 'cor' },
    { name: 'Sagittal (current/prior)', selector: 'sag' },
  ],
  regionCompare: { regions: SESSION_REGIONS, views: SESSION_VIEWS },
  regionAttribute: 'pacsaiBodyPartTimepoint',
});

export default hpCompareCT;
