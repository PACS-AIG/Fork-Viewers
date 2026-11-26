import { applyPoint, indexFromLps, type Mat4 } from '../anatomy/anatomyGeometry';
import { HIT_MM, hitTest, prepareTarget, type PreparedTarget } from './refineHit';
import { FOR, OTHER_SERIES, SERIES, disc, gridAffine, makeTarget, worldAt } from './refineTestData';

const prepared = (t: ReturnType<typeof makeTarget>): PreparedTarget => {
  const p = prepareTarget(t);
  if (!p) {
    throw new Error('no inverse');
  }
  return p;
};
const shown = { seriesUID: SERIES, frameOfReferenceUID: FOR };
const indexOf = (affine: Mat4, w: number[]) => applyPoint(indexFromLps(affine) as Mat4, w);

describe.each([
  ['an axial grid', 0],
  ['a grid tilted 27° (dev’s head CT)', 27],
])('the lesion a mark names, on %s', (_name, tiltDeg) => {
  const affine = gridAffine({ tiltDeg });
  const lesion = disc([10, 12], 2.2, [2]);
  const target = makeTarget({ affineRAS: affine }, lesion);
  const p = prepared(target);
  const at = (c: number, r: number, k: number) => worldAt(affine, c, r, k);

  it('takes a box around the lesion, counting the outline it covers, and puts it on the slice', () => {
    const hit = hitTest([p], { type: 'box', world: [at(8, 6, 2.03), at(16, 14, 1.98)] }, shown);
    expect(hit.kind).toBe('hit');
    if (hit.kind !== 'hit') {
      return;
    }
    expect(hit.target.observationId).toBe('obs-1');
    expect(hit.overlap).toBe(lesion.length);
    expect(hit.distanceMm).toBe(0);
    expect(hit.slice).toBe(2);
    for (const w of hit.prompt.world) {
      expect(indexOf(affine, w)[2]).toBeCloseTo(2, 9);
    }
    // In plane, the corners stay where they were drawn.
    expect(indexOf(affine, hit.prompt.world[0])[0]).toBeCloseTo(8, 9);
    expect(indexOf(affine, hit.prompt.world[1])[1]).toBeCloseTo(14, 9);
  });

  it('takes a click inside it', () => {
    const hit = hitTest([p], { type: 'point', world: [at(12, 10, 2)] }, shown);
    expect(hit).toMatchObject({ kind: 'hit', overlap: 1, distanceMm: 0 });
  });

  it('takes a click just beside it, within HIT_MM', () => {
    const hit = hitTest([p], { type: 'point', world: [at(17, 10, 2)] }, shown);
    expect(hit.kind).toBe('hit');
    if (hit.kind === 'hit') {
      expect(hit.overlap).toBe(0);
      expect(hit.distanceMm).toBeGreaterThan(0);
      expect(hit.distanceMm).toBeLessThanOrEqual(HIT_MM);
    }
  });

  it('names nothing for a click far from it', () => {
    expect(hitTest([p], { type: 'point', world: [at(0, 0, 2)] }, shown)).toEqual({
      kind: 'miss',
      reason: 'nothing_here',
    });
  });

  it('takes nothing between two slices (a reformat)', () => {
    expect(hitTest([p], { type: 'point', world: [at(12, 10, 2.5)] }, shown)).toEqual({
      kind: 'miss',
      reason: 'off_slice',
    });
    expect(hitTest([p], { type: 'box', world: [at(8, 6, 1), at(16, 14, 2)] }, shown)).toEqual({
      kind: 'miss',
      reason: 'off_slice',
    });
  });

  it('keeps a box inside the grid', () => {
    const hit = hitTest([p], { type: 'box', world: [at(-30, -30, 2), at(14, 12, 2)] }, shown);
    expect(hit.kind).toBe('hit');
    if (hit.kind === 'hit') {
      const corner = indexOf(affine, hit.prompt.world[0]);
      expect(corner[0]).toBeCloseTo(-0.5, 9);
      expect(corner[1]).toBeCloseTo(-0.5, 9);
    }
  });
});

describe('which lesion, among several', () => {
  const affine = gridAffine();
  const at = (c: number, r: number, k: number) => worldAt(affine, c, r, k);
  const small = prepared(makeTarget({ observationId: 'small' }, disc([10, 8], 1, [2])));
  const big = prepared(makeTarget({ observationId: 'big' }, disc([10, 14], 2.5, [2])));

  it('the one the box covers most', () => {
    const hit = hitTest([small, big], { type: 'box', world: [at(6, 6, 2), at(18, 14, 2)] }, shown);
    expect(hit.kind === 'hit' && hit.target.observationId).toBe('big');
  });

  it('the nearer, when the click is in neither', () => {
    const hit = hitTest([small, big], { type: 'point', world: [at(5, 10, 2)] }, shown);
    expect(hit.kind === 'hit' && hit.target.observationId).toBe('small');
  });

  it('only on its own series and frame of reference', () => {
    expect(
      hitTest(
        [small],
        { type: 'point', world: [at(8, 10, 2)] },
        { ...shown, seriesUID: OTHER_SERIES }
      )
    ).toEqual({
      kind: 'miss',
      reason: 'other_series',
    });
    expect(
      hitTest(
        [small],
        { type: 'point', world: [at(8, 10, 2)] },
        { ...shown, frameOfReferenceUID: '2.25.9' }
      )
    ).toEqual({ kind: 'miss', reason: 'other_series' });
    expect(hitTest([], { type: 'point', world: [at(8, 10, 2)] }, shown)).toEqual({
      kind: 'miss',
      reason: 'no_targets',
    });
  });

  it('says so when the lesion’s recipe does not take the mark', () => {
    const lineOnly = prepared(makeTarget({ promptTypes: ['line'] }, disc([10, 8], 1, [2])));
    expect(hitTest([lineOnly], { type: 'point', world: [at(8, 10, 2)] }, shown)).toMatchObject({
      kind: 'not_taken',
      type: 'point',
    });
  });

  it('finds a lesion with no outline yet by its detector box', () => {
    const boxOnly = prepared(
      makeTarget({
        mask: null,
        maskRevision: null,
        geometry: { type: 'box', world: [at(10, 10, 2), at(13, 13, 2)] },
      })
    );
    const hit = hitTest([boxOnly], { type: 'point', world: [at(15, 11, 2)] }, shown);
    expect(hit).toMatchObject({ kind: 'hit', overlap: 0 });
    expect(hitTest([boxOnly], { type: 'point', world: [at(0, 0, 2)] }, shown)).toMatchObject({
      kind: 'miss',
    });
  });
});
