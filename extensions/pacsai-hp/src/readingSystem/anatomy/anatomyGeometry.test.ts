import {
  affineDifference,
  applyPoint,
  gridFit,
  indexFromLps,
  invertAffine,
  lpsFromIndex,
  multiply4,
  voxelVolumeMm3,
  type Mat4,
  type Vec3,
} from './anatomyGeometry';
import { AFFINE, AFFINE_ROWS_FLIPPED, GRID, gridImages } from './anatomyTestData';

const round = (v: Vec3) => v.map(x => Math.round(x * 1e9) / 1e9 + 0);
/** DICOM pixel (column u, row v) of test image k, in LPS mm. */
const pixel = (u: number, v: number, k: number): Vec3 => [-8 + 2 * u, -6 + 2 * v, 10 + 3 * k];

describe('the anatomy layers’ geometry (RS-36)', () => {
  it('inverts an affine', () => {
    const inv = invertAffine(AFFINE) as Mat4;
    expect(multiply4(AFFINE, inv).map(r => r.map(x => Math.round(x * 1e9) / 1e9 + 0))).toEqual([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);
    expect(
      invertAffine([
        [1, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ])
    ).toBeNull();
  });

  it('takes a viewer point (LPS) to its voxel with x and y flipped into RAS, and back', () => {
    // Pixel (u, v) of image k is voxel (u, v, k) on a grid stored in DICOM's own order...
    const toIndex = indexFromLps(AFFINE) as Mat4;
    expect(round(applyPoint(toIndex, pixel(0, 0, 0)))).toEqual([0, 0, 0]);
    expect(round(applyPoint(toIndex, pixel(7, 2, 3)))).toEqual([7, 2, 3]);
    expect(round(applyPoint(lpsFromIndex(AFFINE), [7, 2, 3]))).toEqual(pixel(7, 2, 3));
    // ...and voxel (u, ny - 1 - v, k) on the same grid stored with its rows flipped.
    const flipped = indexFromLps(AFFINE_ROWS_FLIPPED) as Mat4;
    expect(round(applyPoint(flipped, pixel(7, 2, 3)))).toEqual([7, GRID.ny - 1 - 2, 3]);
    // Treating RAS as LPS (no flip) would land elsewhere: the flip matters.
    const noFlip = invertAffine(AFFINE) as Mat4;
    expect(round(applyPoint(noFlip, pixel(7, 2, 3)))).not.toEqual([7, 2, 3]);
  });

  it("gives a voxel's volume and two affines' difference", () => {
    expect(voxelVolumeMm3(AFFINE)).toBe(12);
    expect(affineDifference(AFFINE, AFFINE)).toBe(0);
    const moved = AFFINE.map(r => [...r]);
    moved[0][3] += 0.002;
    expect(affineDifference(AFFINE, moved)).toBeCloseTo(0.002, 6);
  });

  it("fits a series whose images lie on the labelmap's grid, in either row order", () => {
    for (const affine of [AFFINE, AFFINE_ROWS_FLIPPED]) {
      const fit = gridFit(indexFromLps(affine) as Mat4, gridImages(), [GRID.nz, GRID.ny, GRID.nx]);
      expect(fit).toEqual({ fits: true, worst: expect.any(Number), reason: null });
      expect(fit.worst).toBeLessThan(1e-9);
    }
  });

  it('does not fit a series shifted by half a voxel, turned, of another spacing, beyond the slices, or without planes', () => {
    const toIndex = indexFromLps(AFFINE) as Mat4;
    const shape: [number, number, number] = [GRID.nz, GRID.ny, GRID.nx];
    const shifted = gridImages().map(img => ({
      ...img,
      position: [img.position[0] + 1, img.position[1], img.position[2]],
    }));
    expect(gridFit(toIndex, shifted, shape)).toMatchObject({
      fits: false,
      reason: expect.stringMatching(/between the labelmap's voxels/),
    });
    const c = Math.cos(0.2);
    const s = Math.sin(0.2);
    const turned = gridImages().map(img => ({
      ...img,
      rowCosines: [c, s, 0],
      columnCosines: [-s, c, 0],
    }));
    expect(gridFit(toIndex, turned, shape)).toMatchObject({
      fits: false,
      reason: expect.stringMatching(/do not run along/),
    });
    const finer = gridImages().map(img => ({ ...img, rowSpacing: 1, columnSpacing: 1 }));
    expect(gridFit(toIndex, finer, shape).fits).toBe(false);
    const beyond = gridImages(GRID.nz + 1);
    expect(gridFit(toIndex, beyond, shape)).toMatchObject({
      fits: false,
      reason: expect.stringMatching(/outside the labelmap's slices/),
    });
    expect(gridFit(toIndex, [], shape)).toMatchObject({
      fits: false,
      reason: expect.stringMatching(/no image planes/),
    });
    const broken = gridImages().map((img, k) =>
      k === 2 ? { ...img, position: [NaN, 0, 0] } : img
    );
    expect(gridFit(toIndex, broken, shape)).toMatchObject({
      fits: false,
      reason: expect.stringMatching(/no complete plane/),
    });
  });

  it('fits a series whose plane positions carry the rounding DICOM decimal strings give', () => {
    const toIndex = indexFromLps(AFFINE) as Mat4;
    const rounded = gridImages().map(img => ({
      ...img,
      position: img.position.map(x => x + 0.00004),
    }));
    expect(gridFit(toIndex, rounded, [GRID.nz, GRID.ny, GRID.nx]).fits).toBe(true);
  });
});
