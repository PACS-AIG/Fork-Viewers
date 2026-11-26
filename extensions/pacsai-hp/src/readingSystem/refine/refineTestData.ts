/**
 * RS-38 test data: refine targets on small grids (an axial one, and one
 * tilted 27° like dev's head CT), their packed outlines, and the documents.
 */
import {
  LPS_TO_RAS,
  applyPoint,
  lpsFromIndex,
  multiply4,
  type Mat4,
  type Vec3,
} from '../anatomy/anatomyGeometry';
import type { IndexTriple, RefineTarget, RefineTargets } from './refineContract';

export const SERIES = '2.25.2001';
export const OTHER_SERIES = '2.25.2002';
export const FOR = '2.25.2003';

/** (slices, rows, columns) */
export const SHAPE: IndexTriple = [6, 20, 24];

/** An LPS affine from (column, row, slice) to LPS mm, as RAS (what the contract carries). */
export function gridAffine({
  spacing = [0.8, 0.8, 5] as Vec3,
  origin = [-10, -8, 30] as Vec3,
  tiltDeg = 0,
}: { spacing?: Vec3; origin?: Vec3; tiltDeg?: number } = {}): Mat4 {
  const t = (tiltDeg * Math.PI) / 180;
  const col: Vec3 = [1, 0, 0];
  const row: Vec3 = [0, Math.cos(t), Math.sin(t)];
  const slice: Vec3 = [0, -Math.sin(t), Math.cos(t)];
  const lps: Mat4 = [
    [col[0] * spacing[0], row[0] * spacing[1], slice[0] * spacing[2], origin[0]],
    [col[1] * spacing[0], row[1] * spacing[1], slice[1] * spacing[2], origin[1]],
    [col[2] * spacing[0], row[2] * spacing[1], slice[2] * spacing[2], origin[2]],
    [0, 0, 0, 1],
  ];
  return multiply4(LPS_TO_RAS, lps);
}

/** A grid index (column, row, slice) as LPS mm on this affine. */
export const worldAt = (affineRAS: Mat4, c: number, r: number, k: number): Vec3 =>
  applyPoint(lpsFromIndex(affineRAS), [c, r, k]);

/** The packed bits (base64) of the voxels inside a box, (slice, row, column) each. */
export function packBox(lo: IndexTriple, hi: IndexTriple, voxels: IndexTriple[]): string {
  const dims = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const n = dims[0] * dims[1] * dims[2];
  const bytes = new Uint8Array(Math.ceil(n / 8));
  for (const [k, r, c] of voxels) {
    const i = ((k - lo[0]) * dims[1] + (r - lo[1])) * dims[2] + (c - lo[2]);
    bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  return Buffer.from(bytes).toString('base64');
}

/** A filled disc of this radius (voxels) on these slices, (slice, row, column). */
export function disc(centre: [number, number], radius: number, slices: number[]): IndexTriple[] {
  const out: IndexTriple[] = [];
  for (const k of slices) {
    for (let r = Math.floor(centre[0] - radius); r <= Math.ceil(centre[0] + radius); r++) {
      for (let c = Math.floor(centre[1] - radius); c <= Math.ceil(centre[1] + radius); c++) {
        if ((r - centre[0]) ** 2 + (c - centre[1]) ** 2 <= radius * radius) {
          out.push([k, r, c]);
        }
      }
    }
  }
  return out;
}

/** The contract's form of a target (what the server sends). */
export function targetJson(
  over: Record<string, unknown> = {},
  voxels?: IndexTriple[]
): Record<string, unknown> {
  const affineRAS = (over.affineRAS as Mat4 | undefined) ?? gridAffine();
  const v = voxels ?? disc([10, 12], 2.2, [2]);
  const lo: IndexTriple = [
    Math.min(...v.map(x => x[0])),
    Math.min(...v.map(x => x[1])),
    Math.min(...v.map(x => x[2])),
  ];
  const hi: IndexTriple = [
    Math.max(...v.map(x => x[0])) + 1,
    Math.max(...v.map(x => x[1])) + 1,
    Math.max(...v.map(x => x[2])) + 1,
  ];
  const { affineRAS: _a, ...rest } = over;
  return {
    observationId: 'obs-1',
    findingId: 'finding-1',
    entryId: null,
    kind: 'candidate',
    reported: false,
    label: 'liver lesion',
    location: { organOfOrigin: 'liver' },
    seriesRef: SERIES,
    seriesUID: SERIES,
    frameOfReferenceUID: FOR,
    grid: { shape: SHAPE, affineRAS },
    seriesRevision: 3,
    observationRevision: 7,
    maskRevision: 1,
    mask: { box: [lo, hi], bits: packBox(lo, hi, v), digest: 'digest-1', voxels: v.length },
    geometry: null,
    task: 'hepatic_lesion_boundary',
    recipeId: 'sam2ct@pinned',
    promptTypes: ['line', 'arrow', 'box', 'point'],
    ...rest,
  };
}

export function targetsDoc(
  targets: unknown[],
  over: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    contractVersion: 'pacsai.reading/1.18',
    artifact: 'refine_targets',
    snapshotId: null,
    studyUID: 'study-under-test',
    bundleHash: 'bundle-under-test',
    mode: 'fixture',
    revision: 4,
    targets,
    withheld: [],
    ...over,
  };
}

/** The read form of a target (what the viewer holds). */
export function makeTarget(
  over: Record<string, unknown> = {},
  voxels?: IndexTriple[]
): RefineTarget {
  const json = targetJson(over, voxels);
  const loc = json.location as Record<string, string | undefined> | null;
  return {
    ...(json as unknown as RefineTarget),
    location: loc
      ? {
          organOfOrigin: loc.organOfOrigin ?? null,
          laterality: loc.laterality ?? null,
          third: loc.third ?? null,
        }
      : null,
    geometry: (json.geometry as RefineTarget['geometry']) ?? null,
  };
}

export function makeTargets(targets: RefineTarget[]): RefineTargets {
  return {
    contractVersion: 'pacsai.reading/1.18',
    artifact: 'refine_targets',
    snapshotId: null,
    studyUID: 'study-under-test',
    bundleHash: 'bundle-under-test',
    mode: 'fixture',
    revision: 4,
    targets,
    withheld: [],
    dropped: 0,
  };
}

/** A /segment 200 body: SAM2CT's outline as these voxels. */
export function segmentOk(
  voxels: IndexTriple[],
  over: Record<string, unknown> = {}
): Record<string, unknown> {
  const lo: IndexTriple = [
    Math.min(...voxels.map(x => x[0])),
    Math.min(...voxels.map(x => x[1])),
    Math.min(...voxels.map(x => x[2])),
  ];
  const hi: IndexTriple = [
    Math.max(...voxels.map(x => x[0])) + 1,
    Math.max(...voxels.map(x => x[1])) + 1,
    Math.max(...voxels.map(x => x[2])) + 1,
  ];
  return {
    result: {
      status: 'ok',
      reasons: [],
      mask_revision: 2,
      qc: {
        truncated_at: [],
        truncated_at_crop: false,
        truncated_at_volume_edge: false,
        slices: new Set(voxels.map(v => v[0])).size,
        partial_volume: false,
        components: 1,
        leak: [],
        unprocessed_overlaps_target: false,
        unprocessed_target_voxels: 0,
        failures: [],
        passed: true,
        mask_numbers_supported: true,
      },
      timing: { started_s: 0, runtime_s: 2.5, passes: 1 },
    },
    mask: {
      shape: SHAPE,
      box: [lo, hi],
      bits: packBox(lo, hi, voxels),
      voxels: voxels.length,
      digest: 'digest-2',
    },
    resultId: 'attempt-1',
    keep: { possible: true, reason: null },
    ...over,
  };
}
