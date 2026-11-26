import { renderLabels } from '../anatomy/anatomyRender';
import { decodeBase64, maskHas, maskLayer, unpackMask } from './refineMask';
import { packBox } from './refineTestData';

describe('packed outlines, unpacked', () => {
  const lo: [number, number, number] = [2, 3, 4];
  const hi: [number, number, number] = [4, 5, 7];
  const voxels: Array<[number, number, number]> = [
    [2, 3, 4],
    [2, 4, 6],
    [3, 3, 5],
  ];
  const mask = {
    box: [lo, hi] as [typeof lo, typeof hi],
    bits: packBox(lo, hi, voxels),
    digest: 'd',
    voxels: 3,
  };

  it('decodes base64', () => {
    expect(Array.from(decodeBase64('AQL/'))).toEqual([1, 2, 255]);
  });

  it('reads the first voxel from the highest bit, slice by slice, row by row', () => {
    // 12 voxels in the box: the first byte holds voxels 0..7 from bit 7 down.
    expect(Array.from(decodeBase64(mask.bits))[0] >> 7).toBe(1);
    const m = unpackMask(mask);
    expect(m.dims).toEqual([2, 2, 3]);
    expect(m.voxels).toBe(3);
    expect(m.slices).toEqual([2, 3]);
    for (const [k, r, c] of voxels) {
      expect(maskHas(m, k, r, c)).toBe(true);
    }
    expect(maskHas(m, 2, 3, 5)).toBe(false);
    expect(maskHas(m, 9, 3, 4)).toBe(false);
  });

  it('is a layer the anatomy renderer draws where its voxels are', () => {
    const m = unpackMask(mask);
    const layer = maskLayer(m, [255, 0, 0]);
    expect(layer.origin).toEqual([4, 3, 2]);
    expect(layer.size).toEqual([3, 2, 2]);
    // A canvas one pixel per voxel on slice 2, from column 0, row 0.
    const out = renderLabels({
      width: 10,
      height: 8,
      origin: [0, 0, 2],
      stepX: [1, 0, 0],
      stepY: [0, 1, 0],
      layers: [layer],
      fillAlpha: 1,
      edgeAlpha: 1,
    });
    const drawnAt = (x: number, y: number) => out.pixels[(y * 10 + x) * 4 + 3] > 0;
    expect(drawnAt(4, 3)).toBe(true);
    expect(drawnAt(6, 4)).toBe(true);
    expect(drawnAt(5, 3)).toBe(false);
    expect(out.drawn).toBe(2);
  });
});
