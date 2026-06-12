import buildCompareProtocol, { PLANE_SELECTORS } from './buildCompareProtocol';
import { SESSION_REGIONS, SESSION_VIEWS } from './sessionRegions';

/**
 * Generic MR current-vs-prior comparison, also the multi-region SESSION protocol:
 * per body-part region it lays out that region's current vs its own prior,
 * region-major and navigated sequentially — so a same-session multi-region MR set is
 * reviewed in one window without re-opening, each region keeping its own plane
 * layout (no cross-region tiling). Regions absent from the session are skipped.
 * NOTE: plane matching uses the computed `pacsaiPlane`, robust to MR naming. The
 * loader runs this for mixed/non-spine multi-region sets; continuous-spine sets use
 * the spine protocol (with its sequence-aware survey + compare).
 */
export const hpCompareMR = buildCompareProtocol({
  id: '@pacsai/compareMR',
  name: 'MR Compare',
  description: 'Current vs prior MR — per-region, side by side',
  modalities: ['MR'],
  selectors: PLANE_SELECTORS,
  stages: [
    { name: 'Axial (current/prior)', selector: 'ax' },
    { name: 'Coronal (current/prior)', selector: 'cor' },
    { name: 'Sagittal (current/prior)', selector: 'sag' },
  ],
  regionCompare: { regions: SESSION_REGIONS, views: SESSION_VIEWS },
  regionAttribute: 'pacsaiBodyPartTimepoint',
});

export default hpCompareMR;
