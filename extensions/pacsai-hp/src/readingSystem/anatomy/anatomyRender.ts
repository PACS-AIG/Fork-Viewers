/**
 * RS-36: the anatomy layers, drawn for one viewport.
 *
 * A viewport's canvas maps to the labelmap's index space by an affine map (the
 * viewport's camera is a parallel projection): canvas pixel (x, y) is at
 * index `origin + x * stepX + y * stepY`. Each pixel takes the nearest voxel's
 * label (so a structure's edge follows its voxels at any zoom, in any plane:
 * the native slices, a reformat, an oblique view), the topmost visible layer
 * winning. A pixel whose four neighbours all hold its own label is filled; one
 * on a structure's edge is outlined. Only each layer's rows inside its kept
 * box are visited.
 *
 * Pure: no window, React or OHIF here; the overlay puts the pixels on a canvas.
 */
import type { Vec3 } from './anatomyGeometry';

export interface RenderLayer {
  data: Uint8Array | Uint16Array;
  /** The kept box's first voxel and size, in (column, row, slice). */
  origin: [number, number, number];
  size: [number, number, number];
  /**
   * Per voxel value: 0 when it is not drawn, else 0x01BBGGRR (bit 24 says
   * "drawn", so black can be a colour).
   */
  colors: Uint32Array;
}

export interface RenderInput {
  width: number;
  height: number;
  /** The index-space point of pixel (0, 0)'s centre, and the steps per pixel. */
  origin: Vec3;
  stepX: Vec3;
  stepY: Vec3;
  /** Bottom first. */
  layers: RenderLayer[];
  /** 0..1, inside a structure. */
  fillAlpha: number;
  /** 0..1, on its edge. */
  edgeAlpha: number;
  /** A structure drawn stronger: its layer's place in `layers` and its value. */
  highlight?: { layer: number; value: number } | null;
}

export const DRAWN = 1 << 24;

/** A label's colour as RenderLayer.colors holds it. */
export const packColor = (rgb: [number, number, number]): number =>
  (DRAWN | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0]) >>> 0;

/**
 * A half-open range of x, within [0, width), that holds every x where
 * a + x * s lies inside [lo, hi), give or take a pixel at each end (the loop
 * checks each voxel index itself).
 */
function span(a: number, s: number, lo: number, hi: number, width: number): [number, number] {
  if (Math.abs(s) < 1e-12) {
    return a >= lo && a < hi ? [0, width] : [0, 0];
  }
  const x0 = (lo - a) / s;
  const x1 = (hi - a) / s;
  return [
    Math.max(0, Math.floor(Math.min(x0, x1)) - 1),
    Math.min(width, Math.ceil(Math.max(x0, x1)) + 1),
  ];
}

export interface RenderOutput {
  /** RGBA, `width * height * 4`. */
  pixels: Uint8ClampedArray;
  /** How many pixels hold a label. */
  drawn: number;
}

/**
 * The layers' pixels for this canvas. `scratch` (the key buffer) and `out` are
 * reused when their sizes fit.
 */
export function renderLabels(
  input: RenderInput,
  scratch?: Uint32Array,
  out?: Uint8ClampedArray
): RenderOutput & { scratch: Uint32Array } {
  const { width: W, height: H, origin: o, stepX: sx, stepY: sy, layers } = input;
  const n = W * H;
  const keys = scratch && scratch.length >= n ? scratch : new Uint32Array(n);
  keys.fill(0, 0, n);
  const pixels = out && out.length === n * 4 ? out : new Uint8ClampedArray(n * 4);
  pixels.fill(0);

  layers.forEach((layer, li) => {
    const [ox, oy, oz] = layer.origin;
    const [nx, ny, nz] = layer.size;
    if (!nx || !ny || !nz) {
      return;
    }
    const { data, colors } = layer;
    const tag = (li + 1) << 16;
    for (let y = 0; y < H; y++) {
      // This row's index-space start (local to the box) and, per axis, the x range inside the box.
      const a0 = o[0] + y * sy[0] - ox;
      const a1 = o[1] + y * sy[1] - oy;
      const a2 = o[2] + y * sy[2] - oz;
      const r0 = span(a0, sx[0], -0.5, nx - 0.5, W);
      const r1 = span(a1, sx[1], -0.5, ny - 0.5, W);
      const r2 = span(a2, sx[2], -0.5, nz - 0.5, W);
      const xs = Math.max(r0[0], r1[0], r2[0]);
      const xe = Math.min(r0[1], r1[1], r2[1]);
      const rowBase = y * W;
      for (let x = xs; x < xe; x++) {
        const i = Math.floor(a0 + x * sx[0] + 0.5);
        const j = Math.floor(a1 + x * sx[1] + 0.5);
        const k = Math.floor(a2 + x * sx[2] + 0.5);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
          continue;
        }
        const v = data[(k * ny + j) * nx + i];
        if (v !== 0 && colors[v] !== 0) {
          keys[rowBase + x] = tag | v;
        }
      }
    }
  });

  const fill = Math.round(Math.max(0, Math.min(1, input.fillAlpha)) * 255);
  const edge = Math.round(Math.max(0, Math.min(1, input.edgeAlpha)) * 255);
  const hl = input.highlight
    ? (((input.highlight.layer + 1) << 16) | input.highlight.value) >>> 0
    : -1;
  const hlFill = Math.max(fill, Math.round(0.55 * 255));
  let drawn = 0;
  for (let y = 0; y < H; y++) {
    const rowBase = y * W;
    for (let x = 0; x < W; x++) {
      const p = rowBase + x;
      const key = keys[p];
      if (key === 0) {
        continue;
      }
      drawn++;
      const isEdge =
        (x > 0 && keys[p - 1] !== key) ||
        (x < W - 1 && keys[p + 1] !== key) ||
        (y > 0 && keys[p - W] !== key) ||
        (y < H - 1 && keys[p + W] !== key);
      const strong = key === hl;
      const alpha = isEdge ? (strong ? 255 : edge) : strong ? hlFill : fill;
      if (alpha === 0) {
        continue;
      }
      const c = layers[(key >>> 16) - 1].colors[key & 0xffff];
      const q = p * 4;
      pixels[q] = c & 0xff;
      pixels[q + 1] = (c >>> 8) & 0xff;
      pixels[q + 2] = (c >>> 16) & 0xff;
      pixels[q + 3] = alpha;
    }
  }
  return { pixels, drawn, scratch: keys };
}

/** The visible labels at an index-space point, topmost first: [layer, value]. */
export function labelsAt(layers: RenderLayer[], point: Vec3): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li];
    const i = Math.floor(point[0] + 0.5) - layer.origin[0];
    const j = Math.floor(point[1] + 0.5) - layer.origin[1];
    const k = Math.floor(point[2] + 0.5) - layer.origin[2];
    const [nx, ny, nz] = layer.size;
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
      continue;
    }
    const v = layer.data[(k * ny + j) * nx + i];
    if (v !== 0 && layer.colors[v] !== 0) {
      found.push([li, v]);
    }
  }
  return found;
}
