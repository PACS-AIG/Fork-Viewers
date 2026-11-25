/**
 * RS-36: the anatomy layers' display surfaces (output contract 1.17, the
 * reading system's D-345), for the pane's 3D view.
 *
 * A labelmap may carry one surfaces file: every label's points as
 * little-endian float32 (x, y, z) in LPS mm in the series' frame of
 * reference, then every label's triangles as little-endian uint32, three
 * point indices each, counted from that label's own first point; gzip. Each
 * label says where its surface lies in it. They are display only, never a
 * measurement (invariant 9), built on the reading system's side from the
 * labelmap (signed distance, shape-based interpolation across thick slices,
 * marching cubes within a triangle budget, Taubin smoothing).
 *
 * Read and checked before anything is drawn: the file's size against the
 * document's counts, every point finite, every triangle's indices inside its
 * label's points, every label's range inside the file. A labelmap whose
 * surfaces fail any check draws none in 3D, and says why.
 *
 * Pure: no window, React or OHIF here.
 */

export const SURFACES_ENCODING = 'lps-mm-float32-points-then-uint32-triangles-le-gzip';
/** A surfaces file's path under its study (`anatomy/<n>.<task>.surfaces.bin.gz`); group 1 is its file name. */
export const SURFACES_FILE = /^anatomy\/([0-9]{1,4}\.[a-z0-9_]{1,64}\.surfaces\.bin\.gz)$/;
/** A surfaces file's name under `anatomy/`, as the route takes it. */
export const SURFACES_BASENAME = /^[0-9]{1,4}\.[a-z0-9_]{1,64}\.surfaces\.bin\.gz$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface RsAnatomySurfaces {
  /** As the document names it: `anatomy/<n>.<task>.surfaces.bin.gz`. */
  file: string;
  /** The file's name under `anatomy/`, for the route. */
  basename: string;
  sha256: string;
  vertices: number;
  triangles: number;
  /** The builder's triangle budget per structure, when the document gives it. */
  triangleBudget: number | null;
}

/** Where one label's surface lies in its labelmap's surfaces file. */
export interface RsAnatomySurfaceIndex {
  vertexOffset: number;
  vertexCount: number;
  triangleOffset: number;
  triangleCount: number;
  /** The grid spacing (mm) its surface was taken on. */
  samplingMm: number;
}

/** One label's surface, ready to draw: its points (x, y, z) and triangles (indices into them). */
export interface SurfaceMesh {
  value: number;
  points: Float32Array;
  triangles: Uint32Array;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, least: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= least;

/** A labelmap's surfaces as the document gives them: null when it has none, a reason when malformed. */
export function readSurfaces(v: unknown): RsAnatomySurfaces | string | null {
  if (v === undefined || v === null) {
    return null;
  }
  if (!isObject(v)) {
    return 'its surfaces are not described';
  }
  const file = typeof v.file === 'string' ? v.file : '';
  const m = SURFACES_FILE.exec(file);
  if (!m) {
    return 'its surfaces file is not anatomy/<n>.<task>.surfaces.bin.gz';
  }
  const sha256 = typeof v.sha256 === 'string' ? v.sha256.toLowerCase() : '';
  if (!SHA256.test(sha256)) {
    return 'its surfaces have no sha256';
  }
  if (v.encoding !== SURFACES_ENCODING) {
    return 'its surfaces are encoded in a way this viewer does not read';
  }
  if (v.use !== 'display') {
    return 'its surfaces are not for display';
  }
  if (!isInt(v.vertices, 3) || !isInt(v.triangles, 1)) {
    return 'its surfaces do not count their points and triangles';
  }
  const method = isObject(v.method) ? v.method : null;
  return {
    file,
    basename: m[1],
    sha256,
    vertices: v.vertices,
    triangles: v.triangles,
    triangleBudget: method && isInt(method.triangleBudget, 1) ? method.triangleBudget : null,
  };
}

/** A label's place in its surfaces file, or null when it has none or it is malformed. */
export function readSurfaceIndex(v: unknown): RsAnatomySurfaceIndex | null {
  if (!isObject(v)) {
    return null;
  }
  const { vertexOffset, vertexCount, triangleOffset, triangleCount, samplingMm } = v;
  if (
    !isInt(vertexOffset, 0) ||
    !isInt(vertexCount, 3) ||
    !isInt(triangleOffset, 0) ||
    !isInt(triangleCount, 1) ||
    typeof samplingMm !== 'number' ||
    !(samplingMm > 0)
  ) {
    return null;
  }
  return { vertexOffset, vertexCount, triangleOffset, triangleCount, samplingMm };
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * The labels' surfaces from a surfaces file's bytes (after gzip), checked; or
 * why they cannot be drawn. Labels without a surface are left out.
 */
export function decodeSurfaces(
  bytes: Uint8Array,
  s: Pick<RsAnatomySurfaces, 'vertices' | 'triangles'>,
  labels: Array<{ value: number; surface: RsAnatomySurfaceIndex | null }>
): SurfaceMesh[] | string {
  const want = 12 * (s.vertices + s.triangles);
  if (bytes.length !== want) {
    return `the surfaces file holds ${bytes.length} bytes, not the ${want} its counts make`;
  }
  if (!LITTLE_ENDIAN) {
    return 'this computer reads numbers in another byte order';
  }
  // Typed arrays need 4-byte alignment: copy the bytes when they are not aligned.
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const points = new Float32Array(aligned.buffer, aligned.byteOffset, s.vertices * 3);
  const triangles = new Uint32Array(
    aligned.buffer,
    aligned.byteOffset + s.vertices * 12,
    s.triangles * 3
  );
  for (let i = 0; i < points.length; i++) {
    if (!Number.isFinite(points[i])) {
      return 'a surface point is not a number';
    }
  }
  const meshes: SurfaceMesh[] = [];
  for (const label of labels) {
    const at = label.surface;
    if (!at) {
      continue;
    }
    if (
      at.vertexOffset + at.vertexCount > s.vertices ||
      at.triangleOffset + at.triangleCount > s.triangles
    ) {
      return `label ${label.value}'s surface lies past the end of the file`;
    }
    const own = triangles.subarray(
      at.triangleOffset * 3,
      (at.triangleOffset + at.triangleCount) * 3
    );
    for (let i = 0; i < own.length; i++) {
      if (own[i] >= at.vertexCount) {
        return `label ${label.value}'s surface names a point it does not have`;
      }
    }
    meshes.push({
      value: label.value,
      points: points.subarray(at.vertexOffset * 3, (at.vertexOffset + at.vertexCount) * 3),
      triangles: own,
    });
  }
  return meshes;
}

/** Triangles as VTK's cell array wants them: 3 before each triangle's three indices. */
export function vtkPolys(triangles: Uint32Array): Uint32Array {
  const n = triangles.length / 3;
  const out = new Uint32Array(n * 4);
  for (let t = 0; t < n; t++) {
    out[t * 4] = 3;
    out[t * 4 + 1] = triangles[t * 3];
    out[t * 4 + 2] = triangles[t * 3 + 1];
    out[t * 4 + 3] = triangles[t * 3 + 2];
  }
  return out;
}

/** A labelmap's surfaces in 3D, as the pane says it. */
export type SurfaceStatus =
  | 'none'
  | 'withheld'
  | 'invalid'
  | 'waiting'
  | 'loading'
  | 'ready'
  | 'refused';
