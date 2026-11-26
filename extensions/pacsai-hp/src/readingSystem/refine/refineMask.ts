/**
 * RS-38, the refine tool: a lesion's packed outline, unpacked.
 *
 * The contract packs an outline's box (refineContract.RefineMask) slice by
 * slice, row by row, column by column, eight voxels to a byte with the first
 * voxel in the highest bit (numpy's packbits). Unpacked, it is one byte per
 * voxel in that same order, which is the order a RenderLayer reads (its data
 * at `(slice * rows + row) * columns + column`, local to its box), so the
 * anatomy renderer draws it as it is.
 *
 * Pure: no window, React or OHIF here.
 */
import { packColor, type RenderLayer } from '../anatomy/anatomyRender';
import type { IndexTriple, RefineMask } from './refineContract';

export interface UnpackedMask {
  /** The box's first voxel, (slice, row, column). */
  lo: IndexTriple;
  /** Its size, (slices, rows, columns). */
  dims: IndexTriple;
  /** 1 inside the outline, 0 outside: one byte per voxel of the box. */
  data: Uint8Array;
  voxels: number;
  /** The slices it has voxels on, ascending. */
  slices: number[];
}

/** base64 to bytes, in a page (atob) or under Node (the unit tests). */
export function decodeBase64(s: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  const B = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (!B) {
    throw new Error('this platform cannot decode base64');
  }
  return new Uint8Array(B.from(s, 'base64'));
}

export function unpackMask(mask: RefineMask): UnpackedMask {
  const packed = decodeBase64(mask.bits);
  const [lo, hi] = mask.box;
  const dims: IndexTriple = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const perSlice = dims[1] * dims[2];
  const n = dims[0] * perSlice;
  const data = new Uint8Array(n);
  let voxels = 0;
  const slices: number[] = [];
  for (let z = 0; z < dims[0]; z++) {
    let onSlice = 0;
    const base = z * perSlice;
    for (let p = 0; p < perSlice; p++) {
      const i = base + p;
      const bit = (packed[i >> 3] >> (7 - (i & 7))) & 1;
      data[i] = bit;
      onSlice += bit;
    }
    if (onSlice) {
      slices.push(lo[0] + z);
      voxels += onSlice;
    }
  }
  return { lo, dims, data, voxels, slices };
}

/** Whether the outline holds this voxel, (slice, row, column) on the grid. */
export function maskHas(m: UnpackedMask, k: number, r: number, c: number): boolean {
  const z = k - m.lo[0];
  const y = r - m.lo[1];
  const x = c - m.lo[2];
  if (z < 0 || y < 0 || x < 0 || z >= m.dims[0] || y >= m.dims[1] || x >= m.dims[2]) {
    return false;
  }
  return m.data[(z * m.dims[1] + y) * m.dims[2] + x] === 1;
}

/** The outline as one layer the anatomy renderer draws, in this colour. */
export function maskLayer(m: UnpackedMask, rgb: [number, number, number]): RenderLayer {
  return {
    data: m.data,
    origin: [m.lo[2], m.lo[1], m.lo[0]],
    size: [m.dims[2], m.dims[1], m.dims[0]],
    colors: Uint32Array.of(0, packColor(rgb)),
  };
}
