/**
 * RS-36: one labelmap, loaded for drawing.
 *
 * One pass over the voxels counts each listed label (the count must be the
 * document's, as the reading system checks it before it serves the file),
 * finds the box that holds every listed label, and keeps for each label its
 * centroid, its slice range and the slice that holds most of it (where a
 * click on the structure jumps). Only that box's voxels are kept, so the
 * vertebrae's labelmap costs a small part of a full grid. A value the
 * document does not list is never drawn (invariant 8: only named labels).
 *
 * The pass yields to the page every few slices, so loading a large labelmap
 * does not hold up the viewer.
 *
 * Pure: no window, React or OHIF here.
 */
import type { Vec3 } from './anatomyGeometry';
import type { NiftiVolume } from './nifti';

export interface LabelStats {
  voxels: number;
  /** Over all its voxels, in (column, row, slice) index space. */
  centroid: Vec3;
  /** The slice holding most of its voxels, and that slice's in-plane centroid (index space). */
  bestSlice: number;
  bestPoint: Vec3;
  /** Its first and last slice. */
  slices: [number, number];
}

export interface AnatomyLayerData {
  /** The full grid: (columns, rows, slices). */
  dims: [number, number, number];
  /** The kept box's first voxel and size, in (column, row, slice). */
  origin: [number, number, number];
  size: [number, number, number];
  /** The box's voxels, column fastest; empty when no listed label has a voxel. */
  data: Uint8Array | Uint16Array;
  stats: Map<number, LabelStats>;
  /** Voxels holding a value the document does not list (never drawn). */
  stray: number;
}

/** Yields to the page (a resolved timer); the default does not wait. */
export type Yielder = () => Promise<void>;

/** How many slices go between two yields. */
export const SLICES_PER_YIELD = 8;

export async function buildLayer(
  volume: NiftiVolume,
  values: Iterable<number>,
  yieldNow: Yielder = () => Promise.resolve()
): Promise<AnatomyLayerData> {
  const [nx, ny, nz] = volume.dims;
  const src = volume.data;
  const listed = [...values];
  const top = volume.datatype === 'uint8' ? 256 : 65536;
  // Value -> its place among the listed labels (+1), 0 when unlisted.
  const slot = new Int32Array(top);
  listed.forEach((v, n) => {
    if (v > 0 && v < top) {
      slot[v] = n + 1;
    }
  });
  const L = listed.length;
  const count = new Float64Array(L);
  const sum = new Float64Array(L * 3);
  const perSlice = new Float64Array(L * nz);
  const perSliceI = new Float64Array(L * nz);
  const perSliceJ = new Float64Array(L * nz);
  const firstSlice = new Int32Array(L).fill(-1);
  const lastSlice = new Int32Array(L).fill(-1);
  let stray = 0;
  let i0 = nx;
  let j0 = ny;
  let k0 = nz;
  let i1 = -1;
  let j1 = -1;
  let k1 = -1;

  const plane = nx * ny;
  for (let k = 0; k < nz; k++) {
    if (k > 0 && k % SLICES_PER_YIELD === 0) {
      await yieldNow();
    }
    const base = k * plane;
    for (let j = 0; j < ny; j++) {
      const row = base + j * nx;
      for (let i = 0; i < nx; i++) {
        const v = src[row + i];
        if (v === 0) {
          continue;
        }
        const s = slot[v];
        if (s === 0) {
          stray++;
          continue;
        }
        const n = s - 1;
        count[n]++;
        sum[3 * n] += i;
        sum[3 * n + 1] += j;
        sum[3 * n + 2] += k;
        const at = n * nz + k;
        perSlice[at]++;
        perSliceI[at] += i;
        perSliceJ[at] += j;
        if (firstSlice[n] < 0) {
          firstSlice[n] = k;
        }
        lastSlice[n] = k;
        if (i < i0) {
          i0 = i;
        }
        if (i > i1) {
          i1 = i;
        }
        if (j < j0) {
          j0 = j;
        }
        if (j > j1) {
          j1 = j;
        }
        if (k < k0) {
          k0 = k;
        }
        if (k > k1) {
          k1 = k;
        }
      }
    }
  }

  const stats = new Map<number, LabelStats>();
  listed.forEach((value, n) => {
    const c = count[n];
    if (c === 0) {
      return;
    }
    let best = firstSlice[n];
    for (let k = firstSlice[n]; k <= lastSlice[n]; k++) {
      if (perSlice[n * nz + k] > perSlice[n * nz + best]) {
        best = k;
      }
    }
    const atBest = n * nz + best;
    stats.set(value, {
      voxels: c,
      centroid: [sum[3 * n] / c, sum[3 * n + 1] / c, sum[3 * n + 2] / c],
      bestSlice: best,
      bestPoint: [perSliceI[atBest] / perSlice[atBest], perSliceJ[atBest] / perSlice[atBest], best],
      slices: [firstSlice[n], lastSlice[n]],
    });
  });

  if (i1 < 0) {
    return {
      dims: [nx, ny, nz],
      origin: [0, 0, 0],
      size: [0, 0, 0],
      data: new Uint8Array(0),
      stats,
      stray,
    };
  }
  const size: [number, number, number] = [i1 - i0 + 1, j1 - j0 + 1, k1 - k0 + 1];
  const out =
    volume.datatype === 'uint8'
      ? new Uint8Array(size[0] * size[1] * size[2])
      : new Uint16Array(size[0] * size[1] * size[2]);
  for (let k = 0; k < size[2]; k++) {
    for (let j = 0; j < size[1]; j++) {
      const from = (k + k0) * plane + (j + j0) * nx + i0;
      const to = (k * size[1] + j) * size[0];
      for (let i = 0; i < size[0]; i++) {
        const v = src[from + i];
        // Keep only listed labels: an unlisted value is never drawn.
        out[to + i] = v !== 0 && slot[v] !== 0 ? v : 0;
      }
    }
  }
  return { dims: [nx, ny, nz], origin: [i0, j0, k0], size, data: out, stats, stray };
}

/** The value at a (column, row, slice) index of the full grid (0 outside the kept box). */
export function valueAt(layer: AnatomyLayerData, i: number, j: number, k: number): number {
  const x = i - layer.origin[0];
  const y = j - layer.origin[1];
  const z = k - layer.origin[2];
  if (x < 0 || y < 0 || z < 0 || x >= layer.size[0] || y >= layer.size[1] || z >= layer.size[2]) {
    return 0;
  }
  return layer.data[(z * layer.size[1] + y) * layer.size[0] + x];
}
