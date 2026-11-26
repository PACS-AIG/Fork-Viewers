/**
 * RS-38, the refine tool: which lesion a reader's mark belongs to.
 *
 * The tool is in the main toolbar, not on a finding, so the viewer works out
 * the lesion from the mark: among the refine targets on the series the mark
 * was drawn on, the one whose outline the mark covers most (a box) or holds
 * (a click); failing that, the nearest within HIT_MM; else none.
 *
 * SAM2CT takes a mark on one of the series' own slices. Each mark point goes
 * to the target's grid index; every point must lie on the same slice (within
 * the grid fit's tolerance), and the mark is then put exactly on that slice,
 * keeping its in-plane position, so the request never straddles two slices.
 * A box is kept inside the grid; a click outside it names nothing.
 *
 * Pure: no window, React or OHIF here.
 */
import {
  FIT_POSITION_TOLERANCE,
  applyPoint,
  indexFromLps,
  lpsFromIndex,
  type Mat4,
  type Vec3,
} from '../anatomy/anatomyGeometry';
import type { RefinePrompt, RefinePromptType, RefineTarget } from './refineContract';
import { maskHas, unpackMask, type UnpackedMask } from './refineMask';

/** A mark this near a lesion's outline (or its detector box or point) names it, mm. */
export const HIT_MM = 10;

export interface PreparedTarget {
  target: RefineTarget;
  toIndex: Mat4;
  toWorld: Mat4;
  /** mm per index step along (column, row, slice). */
  spacing: Vec3;
  mask: UnpackedMask | null;
}

/** A target ready for hit tests and drawing, or null when its grid has no inverse. */
export function prepareTarget(target: RefineTarget): PreparedTarget | null {
  const toIndex = indexFromLps(target.grid.affineRAS);
  if (!toIndex) {
    return null;
  }
  const toWorld = lpsFromIndex(target.grid.affineRAS);
  const column = (a: number): number => Math.hypot(toWorld[0][a], toWorld[1][a], toWorld[2][a]);
  return {
    target,
    toIndex,
    toWorld,
    spacing: [column(0), column(1), column(2)],
    mask: target.mask ? unpackMask(target.mask) : null,
  };
}

export interface ShownImage {
  seriesUID: string;
  frameOfReferenceUID: string | null;
}

export type HitResult =
  | {
      kind: 'hit';
      target: RefineTarget;
      /** The mark on the target's slice, ready for the request. */
      prompt: RefinePrompt;
      slice: number;
      /** Outline voxels the mark covers (a box) or holds (a click: 0 or 1). */
      overlap: number;
      /** From the mark's centre to the outline (0 when it overlaps), mm. */
      distanceMm: number;
    }
  | { kind: 'miss'; reason: 'no_targets' | 'other_series' | 'off_slice' | 'nothing_here' }
  | { kind: 'not_taken'; target: RefineTarget; type: RefinePromptType };

interface Placed {
  /** Each mark point's (column, row) and the slice they share. */
  points: Array<[number, number]>;
  slice: number;
}

/** The mark on one of this grid's slices, or null when it is off its slices or outside it. */
function place(p: PreparedTarget, mark: RefinePrompt): Placed | null {
  const [slices, rows, columns] = p.target.grid.shape;
  const idx = mark.world.map(w => applyPoint(p.toIndex, w));
  const k = Math.round(idx[0][2]);
  if (k < 0 || k >= slices) {
    return null;
  }
  if (idx.some(i => Math.abs(i[2] - k) > FIT_POSITION_TOLERANCE)) {
    return null;
  }
  const inside = (i: Vec3) =>
    i[0] >= -0.5 && i[0] <= columns - 0.5 && i[1] >= -0.5 && i[1] <= rows - 0.5;
  if (mark.type === 'point' && !inside(idx[0])) {
    return null;
  }
  const clamp = (v: number, n: number) => Math.min(n - 0.5, Math.max(-0.5, v));
  const points = idx.map(i => [clamp(i[0], columns), clamp(i[1], rows)] as [number, number]);
  if (mark.type === 'box') {
    // A box wholly off the grid covers nothing on it.
    const [a, b] = points;
    if (a[0] === b[0] || a[1] === b[1]) {
      return null;
    }
  }
  return { points, slice: k };
}

/** Outline voxels on this slice inside the mark (a box), or under it (a click). */
function overlapOf(m: UnpackedMask, placed: Placed, type: RefinePromptType): number {
  const k = placed.slice;
  if (type === 'point') {
    const [c, r] = placed.points[0];
    return maskHas(m, k, Math.round(r), Math.round(c)) ? 1 : 0;
  }
  const [a, b] = placed.points;
  const c0 = Math.max(m.lo[2], Math.ceil(Math.min(a[0], b[0]) - 0.5));
  const c1 = Math.min(m.lo[2] + m.dims[2] - 1, Math.floor(Math.max(a[0], b[0]) + 0.5));
  const r0 = Math.max(m.lo[1], Math.ceil(Math.min(a[1], b[1]) - 0.5));
  const r1 = Math.min(m.lo[1] + m.dims[1] - 1, Math.floor(Math.max(a[1], b[1]) + 0.5));
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (maskHas(m, k, r, c)) {
        n++;
      }
    }
  }
  return n;
}

const centre = (placed: Placed): Vec3 => {
  const n = placed.points.length;
  const c = placed.points.reduce((s, p) => s + p[0], 0) / n;
  const r = placed.points.reduce((s, p) => s + p[1], 0) / n;
  return [c, r, placed.slice];
};

/** From an index point to the outline's nearest voxel, mm (along the grid's axes). */
function distanceToMask(p: PreparedTarget, m: UnpackedMask, at: Vec3): number {
  const [sc, sr, sk] = p.spacing;
  let best = Infinity;
  for (let z = 0; z < m.dims[0]; z++) {
    const dk = (m.lo[0] + z - at[2]) * sk;
    if (Math.abs(dk) >= best) {
      continue;
    }
    for (let y = 0; y < m.dims[1]; y++) {
      const dr = (m.lo[1] + y - at[1]) * sr;
      const row = (z * m.dims[1] + y) * m.dims[2];
      for (let x = 0; x < m.dims[2]; x++) {
        if (m.data[row + x] !== 1) {
          continue;
        }
        const dc = (m.lo[2] + x - at[0]) * sc;
        const d = Math.hypot(dc, dr, dk);
        if (d < best) {
          best = d;
        }
      }
    }
  }
  return best;
}

/** From an index point to a detector's box or point, mm. */
function distanceToGeometry(p: PreparedTarget, at: Vec3): number {
  const g = p.target.geometry;
  if (!g) {
    return Infinity;
  }
  const corners = g.world.map(w => applyPoint(p.toIndex, w));
  const lo = [0, 1, 2].map(a => Math.min(...corners.map(c => c[a])));
  const hi = [0, 1, 2].map(a => Math.max(...corners.map(c => c[a])));
  const gap = (a: number) => Math.max(lo[a] - at[a], 0, at[a] - hi[a]) * p.spacing[a];
  return Math.hypot(gap(0), gap(1), gap(2));
}

/**
 * The lesion a mark names, among the prepared targets, for the image it was
 * drawn on; or why none.
 */
export function hitTest(
  prepared: PreparedTarget[],
  mark: RefinePrompt,
  shown: ShownImage
): HitResult {
  if (!prepared.length) {
    return { kind: 'miss', reason: 'no_targets' };
  }
  const here = prepared.filter(
    p =>
      p.target.seriesUID === shown.seriesUID &&
      (!shown.frameOfReferenceUID || p.target.frameOfReferenceUID === shown.frameOfReferenceUID)
  );
  if (!here.length) {
    return { kind: 'miss', reason: 'other_series' };
  }
  let best: { p: PreparedTarget; placed: Placed; overlap: number; distance: number } | null = null;
  let onSlices = false;
  for (const p of here) {
    const placed = place(p, mark);
    if (!placed) {
      continue;
    }
    onSlices = true;
    const overlap = p.mask ? overlapOf(p.mask, placed, mark.type) : 0;
    const at = centre(placed);
    const distance =
      overlap > 0 ? 0 : p.mask ? distanceToMask(p, p.mask, at) : distanceToGeometry(p, at);
    if (overlap === 0 && !(distance <= HIT_MM)) {
      continue;
    }
    if (!best || overlap > best.overlap || (overlap === best.overlap && distance < best.distance)) {
      best = { p, placed, overlap, distance };
    }
  }
  if (!best) {
    return { kind: 'miss', reason: onSlices ? 'nothing_here' : 'off_slice' };
  }
  const { p, placed } = best;
  if (!p.target.promptTypes.includes(mark.type)) {
    return { kind: 'not_taken', target: p.target, type: mark.type };
  }
  const world = placed.points.map(([c, r]) => applyPoint(p.toWorld, [c, r, placed.slice]));
  return {
    kind: 'hit',
    target: p.target,
    prompt: { type: mark.type, world },
    slice: placed.slice,
    overlap: best.overlap,
    distanceMm: best.distance,
  };
}
