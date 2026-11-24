/**
 * RS-36: one labelmap, loaded for drawing.
 *
 * One pass over the voxels counts each listed label (the count must be the
 * document's, as the reading system checks it before it serves the file),
 * finds the box that holds every listed label, and keeps for each label its
 * centroid, its slice range and the slice that holds most of it. A click on
 * the structure jumps to a point inside it on that slice: its largest
 * piece's deepest pixel there (anatomyFocus), found by a second pass over
 * those slices alone. Only that box's voxels are kept, so the
 * vertebrae's labelmap costs a small part of a full grid. A value the
 * document does not list is never drawn (invariant 8: only named labels).
 *
 * The pass yields to the page every few slices, so loading a large labelmap
 * does not hold up the viewer.
 *
 * Pure: no window, React or OHIF here.
 */
import { deepestPoint } from './anatomyFocus';
import type { Vec3 } from './anatomyGeometry';
import type { NiftiVolume } from './nifti';

export interface LabelStats {
  voxels: number;
  /** Over all its voxels, in (column, row, slice) index space. */
  centroid: Vec3;
  /**
   * The slice holding most of its voxels, and a point inside it on that slice
   * (index space): its largest piece's deepest pixel there, never outside the
   * structure as a curved one's centroid can be.
   */
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

  // Each label's largest slice.
  const bestOf = new Int32Array(L).fill(-1);
  for (let n = 0; n < L; n++) {
    if (count[n] === 0) {
      continue;
    }
    let best = firstSlice[n];
    for (let k = firstSlice[n]; k <= lastSlice[n]; k++) {
      if (perSlice[n * nz + k] > perSlice[n * nz + best]) {
        best = k;
      }
    }
    bestOf[n] = best;
  }

  // A point inside each label on its largest slice: one pass over each of those slices (within
  // the box) finds the labels' boxes there, then each label's mask over its box gives its
  // largest piece's deepest pixel.
  const inside = new Float64Array(L * 2);
  const onSlice = new Map<number, number[]>();
  for (let n = 0; n < L; n++) {
    if (bestOf[n] >= 0) {
      onSlice.set(bestOf[n], [...(onSlice.get(bestOf[n]) ?? []), n]);
    }
  }
  const local = new Int32Array(L).fill(-1);
  // (An index loop: the build's regenerator takes no for-of with an await inside.)
  const slices = [...onSlice.entries()];
  for (let si = 0; si < slices.length; si++) {
    if (si > 0 && si % SLICES_PER_YIELD === 0) {
      await yieldNow();
    }
    const [k, ns] = slices[si];
    ns.forEach((n, li) => {
      local[n] = li;
    });
    const bx0 = new Int32Array(ns.length).fill(nx);
    const by0 = new Int32Array(ns.length).fill(ny);
    const bx1 = new Int32Array(ns.length).fill(-1);
    const by1 = new Int32Array(ns.length).fill(-1);
    const base = k * plane;
    for (let j = j0; j <= j1; j++) {
      const row = base + j * nx;
      for (let i = i0; i <= i1; i++) {
        const s = slot[src[row + i]];
        const li = s ? local[s - 1] : -1;
        if (li < 0) {
          continue;
        }
        bx0[li] = Math.min(bx0[li], i);
        bx1[li] = Math.max(bx1[li], i);
        by0[li] = Math.min(by0[li], j);
        by1[li] = Math.max(by1[li], j);
      }
    }
    ns.forEach((n, li) => {
      local[n] = -1;
      const w = bx1[li] - bx0[li] + 1;
      const h = by1[li] - by0[li] + 1;
      const mask = new Uint8Array(Math.max(0, w * h));
      for (let y = 0; y < h; y++) {
        const row = base + (by0[li] + y) * nx + bx0[li];
        for (let x = 0; x < w; x++) {
          mask[y * w + x] = slot[src[row + x]] === n + 1 ? 1 : 0;
        }
      }
      const p = deepestPoint(mask, w, h);
      inside[2 * n] = p ? bx0[li] + p.x : sum[3 * n] / count[n];
      inside[2 * n + 1] = p ? by0[li] + p.y : sum[3 * n + 1] / count[n];
    });
  }

  const stats = new Map<number, LabelStats>();
  listed.forEach((value, n) => {
    const c = count[n];
    if (c === 0) {
      return;
    }
    stats.set(value, {
      voxels: c,
      centroid: [sum[3 * n] / c, sum[3 * n + 1] / c, sum[3 * n + 2] / c],
      bestSlice: bestOf[n],
      bestPoint: [inside[2 * n], inside[2 * n + 1], bestOf[n]],
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
