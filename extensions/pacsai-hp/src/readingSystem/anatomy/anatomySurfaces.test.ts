import {
  SURFACES_BASENAME,
  SURFACES_ENCODING,
  decodeSurfaces,
  readSurfaceIndex,
  readSurfaces,
  vtkPolys,
} from './anatomySurfaces';
import { makeSurfaces } from './anatomyTestData';

const SHA = 'd'.repeat(64);

describe("the anatomy's display surfaces as the pane reads them (RS-36, contract 1.17)", () => {
  it("reads a labelmap's surfaces: its file, sha256, counts and the builder's budget; null when it has none", () => {
    const fx = makeSurfaces('total', [{ value: 1, centre: [0, 0, 0] }]);
    expect(readSurfaces(undefined)).toBeNull();
    expect(readSurfaces(null)).toBeNull();
    expect(readSurfaces({ ...fx.describe(SHA.toUpperCase()) })).toEqual({
      file: 'anatomy/0.total.surfaces.bin.gz',
      basename: '0.total.surfaces.bin.gz',
      sha256: SHA,
      vertices: 4,
      triangles: 4,
      triangleBudget: 50000,
    });
    expect(readSurfaces({ ...fx.describe(SHA), method: null })).toMatchObject({
      triangleBudget: null,
    });
  });

  it('gives the reason when a description is malformed, field by field', () => {
    const good = makeSurfaces('total', [{ value: 1, centre: [0, 0, 0] }]).describe(SHA);
    const cases: Array<[Record<string, unknown> | string, RegExp]> = [
      ['x', /not described/],
      [
        { ...good, file: 'anatomy/0.total.labels.nii.gz' },
        /not anatomy\/<n>.<task>.surfaces.bin.gz/,
      ],
      [{ ...good, file: '../0.total.surfaces.bin.gz' }, /not anatomy/],
      [{ ...good, sha256: 'abc' }, /no sha256/],
      [{ ...good, encoding: 'lps-mm-float64' }, /encoded in a way/],
      [{ ...good, use: 'measurement' }, /not for display/],
      [{ ...good, vertices: 2 }, /do not count/],
      [{ ...good, triangles: 0 }, /do not count/],
      [{ ...good, triangles: 1.5 }, /do not count/],
    ];
    for (const [v, reason] of cases) {
      const r = readSurfaces(v);
      expect(typeof r).toBe('string');
      expect(r).toMatch(reason);
    }
    expect(SURFACES_ENCODING).toBe('lps-mm-float32-points-then-uint32-triangles-le-gzip');
    expect(SURFACES_BASENAME.test('12.total.surfaces.bin.gz')).toBe(true);
    expect(SURFACES_BASENAME.test('12.total.labels.nii.gz')).toBe(false);
    expect(SURFACES_BASENAME.test('../12.total.surfaces.bin.gz')).toBe(false);
  });

  it("reads a label's place in the file, or null when it is missing or malformed", () => {
    const at = {
      vertexOffset: 0,
      vertexCount: 4,
      triangleOffset: 0,
      triangleCount: 4,
      samplingMm: 1.5,
    };
    expect(readSurfaceIndex(at)).toEqual(at);
    expect(readSurfaceIndex(undefined)).toBeNull();
    expect(readSurfaceIndex({ ...at, vertexCount: 2 })).toBeNull();
    expect(readSurfaceIndex({ ...at, triangleCount: 0 })).toBeNull();
    expect(readSurfaceIndex({ ...at, vertexOffset: -1 })).toBeNull();
    expect(readSurfaceIndex({ ...at, samplingMm: 0 })).toBeNull();
    expect(readSurfaceIndex({ ...at, samplingMm: '1.5' })).toBeNull();
  });

  it("decodes each label's points and triangles, its indices counted from its own first point", () => {
    const fx = makeSurfaces('total', [
      { value: 1, centre: [10, 20, 30] },
      { value: 2, centre: [-5, 0, 5], size: 2 },
    ]);
    const labels = [
      { value: 1, surface: readSurfaceIndex(fx.index[1]) },
      { value: 2, surface: readSurfaceIndex(fx.index[2]) },
      { value: 3, surface: null },
    ];
    const meshes = decodeSurfaces(fx.bytes, fx, labels);
    if (typeof meshes === 'string') {
      throw new Error(meshes);
    }
    // A label without a surface is left out.
    expect(meshes.map(m => m.value)).toEqual([1, 2]);
    expect(Array.from(meshes[0].points.slice(0, 3))).toEqual([14, 24, 34]);
    expect(Array.from(meshes[1].points.slice(0, 6))).toEqual([-3, 2, 7, -7, -2, 7]);
    expect(Array.from(meshes[1].triangles)).toEqual([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]);
    // Bytes that do not start on a 4-byte boundary decode the same.
    const shifted = new Uint8Array(fx.bytes.length + 1);
    shifted.set(fx.bytes, 1);
    const again = decodeSurfaces(shifted.subarray(1), fx, labels);
    expect(typeof again === 'string' ? again : Array.from(again[1].points)).toEqual(
      Array.from(meshes[1].points)
    );
  });

  it('draws nothing from a file that fails a check, and says why', () => {
    const fx = makeSurfaces('total', [{ value: 1, centre: [0, 0, 0] }]);
    const labels = [{ value: 1, surface: readSurfaceIndex(fx.index[1]) }];
    expect(decodeSurfaces(fx.bytes.subarray(4), fx, labels)).toMatch(
      /holds 92 bytes, not the 96 its counts make/
    );
    const nan = fx.bytes.slice();
    new DataView(nan.buffer).setFloat32(4, NaN, true);
    expect(decodeSurfaces(nan, fx, labels)).toMatch(/not a number/);
    const past = [{ value: 1, surface: { ...fx.index[1], triangleOffset: 1 } as never }];
    expect(decodeSurfaces(fx.bytes, fx, past)).toMatch(/label 1's surface lies past the end/);
    const outside = fx.bytes.slice();
    new DataView(outside.buffer).setUint32(12 * 4, 4, true);
    expect(decodeSurfaces(outside, fx, labels)).toMatch(/names a point it does not have/);
  });

  it("puts triangles in VTK's cell array form: 3 before each one's indices", () => {
    expect(Array.from(vtkPolys(new Uint32Array([0, 1, 2, 2, 1, 3])))).toEqual([
      3, 0, 1, 2, 3, 2, 1, 3,
    ]);
  });
});
