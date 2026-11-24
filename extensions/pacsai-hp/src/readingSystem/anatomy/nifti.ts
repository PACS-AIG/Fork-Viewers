/**
 * RS-36: a labelmap file as the reading system publishes it, NIfTI-1 in one
 * file (`n+1`) with gzip, read in the browser with nothing installed: the
 * gzip through the platform's DecompressionStream, the 348-byte header by
 * hand.
 *
 * Only what a labelmap needs: three dimensions (any further ones of size 1),
 * uint8 or uint16 voxels, no intensity scaling, and the affine (the sform,
 * which the reading system always sets to the series' affine; the qform when
 * it sets one too, for the check). Anything else is refused, not guessed at.
 *
 * Pure apart from `gunzip`'s default, which uses the platform's stream.
 */
import type { Mat4 } from './anatomyGeometry';

export class NiftiError extends Error {
  constructor(why: string) {
    super(why);
    this.name = 'NiftiError';
  }
}

export interface NiftiVolume {
  /** (columns, rows, slices): NIfTI's i, j, k, with i the fastest in `data`. */
  dims: [number, number, number];
  datatype: 'uint8' | 'uint16';
  data: Uint8Array | Uint16Array;
  /** The sform, when its code is set. */
  sform: Mat4 | null;
  /** The qform, when its code is set. */
  qform: Mat4 | null;
}

const HEADER_BYTES = 348;
const DT_UINT8 = 2;
const DT_UINT16 = 512;
/** The largest voxel count taken (a 1024 x 1024 x 1024 labelmap). */
export const MAX_VOXELS = 1024 * 1024 * 1024;

/** True when these bytes start as gzip does. */
export const isGzip = (bytes: Uint8Array): boolean =>
  bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

export type Gunzip = (bytes: Uint8Array) => Promise<Uint8Array>;

/** The platform's gzip (DecompressionStream), or null where the browser has none. */
export function platformGunzip(): Gunzip | null {
  const DS = (globalThis as { DecompressionStream?: new (format: string) => unknown })
    .DecompressionStream;
  if (typeof DS !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function') {
    return null;
  }
  return async (bytes: Uint8Array) => {
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DS('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
}

/** The labelmap's NIfTI bytes: gunzipped when they are gzip, as they are otherwise. */
export async function unpackNifti(bytes: Uint8Array, gunzip: Gunzip | null): Promise<Uint8Array> {
  if (!isGzip(bytes)) {
    return bytes;
  }
  if (!gunzip) {
    throw new NiftiError('this browser cannot read gzip (no DecompressionStream)');
  }
  try {
    return await gunzip(bytes);
  } catch (_) {
    throw new NiftiError('the labelmap is not a complete gzip file');
  }
}

/** NIfTI's quaternion form as an affine (NIfTI-1's own formula). */
export function qformAffine(
  b: number,
  c: number,
  d: number,
  offset: [number, number, number],
  pixdim: [number, number, number],
  qfac: number
): Mat4 {
  let a = 1 - (b * b + c * c + d * d);
  if (a < 1e-7) {
    // A 180° rotation: (b, c, d) is the axis; renormalise it.
    const n = Math.sqrt(b * b + c * c + d * d) || 1;
    b /= n;
    c /= n;
    d /= n;
    a = 0;
  } else {
    a = Math.sqrt(a);
  }
  const r = [
    [a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c)],
    [2 * (b * c + a * d), a * a + c * c - b * b - d * d, 2 * (c * d - a * b)],
    [2 * (b * d - a * c), 2 * (c * d + a * b), a * a + d * d - c * c - b * b],
  ];
  const q = qfac < 0 ? -1 : 1;
  const s = [pixdim[0], pixdim[1], pixdim[2] * q];
  return [
    [r[0][0] * s[0], r[0][1] * s[1], r[0][2] * s[2], offset[0]],
    [r[1][0] * s[0], r[1][1] * s[1], r[1][2] * s[2], offset[1]],
    [r[2][0] * s[0], r[2][1] * s[1], r[2][2] * s[2], offset[2]],
    [0, 0, 0, 1],
  ];
}

/** A NIfTI-1 single file's header and voxels. Throws NiftiError. */
export function parseNifti(bytes: Uint8Array): NiftiVolume {
  if (bytes.length < HEADER_BYTES + 4) {
    throw new NiftiError('the labelmap is shorter than a NIfTI-1 header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let le = true;
  if (view.getInt32(0, true) !== HEADER_BYTES) {
    if (view.getInt32(0, false) !== HEADER_BYTES) {
      throw new NiftiError('the labelmap is not NIfTI-1 (its header size is not 348)');
    }
    le = false;
  }
  const magic = String.fromCharCode(bytes[344], bytes[345], bytes[346]);
  if (magic !== 'n+1' || bytes[347] !== 0) {
    throw new NiftiError('the labelmap is not a single NIfTI-1 file (n+1)');
  }
  const i16 = (at: number) => view.getInt16(at, le);
  const f32 = (at: number) => view.getFloat32(at, le);

  const rank = i16(40);
  if (rank < 3 || rank > 7) {
    throw new NiftiError('the labelmap does not have three dimensions');
  }
  const dims: [number, number, number] = [i16(42), i16(44), i16(46)];
  if (dims.some(n => n < 1)) {
    throw new NiftiError('the labelmap has an empty dimension');
  }
  for (let k = 4; k <= rank; k++) {
    if (i16(40 + 2 * k) > 1) {
      throw new NiftiError('the labelmap has more than three dimensions');
    }
  }
  const code = i16(70);
  let datatype: 'uint8' | 'uint16';
  if (code === DT_UINT8) {
    datatype = 'uint8';
  } else if (code === DT_UINT16) {
    datatype = 'uint16';
  } else {
    throw new NiftiError(`the labelmap's voxels are not uint8 or uint16 (NIfTI datatype ${code})`);
  }
  // NIfTI: a slope of 0 means no scaling at all; otherwise it must be the identity.
  const slope = f32(112);
  const inter = f32(116);
  if (
    slope !== 0 &&
    Number.isFinite(slope) &&
    (slope !== 1 || (inter !== 0 && Number.isFinite(inter)))
  ) {
    throw new NiftiError('the labelmap scales its voxels (scl_slope or scl_inter)');
  }
  const count = dims[0] * dims[1] * dims[2];
  if (count > MAX_VOXELS) {
    throw new NiftiError('the labelmap is larger than the viewer takes');
  }
  const offset = Math.round(f32(108));
  if (!(offset >= HEADER_BYTES + 4)) {
    throw new NiftiError("the labelmap's voxel offset is inside its header");
  }
  const per = datatype === 'uint8' ? 1 : 2;
  if (bytes.length < offset + count * per) {
    throw new NiftiError('the labelmap is shorter than its dimensions say');
  }
  let data: Uint8Array | Uint16Array;
  if (datatype === 'uint8') {
    data = bytes.subarray(offset, offset + count);
  } else {
    const out = new Uint16Array(count);
    for (let n = 0; n < count; n++) {
      out[n] = view.getUint16(offset + 2 * n, le);
    }
    data = out;
  }

  const sformCode = i16(254);
  const qformCode = i16(252);
  const row = (at: number) => [f32(at), f32(at + 4), f32(at + 8), f32(at + 12)];
  const sform: Mat4 | null = sformCode > 0 ? [row(280), row(296), row(312), [0, 0, 0, 1]] : null;
  const qform: Mat4 | null =
    qformCode > 0
      ? qformAffine(
          f32(256),
          f32(260),
          f32(264),
          [f32(268), f32(272), f32(276)],
          [f32(80), f32(84), f32(88)],
          f32(76)
        )
      : null;
  return { dims, datatype, data, sform, qform };
}
