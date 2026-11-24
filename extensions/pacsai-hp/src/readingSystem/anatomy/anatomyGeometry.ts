/**
 * RS-36: the anatomy layers' geometry.
 *
 * A labelmap's affine maps its (column, row, slice) indices to RAS
 * millimetres; the viewer's world is DICOM's patient coordinates (LPS), which
 * flip x and y. So a viewer point goes to a voxel index through
 * inverse(affine) x diag(-1, -1, 1, 1), and a voxel index comes back through
 * diag(-1, -1, 1, 1) x affine.
 *
 * Before a series is drawn, its images are checked against the labelmap's
 * grid (gridFit): every image must lie on one of the grid's slices, with its
 * rows and columns along the grid's axes. A series that does not fit is not
 * drawn, so a layer is never shown shifted, flipped or on another series.
 *
 * Pure: no window, React or OHIF here.
 */

/** Row-major 4 x 4. */
export type Mat4 = number[][];
export type Vec3 = [number, number, number];

/** DICOM LPS to RAS, and back (its own inverse). */
export const LPS_TO_RAS: Mat4 = [
  [-1, 0, 0, 0],
  [0, -1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

/** The determinant of the upper-left 3 x 3. */
export function det3(m: Mat4): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out: Mat4 = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[r][k] * b[k][c];
      }
      out[r][c] = s;
    }
  }
  return out;
}

/** The inverse of an affine 4 x 4 (last row 0, 0, 0, 1), or null when it has none. */
export function invertAffine(m: Mat4): Mat4 | null {
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) {
    return null;
  }
  const [[a, b, c], [e, f, g], [i, j, k]] = m;
  const inv3 = [
    [(f * k - g * j) / d, (c * j - b * k) / d, (b * g - c * f) / d],
    [(g * i - e * k) / d, (a * k - c * i) / d, (c * e - a * g) / d],
    [(e * j - f * i) / d, (b * i - a * j) / d, (a * f - b * e) / d],
  ];
  const t: Vec3 = [m[0][3], m[1][3], m[2][3]];
  const out: Mat4 = [[], [], [], [0, 0, 0, 1]];
  for (let r = 0; r < 3; r++) {
    out[r] = [
      inv3[r][0],
      inv3[r][1],
      inv3[r][2],
      -(inv3[r][0] * t[0] + inv3[r][1] * t[1] + inv3[r][2] * t[2]),
    ];
  }
  return out;
}

/** m x (v, 1): a point. */
export function applyPoint(m: Mat4, v: ArrayLike<number>): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3],
  ];
}

/** m x (v, 0): a direction. */
export function applyVector(m: Mat4, v: ArrayLike<number>): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Viewer world (LPS mm) to a labelmap's (column, row, slice) index, or null when the affine has no inverse. */
export function indexFromLps(affineRAS: Mat4): Mat4 | null {
  const inv = invertAffine(affineRAS);
  return inv ? multiply4(inv, LPS_TO_RAS) : null;
}

/** A labelmap's (column, row, slice) index to the viewer's world (LPS mm). */
export function lpsFromIndex(affineRAS: Mat4): Mat4 {
  return multiply4(LPS_TO_RAS, affineRAS);
}

/** One voxel's volume in mm³. */
export function voxelVolumeMm3(affineRAS: Mat4): number {
  return Math.abs(det3(affineRAS));
}

/** The largest difference between two affines' top three rows (mm, or mm per voxel). */
export function affineDifference(a: Mat4, b: Mat4): number {
  let worst = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      worst = Math.max(worst, Math.abs(a[r][c] - b[r][c]));
    }
  }
  return worst;
}

/** An image's plane, as DICOM gives it (cornerstone's imagePlaneModule). */
export interface ImageGeometry {
  /** ImagePositionPatient: the centre of the first pixel, LPS mm. */
  position: ArrayLike<number>;
  /** Along a row (as the column index grows). */
  rowCosines: ArrayLike<number>;
  /** Down a column (as the row index grows). */
  columnCosines: ArrayLike<number>;
  /** PixelSpacing[0]: between rows. */
  rowSpacing: number;
  /** PixelSpacing[1]: between columns. */
  columnSpacing: number;
}

export interface GridFit {
  fits: boolean;
  /** The largest distance, in voxels, of an image's pixel lattice from the grid's. */
  worst: number;
  reason: string | null;
}

/** An image's lattice may sit this far from the grid's voxel centres (voxels). */
export const FIT_POSITION_TOLERANCE = 0.05;
/** And its pixel steps this far from the grid's unit steps. */
export const FIT_STEP_TOLERANCE = 0.01;

const roundVec = (v: Vec3): Vec3 => [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])];
const distance = (a: Vec3, b: Vec3): number =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** The axis of a unit step along one grid axis (0, 1 or 2), or -1. */
function unitAxis(v: Vec3): number {
  const nonzero = [0, 1, 2].filter(a => v[a] !== 0);
  return nonzero.length === 1 && Math.abs(v[nonzero[0]]) === 1 ? nonzero[0] : -1;
}

/**
 * Whether a series' images lie on a labelmap's grid: each image's first pixel
 * on a voxel centre of an in-range slice, and its column and row steps one
 * voxel along two of the grid's axes.
 *
 * `toIndex` is indexFromLps(affine); `shape` is the grid's (slices, rows, columns).
 */
export function gridFit(
  toIndex: Mat4,
  images: ImageGeometry[],
  shape: [number, number, number]
): GridFit {
  if (!images.length) {
    return { fits: false, worst: Infinity, reason: 'the series has no image planes' };
  }
  const size: Vec3 = [shape[2], shape[1], shape[0]];
  let worst = 0;
  for (const img of images) {
    const p = img.position;
    const r = img.rowCosines;
    const c = img.columnCosines;
    if (
      !p ||
      !r ||
      !c ||
      !(img.rowSpacing > 0) ||
      !(img.columnSpacing > 0) ||
      [p[0], p[1], p[2], r[0], r[1], r[2], c[0], c[1], c[2]].some(
        x => typeof x !== 'number' || !Number.isFinite(x)
      )
    ) {
      return { fits: false, worst: Infinity, reason: 'an image has no complete plane' };
    }
    const origin = applyPoint(toIndex, p);
    const stepU = applyVector(toIndex, [
      r[0] * img.columnSpacing,
      r[1] * img.columnSpacing,
      r[2] * img.columnSpacing,
    ]);
    const stepV = applyVector(toIndex, [
      c[0] * img.rowSpacing,
      c[1] * img.rowSpacing,
      c[2] * img.rowSpacing,
    ]);
    const u = roundVec(stepU);
    const v = roundVec(stepV);
    const axisU = unitAxis(u);
    const axisV = unitAxis(v);
    const stepOff = Math.max(distance(stepU, u), distance(stepV, v));
    if (axisU < 0 || axisV < 0 || axisU === axisV || stepOff > FIT_STEP_TOLERANCE) {
      return {
        fits: false,
        worst: Math.max(worst, stepOff),
        reason: "an image's rows and columns do not run along the labelmap's grid",
      };
    }
    const at = roundVec(origin);
    worst = Math.max(worst, distance(origin, at));
    if (worst > FIT_POSITION_TOLERANCE) {
      return { fits: false, worst, reason: "an image's pixels sit between the labelmap's voxels" };
    }
    const axisSlice = 3 - axisU - axisV;
    if (at[axisSlice] < 0 || at[axisSlice] >= size[axisSlice]) {
      return { fits: false, worst, reason: "an image lies outside the labelmap's slices" };
    }
  }
  return { fits: true, worst, reason: null };
}
