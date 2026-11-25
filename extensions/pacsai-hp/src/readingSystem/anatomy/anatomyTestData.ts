/**
 * RS-36: synthetic anatomy for the unit tests: a NIfTI-1 writer and an
 * anatomy artifact builder. Everything here is made up for the tests (the
 * UIDs are 2.25 placeholders); nothing comes from the reading system's
 * fixtures.
 */
import type { Mat4 } from './anatomyGeometry';
import { SURFACES_ENCODING } from './anatomySurfaces';

export interface NiftiSpec {
  dims: [number, number, number];
  datatype?: 'uint8' | 'uint16' | 'int16';
  data: ArrayLike<number>;
  sform?: Mat4 | null;
  qform?: {
    b: number;
    c: number;
    d: number;
    offset: [number, number, number];
    pixdim: [number, number, number];
    qfac: number;
  } | null;
  bigEndian?: boolean;
  magic?: string;
  rank?: number;
  extra?: number;
  slope?: number;
  inter?: number;
  voxOffset?: number;
  sizeofHdr?: number;
}

/** A NIfTI-1 single file (uncompressed). */
export function makeNifti(spec: NiftiSpec): Uint8Array {
  const datatype = spec.datatype ?? 'uint8';
  const per = datatype === 'uint8' ? 1 : 2;
  const offset = spec.voxOffset ?? 352;
  const [nx, ny, nz] = spec.dims;
  const count = nx * ny * nz;
  const bytes = new Uint8Array(offset + count * per);
  const view = new DataView(bytes.buffer);
  const le = !spec.bigEndian;
  view.setInt32(0, spec.sizeofHdr ?? 348, le);
  const rank = spec.rank ?? 3;
  const dim = [rank, nx, ny, nz, spec.extra ?? 1, 1, 1, 1];
  dim.forEach((d, n) => view.setInt16(40 + 2 * n, d, le));
  view.setInt16(70, datatype === 'uint8' ? 2 : datatype === 'uint16' ? 512 : 4, le);
  view.setInt16(72, per * 8, le);
  const q = spec.qform;
  const pixdim = [
    q?.qfac ?? 1,
    q?.pixdim[0] ?? 1,
    q?.pixdim[1] ?? 1,
    q?.pixdim[2] ?? 1,
    1,
    1,
    1,
    1,
  ];
  pixdim.forEach((p, n) => view.setFloat32(76 + 4 * n, p, le));
  view.setFloat32(108, offset, le);
  view.setFloat32(112, spec.slope ?? 0, le);
  view.setFloat32(116, spec.inter ?? 0, le);
  if (q) {
    view.setInt16(252, 1, le);
    view.setFloat32(256, q.b, le);
    view.setFloat32(260, q.c, le);
    view.setFloat32(264, q.d, le);
    view.setFloat32(268, q.offset[0], le);
    view.setFloat32(272, q.offset[1], le);
    view.setFloat32(276, q.offset[2], le);
  }
  if (spec.sform) {
    view.setInt16(254, 2, le);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        view.setFloat32(280 + 16 * r + 4 * c, spec.sform[r][c], le);
      }
    }
  }
  const magic = spec.magic ?? 'n+1';
  for (let n = 0; n < 3; n++) {
    bytes[344 + n] = magic.charCodeAt(n) || 0;
  }
  bytes[347] = 0;
  for (let n = 0; n < count; n++) {
    const v = spec.data[n] ?? 0;
    if (per === 1) {
      bytes[offset + n] = v;
    } else {
      view.setUint16(offset + 2 * n, v, le);
    }
  }
  return bytes;
}

/**
 * The test grid: an axial stack of 5 slices of 6 rows x 8 columns, 2 x 2 mm
 * pixels 3 mm apart, rows along LPS +x, columns along LPS +y, the first pixel
 * at LPS (-8, -6, 10). Its RAS affine (column, row, slice) -> RAS mm.
 */
export const GRID = { nx: 8, ny: 6, nz: 5 };
export const AFFINE: Mat4 = [
  [-2, 0, 0, 8],
  [0, -2, 0, 6],
  [0, 0, 3, 10],
  [0, 0, 0, 1],
];
/** The same grid with its row index flipped (as many NIfTI writers store it). */
export const AFFINE_ROWS_FLIPPED: Mat4 = [
  [-2, 0, 0, 8],
  [0, 2, 0, 6 - 2 * (GRID.ny - 1)],
  [0, 0, 3, 10],
  [0, 0, 0, 1],
];

/** The DICOM planes of the test grid's images (LPS). */
export function gridImages(slices = GRID.nz) {
  return Array.from({ length: slices }, (_, k) => ({
    position: [-8, -6, 10 + 3 * k],
    rowCosines: [1, 0, 0],
    columnCosines: [0, 1, 0],
    rowSpacing: 2,
    columnSpacing: 2,
  }));
}

/** A labelmap for the test grid: `fill(i, j, k)` gives each voxel's value. */
export function gridVolume(fill: (i: number, j: number, k: number) => number): number[] {
  const out: number[] = [];
  for (let k = 0; k < GRID.nz; k++) {
    for (let j = 0; j < GRID.ny; j++) {
      for (let i = 0; i < GRID.nx; i++) {
        out.push(fill(i, j, k));
      }
    }
  }
  return out;
}

export const countOf = (data: number[], value: number) => data.filter(v => v === value).length;

/** Organs (total): liver 1 in slices 1-3, spleen 2 in slice 3 only. */
export const ORGANS = gridVolume((i, j, k) =>
  k >= 1 && k <= 3 && i <= 2 && j <= 2 ? 1 : k === 3 && i >= 5 && j >= 3 ? 2 : 0
);
/** Vertebrae: L1 (value 1) in slices 0-1, a 2 x 2 block. */
export const VERTEBRAE = gridVolume((i, j, k) => (k <= 1 && i >= 3 && i <= 4 && j >= 4 ? 1 : 0));
/** Body cavities: the abdominal cavity (value 1) fills slices 1-4. */
export const CAVITIES = gridVolume((_i, _j, k) => (k >= 1 ? 1 : 0));

export const STUDY = '2.25.1001';
export const SERIES = '2.25.1002';

export function makeAnatomyDoc(
  over: Record<string, unknown> = {},
  series: Record<string, unknown> = {}
) {
  return {
    contractVersion: 'pacsai.reading/1.10',
    artifact: 'anatomy',
    snapshotId: 'fx-anatomy',
    studyUID: STUDY,
    bundleHash: 'f'.repeat(64),
    mode: 'clinical',
    purpose: 'display',
    series: [
      {
        seriesKey: 'CT#1',
        seriesUID: SERIES,
        frameOfReferenceUID: '2.25.1003',
        grid: { shape: [GRID.nz, GRID.ny, GRID.nx], affineRAS: AFFINE },
        frame: { levels: [] },
        labelmaps: [
          {
            task: 'trunk_cavities',
            file: 'anatomy/0.trunk_cavities.labels.nii.gz',
            sha256: 'c'.repeat(64),
            datatype: 'uint8',
            labels: [
              {
                value: 1,
                concept: 'x',
                name: 'abdominal cavity',
                rawClass: 'abdominal_cavity',
                voxels: countOf(CAVITIES, 1),
              },
            ],
          },
          {
            task: 'total',
            file: 'anatomy/0.total.labels.nii.gz',
            sha256: 'a'.repeat(64),
            datatype: 'uint8',
            labels: [
              {
                value: 1,
                concept: 'x',
                name: 'liver',
                rawClass: 'liver',
                voxels: countOf(ORGANS, 1),
                measurementEligible: true,
              },
              {
                value: 2,
                concept: 'x',
                name: 'spleen',
                rawClass: 'spleen',
                voxels: countOf(ORGANS, 2),
                measurementEligible: true,
              },
            ],
          },
          {
            task: 'vertebrae_pp',
            file: 'anatomy/0.vertebrae_pp.labels.nii.gz',
            sha256: 'b'.repeat(64),
            datatype: 'uint8',
            labels: [
              {
                value: 1,
                concept: 'x',
                name: 'L1 vertebra',
                rawClass: 'vertebrae_L1',
                voxels: countOf(VERTEBRAE, 1),
              },
            ],
          },
        ],
        labelmapsWithheld: null,
        unnamed: 3,
        ...series,
      },
    ],
    ...over,
  };
}

/**
 * Display surfaces (contract 1.17) for one labelmap: a tetrahedron per label
 * around its centre (LPS mm), its points then its triangles, little-endian as
 * the contract has them (before gzip). `describe` gives the labelmap's
 * `surfaces` for a sha256, `index` each label's `surface`.
 */
export function makeSurfaces(
  task: string,
  labels: Array<{ value: number; centre: [number, number, number]; size?: number }>
) {
  const points: number[] = [];
  const triangles: number[] = [];
  const index: Record<number, Record<string, number>> = {};
  for (const l of labels) {
    const [x, y, z] = l.centre;
    const r = l.size ?? 4;
    const vertexOffset = points.length / 3;
    const triangleOffset = triangles.length / 3;
    points.push(x + r, y + r, z + r, x - r, y - r, z + r, x - r, y + r, z - r, x + r, y - r, z - r);
    triangles.push(0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2);
    index[l.value] = {
      vertexOffset,
      vertexCount: 4,
      triangleOffset,
      triangleCount: 4,
      samplingMm: 1.5,
    };
  }
  const vertices = points.length / 3;
  const count = triangles.length / 3;
  const bytes = new Uint8Array(12 * (vertices + count));
  const view = new DataView(bytes.buffer);
  points.forEach((v, n) => view.setFloat32(4 * n, v, true));
  triangles.forEach((v, n) => view.setUint32(12 * vertices + 4 * n, v, true));
  return {
    bytes,
    vertices,
    triangles: count,
    index,
    describe: (sha256: string) => ({
      file: `anatomy/0.${task}.surfaces.bin.gz`,
      sha256,
      encoding: SURFACES_ENCODING,
      use: 'display',
      vertices,
      triangles: count,
      method: { builder: 'test', version: '0', field: 'sdf', triangleBudget: 50000 },
    }),
  };
}
