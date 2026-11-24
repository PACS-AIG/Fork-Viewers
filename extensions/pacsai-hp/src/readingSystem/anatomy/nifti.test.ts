import { gunzipSync, gzipSync } from 'zlib';
import { AFFINE, GRID, ORGANS, makeNifti } from './anatomyTestData';
import { NiftiError, isGzip, parseNifti, qformAffine, unpackNifti } from './nifti';

const gunzip = async (b: Uint8Array) => new Uint8Array(gunzipSync(b));
const dims: [number, number, number] = [GRID.nx, GRID.ny, GRID.nz];

describe("a labelmap's NIfTI-1 file (RS-36 anatomy)", () => {
  it('reads a little-endian uint8 labelmap: its dimensions, voxels and sform', () => {
    const v = parseNifti(makeNifti({ dims, data: ORGANS, sform: AFFINE }));
    expect(v.dims).toEqual(dims);
    expect(v.datatype).toBe('uint8');
    expect(Array.from(v.data)).toEqual(ORGANS);
    expect(v.sform).toEqual(AFFINE);
    expect(v.qform).toBeNull();
  });

  it('reads a big-endian uint16 labelmap, its voxels in the platform order', () => {
    const data = ORGANS.map(x => (x ? x + 300 : 0));
    const v = parseNifti(
      makeNifti({ dims, datatype: 'uint16', data, sform: AFFINE, bigEndian: true })
    );
    expect(v.datatype).toBe('uint16');
    expect(v.data).toBeInstanceOf(Uint16Array);
    expect(Array.from(v.data)).toEqual(data);
    expect(v.sform).toEqual(AFFINE);
  });

  it("reads the qform as NIfTI-1's quaternion formula gives it", () => {
    // The identity rotation, with qfac -1 flipping the slice axis.
    const tidy = (m: number[][]) => m.map(r => r.map(x => Math.round(x * 1e6) / 1e6 + 0));
    expect(tidy(qformAffine(0, 0, 0, [1, 2, 3], [2, 2, 3], -1))).toEqual([
      [2, 0, 0, 1],
      [0, 2, 0, 2],
      [0, 0, -3, 3],
      [0, 0, 0, 1],
    ]);
    // 180° about z (b = c = 0, d = 1): x and y flip, as the RAS affine of an LPS-ordered axial stack does.
    const m = qformAffine(0, 0, 1, [8, 6, 10], [2, 2, 3], 1);
    expect(m.map(r => r.map(x => Math.round(x * 1e6) / 1e6 + 0))).toEqual(AFFINE);
    const v = parseNifti(
      makeNifti({
        dims,
        data: ORGANS,
        sform: AFFINE,
        qform: { b: 0, c: 0, d: 1, offset: [8, 6, 10], pixdim: [2, 2, 3], qfac: 1 },
      })
    );
    expect(v.qform?.map(r => r.map(x => Math.round(x * 1e6) / 1e6 + 0))).toEqual(AFFINE);
  });

  it('takes a 4D or 5D file whose further dimensions are 1, and refuses one that has more', () => {
    expect(
      parseNifti(makeNifti({ dims, data: ORGANS, sform: AFFINE, rank: 4, extra: 1 })).dims
    ).toEqual(dims);
    expect(() =>
      parseNifti(makeNifti({ dims, data: ORGANS, sform: AFFINE, rank: 4, extra: 2 }))
    ).toThrow(/more than three dimensions/);
  });

  it('refuses what is not a single NIfTI-1 labelmap of uint8 or uint16 voxels', () => {
    const insideHeader = makeNifti({ dims, data: ORGANS });
    new DataView(insideHeader.buffer).setFloat32(108, 100, true);
    const cases: Array<[Uint8Array, RegExp]> = [
      [new Uint8Array(100), /shorter than a NIfTI-1 header/],
      [makeNifti({ dims, data: ORGANS, sizeofHdr: 540 }), /not NIfTI-1/],
      [makeNifti({ dims, data: ORGANS, magic: 'ni1' }), /single NIfTI-1 file/],
      [makeNifti({ dims, data: ORGANS, datatype: 'int16' }), /not uint8 or uint16/],
      [makeNifti({ dims, data: ORGANS, slope: 2 }), /scales its voxels/],
      [makeNifti({ dims, data: ORGANS, slope: 1, inter: -1024 }), /scales its voxels/],
      [insideHeader, /voxel offset/],
      [makeNifti({ dims, data: ORGANS }).subarray(0, 400), /shorter than its dimensions/],
    ];
    for (const [bytes, why] of cases) {
      expect(() => parseNifti(bytes)).toThrow(NiftiError);
      expect(() => parseNifti(bytes)).toThrow(why);
    }
    // A slope of 0 means no scaling at all, whatever the intercept.
    expect(() => parseNifti(makeNifti({ dims, data: ORGANS, slope: 0, inter: 5 }))).not.toThrow();
    expect(() => parseNifti(makeNifti({ dims, data: ORGANS, slope: 1, inter: 0 }))).not.toThrow();
  });

  it('gunzips a gzip file and takes an uncompressed one as it is', async () => {
    const raw = makeNifti({ dims, data: ORGANS, sform: AFFINE });
    const gz = new Uint8Array(gzipSync(raw));
    expect(isGzip(gz)).toBe(true);
    expect(isGzip(raw)).toBe(false);
    expect(Array.from(await unpackNifti(gz, gunzip))).toEqual(Array.from(raw));
    expect(await unpackNifti(raw, null)).toBe(raw);
    await expect(unpackNifti(gz, null)).rejects.toThrow(/cannot read gzip/);
    await expect(unpackNifti(gz.subarray(0, 20), gunzip)).rejects.toThrow(/not a complete gzip/);
  });
});
