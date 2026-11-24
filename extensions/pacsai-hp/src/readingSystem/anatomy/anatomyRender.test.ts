import { buildLayer, valueAt } from './anatomyLayer';
import { DRAWN, labelsAt, packColor, renderLabels, type RenderLayer } from './anatomyRender';
import { CAVITIES, GRID, ORGANS, countOf, gridVolume } from './anatomyTestData';
import type { NiftiVolume } from './nifti';

const volume = (data: number[], datatype: 'uint8' | 'uint16' = 'uint8'): NiftiVolume => ({
  dims: [GRID.nx, GRID.ny, GRID.nz],
  datatype,
  data: datatype === 'uint8' ? Uint8Array.from(data) : Uint16Array.from(data),
  sform: null,
  qform: null,
});

const RED = packColor([255, 0, 0]);
const GREEN = packColor([0, 255, 0]);
const BLUE = packColor([0, 0, 255]);

async function layerOf(data: number[], colors: Record<number, number>): Promise<RenderLayer> {
  const built = await buildLayer(volume(data), Object.keys(colors).map(Number));
  const table = new Uint32Array(256);
  Object.entries(colors).forEach(([v, c]) => (table[Number(v)] = c));
  return { data: built.data, origin: built.origin, size: built.size, colors: table };
}

/** Canvas pixel (x, y) shows voxel (x, y, slice): one pixel per voxel, the native slice. */
const nativeSlice = (slice: number, width = GRID.nx, height = GRID.ny) => ({
  width,
  height,
  origin: [0, 0, slice] as [number, number, number],
  stepX: [1, 0, 0] as [number, number, number],
  stepY: [0, 1, 0] as [number, number, number],
});

const rgbaAt = (px: Uint8ClampedArray, width: number, x: number, y: number) => {
  const q = (y * width + x) * 4;
  return [px[q], px[q + 1], px[q + 2], px[q + 3]];
};

describe('a labelmap loaded for drawing (RS-36 anatomy)', () => {
  it('counts each listed label, keeps its centroid, slices and largest slice, and only the box that holds them', async () => {
    const layer = await buildLayer(volume(ORGANS), [1, 2]);
    const liver = layer.stats.get(1)!;
    expect(liver.voxels).toBe(countOf(ORGANS, 1));
    expect(liver.slices).toEqual([1, 3]);
    expect(liver.centroid).toEqual([1, 1, 2]);
    expect(liver.bestPoint).toEqual([1, 1, liver.bestSlice]);
    const spleen = layer.stats.get(2)!;
    expect(spleen.slices).toEqual([3, 3]);
    expect(spleen.bestSlice).toBe(3);
    expect(layer.origin).toEqual([0, 0, 1]);
    expect(layer.size).toEqual([8, 6, 3]);
    expect(layer.data.length).toBe(8 * 6 * 3);
    expect(valueAt(layer, 0, 0, 1)).toBe(1);
    expect(valueAt(layer, 7, 5, 3)).toBe(2);
    expect(valueAt(layer, 0, 0, 0)).toBe(0); // outside the box
    expect(layer.stray).toBe(0);
  });

  it('never keeps a value the document does not list (invariant 8), and counts it', async () => {
    const layer = await buildLayer(volume(ORGANS), [1]);
    expect(layer.stats.has(2)).toBe(false);
    expect(layer.stray).toBe(countOf(ORGANS, 2));
    expect(valueAt(layer, 7, 5, 3)).toBe(0);
    expect(layer.size).toEqual([3, 3, 3]); // the liver's box alone
  });

  it('yields to the page between slices, and takes an empty labelmap', async () => {
    const yields: number[] = [];
    const big = {
      ...volume(ORGANS),
      dims: [GRID.nx, GRID.ny, GRID.nz] as [number, number, number],
    };
    await buildLayer(big, [1, 2], async () => {
      yields.push(1);
    });
    expect(yields.length).toBe(0); // 5 slices: fewer than a yield's worth
    const tall = volume(
      gridVolume(() => 0)
        .concat(gridVolume(() => 0))
        .concat(gridVolume(() => 0))
    );
    tall.dims = [GRID.nx, GRID.ny, GRID.nz * 3];
    await buildLayer(tall, [1], async () => {
      yields.push(1);
    });
    expect(yields.length).toBe(1);
    const empty = await buildLayer(volume(gridVolume(() => 0)), [1]);
    expect(empty.size).toEqual([0, 0, 0]);
    expect(empty.stats.size).toBe(0);
  });
});

describe('the layers drawn for a viewport (RS-36 anatomy)', () => {
  it("fills a structure's inside and outlines its edge, each label in its colour", async () => {
    const organs = await layerOf(ORGANS, { 1: RED, 2: GREEN });
    const out = renderLabels({
      ...nativeSlice(3),
      layers: [organs],
      fillAlpha: 0.4,
      edgeAlpha: 0.8,
    });
    const W = GRID.nx;
    expect(out.drawn).toBe(9 + 9); // the liver's and the spleen's 3 x 3 on slice 3
    expect(rgbaAt(out.pixels, W, 1, 1)).toEqual([255, 0, 0, Math.round(0.4 * 255)]); // inside the liver
    expect(rgbaAt(out.pixels, W, 2, 1)).toEqual([255, 0, 0, Math.round(0.8 * 255)]); // on its edge
    // The canvas's own border is no edge: a structure cut by it is not outlined there.
    expect(rgbaAt(out.pixels, W, 0, 0)).toEqual([255, 0, 0, Math.round(0.4 * 255)]);
    expect(rgbaAt(out.pixels, W, 6, 4)).toEqual([0, 255, 0, Math.round(0.4 * 255)]); // inside the spleen
    expect(rgbaAt(out.pixels, W, 4, 0)).toEqual([0, 0, 0, 0]); // nothing
  });

  it('draws only the outline when the fill is 0, and a hidden label not at all', async () => {
    const organs = await layerOf(ORGANS, { 1: RED });
    const out = renderLabels({ ...nativeSlice(3), layers: [organs], fillAlpha: 0, edgeAlpha: 1 });
    expect(rgbaAt(out.pixels, GRID.nx, 1, 1)[3]).toBe(0);
    expect(rgbaAt(out.pixels, GRID.nx, 2, 2)[3]).toBe(255);
    expect(rgbaAt(out.pixels, GRID.nx, 6, 4)[3]).toBe(0); // the spleen is not listed: not drawn
  });

  it('lets the topmost visible layer win, and a lower layer show where an upper one hides its label', async () => {
    const cavities = await layerOf(CAVITIES, { 1: BLUE });
    const organs = await layerOf(ORGANS, { 1: RED, 2: GREEN });
    const both = renderLabels({
      ...nativeSlice(3),
      layers: [cavities, organs],
      fillAlpha: 1,
      edgeAlpha: 1,
    });
    expect(rgbaAt(both.pixels, GRID.nx, 1, 1).slice(0, 3)).toEqual([255, 0, 0]);
    expect(rgbaAt(both.pixels, GRID.nx, 4, 0).slice(0, 3)).toEqual([0, 0, 255]);
    organs.colors[1] = 0; // the liver hidden
    const hidden = renderLabels({
      ...nativeSlice(3),
      layers: [cavities, organs],
      fillAlpha: 1,
      edgeAlpha: 1,
    });
    expect(rgbaAt(hidden.pixels, GRID.nx, 1, 1).slice(0, 3)).toEqual([0, 0, 255]);
  });

  it('follows any mapping: a flipped and zoomed view, a reformat, and nothing outside the grid', async () => {
    const organs = await layerOf(ORGANS, { 1: RED, 2: GREEN });
    // Mirrored left-right, two canvas pixels per voxel.
    const zoomed = renderLabels({
      width: 16,
      height: 12,
      origin: [7.25, -0.25, 3],
      stepX: [-0.5, 0, 0],
      stepY: [0, 0.5, 0],
      layers: [organs],
      fillAlpha: 1,
      edgeAlpha: 1,
    });
    expect(zoomed.drawn).toBe(4 * 18);
    expect(rgbaAt(zoomed.pixels, 16, 15, 0).slice(0, 3)).toEqual([255, 0, 0]); // the liver, now on the right
    expect(rgbaAt(zoomed.pixels, 16, 0, 11).slice(0, 3)).toEqual([0, 255, 0]); // the spleen, now on the left
    // A coronal reformat: canvas x along columns, canvas y down the slices, at row 1.
    const coronal = renderLabels({
      width: GRID.nx,
      height: GRID.nz,
      origin: [0, 1, 0],
      stepX: [1, 0, 0],
      stepY: [0, 0, 1],
      layers: [organs],
      fillAlpha: 1,
      edgeAlpha: 1,
    });
    expect(coronal.drawn).toBe(3 * 3); // the liver's 3 columns over slices 1-3
    // Past the grid.
    const away = renderLabels({
      ...nativeSlice(3),
      origin: [100, 100, 3],
      layers: [organs],
      fillAlpha: 1,
      edgeAlpha: 1,
    });
    expect(away.drawn).toBe(0);
    const beyondSlices = renderLabels({
      ...nativeSlice(9),
      layers: [organs],
      fillAlpha: 1,
      edgeAlpha: 1,
    });
    expect(beyondSlices.drawn).toBe(0);
  });

  it('draws the highlighted structure stronger, and reuses its buffers', async () => {
    const organs = await layerOf(ORGANS, { 1: RED, 2: GREEN });
    const first = renderLabels({
      ...nativeSlice(3),
      layers: [organs],
      fillAlpha: 0.2,
      edgeAlpha: 0.4,
      highlight: { layer: 0, value: 2 },
    });
    expect(rgbaAt(first.pixels, GRID.nx, 1, 1)[3]).toBe(Math.round(0.2 * 255));
    // The spleen's edge is two pixels wide: at three pixels across, it is all edge.
    expect(rgbaAt(first.pixels, GRID.nx, 6, 4)[3]).toBe(255);
    expect(rgbaAt(first.pixels, GRID.nx, 5, 3)[3]).toBe(255);
    expect(first.focus).toEqual({
      key: (1 << 16) | 2,
      pixels: 9,
      left: 5,
      top: 3,
      right: 8,
      bottom: 6,
    });
    const again = renderLabels(
      { ...nativeSlice(3), layers: [organs], fillAlpha: 0.2, edgeAlpha: 0.4 },
      first.scratch,
      first.pixels
    );
    expect(again.pixels).toBe(first.pixels);
    expect(again.scratch).toBe(first.scratch);
    expect(rgbaAt(again.pixels, GRID.nx, 6, 4)[3]).toBe(Math.round(0.2 * 255));
    expect(again.focus).toBeNull();
  });

  it('draws the spotlight: the highlighted structure strong with a two-pixel edge, every other label dimmed, and where it is', async () => {
    const organs = await layerOf(ORGANS, { 1: RED, 2: GREEN });
    // Four canvas pixels to a voxel: voxel i covers x = 4i .. 4i + 3.
    const zoomed = {
      width: 32,
      height: 24,
      origin: [-0.375, -0.375, 3] as [number, number, number],
      stepX: [0.25, 0, 0] as [number, number, number],
      stepY: [0, 0.25, 0] as [number, number, number],
      layers: [organs],
      fillAlpha: 0.4,
      edgeAlpha: 0.8,
    };
    const lit = renderLabels({ ...zoomed, highlight: { layer: 0, value: 2 }, dim: 0.25 });
    const fill = Math.round(0.4 * 255);
    const edge = Math.round(0.8 * 255);
    // The liver at a quarter of its strength, inside and on its edge.
    expect(rgbaAt(lit.pixels, 32, 5, 5)).toEqual([255, 0, 0, Math.round(fill * 0.25)]);
    expect(rgbaAt(lit.pixels, 32, 11, 5)[3]).toBe(Math.round(edge * 0.25));
    // The spleen (x 20-31, y 12-23): its edge two pixels wide, its inside stronger than a plain fill.
    expect(rgbaAt(lit.pixels, 32, 20, 18)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(lit.pixels, 32, 21, 18)[3]).toBe(255);
    expect(rgbaAt(lit.pixels, 32, 22, 18)[3]).toBe(Math.round(0.55 * 255));
    expect(rgbaAt(lit.pixels, 32, 26, 18)[3]).toBe(Math.round(0.55 * 255));
    expect(lit.focus).toEqual({
      key: (1 << 16) | 2,
      pixels: 144,
      left: 20,
      top: 12,
      right: 32,
      bottom: 24,
    });
    // Without a highlight, nothing is dimmed whatever `dim` says.
    const plain = renderLabels({ ...zoomed, dim: 0.25 });
    expect(rgbaAt(plain.pixels, 32, 5, 5)[3]).toBe(fill);
    expect(plain.focus).toBeNull();
    // A highlighted structure that is not on this slice: no focus, the others dimmed all the same.
    const elsewhere = renderLabels({
      ...zoomed,
      origin: [-0.375, -0.375, 1],
      highlight: { layer: 0, value: 2 },
      dim: 0.25,
    });
    expect(elsewhere.focus).toBeNull();
    expect(rgbaAt(elsewhere.pixels, 32, 5, 5)[3]).toBe(Math.round(fill * 0.25));
  });

  it('aims a click at a point inside a curved label on its largest slice, where its centroid would miss it', async () => {
    // A C on slice 2 opening to the right: its centroid (2.5, 2.5) lies in the opening.
    const c = gridVolume((i, j, k) => (k === 2 && (j === 0 || j === 5 || i <= 1) ? 1 : 0));
    const layer = await buildLayer(volume(c), [1]);
    const st = layer.stats.get(1)!;
    expect(st.bestSlice).toBe(2);
    expect(valueAt(layer, Math.round(st.centroid[0]), Math.round(st.centroid[1]), 2)).toBe(0);
    const [i, j, k] = st.bestPoint;
    expect(valueAt(layer, i, j, k)).toBe(1);
    // At two voxels thick, every voxel of it is on its edge: the one nearest their middle.
    expect(st.bestPoint).toEqual([1, 2, 2]);
  });

  it('names the visible labels under a point, topmost first', async () => {
    const cavities = await layerOf(CAVITIES, { 1: BLUE });
    const organs = await layerOf(ORGANS, { 1: RED, 2: GREEN });
    expect(labelsAt([cavities, organs], [1, 1, 3])).toEqual([
      [1, 1],
      [0, 1],
    ]);
    expect(labelsAt([cavities, organs], [4.4, 0.2, 2.6])).toEqual([[0, 1]]);
    expect(labelsAt([cavities, organs], [1, 1, 0])).toEqual([]);
    organs.colors[1] = 0;
    expect(labelsAt([cavities, organs], [1, 1, 3])).toEqual([[0, 1]]);
    expect(packColor([1, 2, 3])).toBe((DRAWN | (3 << 16) | (2 << 8) | 1) >>> 0);
  });
});
