import buildCompareProtocol from './buildCompareProtocol';

/**
 * CR/DX (projection radiography) comparison. A projection "study" holds several
 * single-image views (e.g. ankle AP/Lat/Obl) the radiologist reads together, so:
 *  - `tileCurrentImages: 4` tiles all of the current study's views in one stage
 *    (2x2, degrading to a row of 3/2), which leads when there is no prior;
 *  - the current-vs-prior single-view stage leads when a prior exists.
 * Projection images have one frame, so the series floor is 0 and scout-exclusion is
 * off. (Per-projection current-vs-prior pairing and bilateral left/right are a
 * planned follow-up — they need laterality/projection attributes.)
 */
export const hpCompareCR = buildCompareProtocol({
  id: '@pacsai/compareCR',
  name: 'X-Ray Compare',
  description: 'Current radiograph views tiled, vs prior',
  modalities: ['CR', 'DX', 'XR', 'RG'],
  seriesFloor: 0,
  excludeScouts: false,
  tileCurrentImages: 4,
  selectors: [{ key: 'img' }],
  stages: [{ name: 'Current/Prior', selector: 'img' }],
});

export default hpCompareCR;
