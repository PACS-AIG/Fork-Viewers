/**
 * RS-36: the CT analysis pane's anatomy layers, end to end in the viewer: the
 * case rsAnatomyCpu.e2e.ts and rsAnatomyWebgl.e2e.ts run, without WebGL
 * (cornerstone's CPU path) and with it.
 *
 * The harness's archive has no images, so this test serves its own: a
 * synthetic CT series of 20 axial slices of 64 x 64 (4 mm pixels, 5 mm apart)
 * with two bright blocks, and its anatomy artifact with two labelmaps on the
 * series' grid (one block labelled "liver", the other "left kidney"; body
 * cavities in a second, hidden labelmap), stored with its rows flipped as many
 * NIfTI writers store them. Everything here is made up for the test (the UIDs
 * are 2.25 placeholders); nothing comes from the reading system's fixtures.
 * The pane itself reads the fixture study's documents from the served API, as
 * the other tests do; only the archive and the anatomy routes are this test's.
 *
 * What it checks: the anatomy is read and its tab offered first; the table
 * lists the structures head to feet with their volumes; a click on a structure
 * brings its slice into the viewport, where each label is drawn exactly over
 * its block on the rendered image (a flipped axis would put it over the
 * other side); hovering names the structure; the bar's button turns the
 * layers off and on. Then the structures in 3D (contract 1.17's display
 * surfaces, a box around each block): drawn from the front with the liver on
 * the left, following the tab's switches, enlarged over the images beside the
 * report column and back with Esc; without WebGL, the view says so.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import { SURFACES_ENCODING } from '../../src/readingSystem/anatomy/anatomySurfaces';
import { makeNifti } from '../../src/readingSystem/anatomy/anatomyTestData';
import { openStudy, pane, paneState } from './rsE2e';

const RICH = 'renal';

// ---- the synthetic series -------------------------------------------------------------
const SERIES = '2.25.880001';
const FRAME_OF_REFERENCE = '2.25.880002';
const sop = (k: number) => `2.25.8801${String(k).padStart(2, '0')}`;
const SLICES = 20;
const SIZE = 64;
const PIXEL_MM = 4;
const SLICE_MM = 5;
const ipp = (k: number) => [-128, -128, -50 + SLICE_MM * k];

const inBody = (u: number, v: number) => ((u - 31.5) / 28) ** 2 + ((v - 31.5) / 24) ** 2 <= 1;
const inLiver = (u: number, v: number, k: number) =>
  k >= 8 && k <= 12 && u >= 8 && u <= 23 && v >= 20 && v <= 35;
const inKidney = (u: number, v: number, k: number) =>
  k >= 5 && k <= 14 && u >= 40 && u <= 47 && v >= 40 && v <= 47;
const hu = (u: number, v: number, k: number) =>
  !inBody(u, v) ? -1000 : inLiver(u, v, k) ? 180 : inKidney(u, v, k) ? 300 : 40;

function frame(k: number): Buffer {
  const out = Buffer.alloc(SIZE * SIZE * 2);
  for (let v = 0; v < SIZE; v++) {
    for (let u = 0; u < SIZE; u++) {
      out.writeUInt16LE(hu(u, v, k) + 1024, 2 * (v * SIZE + u));
    }
  }
  return out;
}

const tag = (vr: string, ...value: unknown[]) => ({ vr, Value: value });
function studyJson(study: string) {
  return {
    '0020000D': tag('UI', study),
    '00100010': tag('PN', { Alphabetic: 'Anatomy^Synthetic' }),
    '00100020': tag('LO', 'RS36-E2E'),
    '00080020': tag('DA', '20261124'),
    '00080030': tag('TM', '101500'),
    '00080050': tag('SH', 'E2E1'),
    '00080061': tag('CS', 'CT'),
    '00081030': tag('LO', 'CT abdomen (synthetic)'),
    '00201206': tag('IS', 1),
    '00201208': tag('IS', SLICES),
  };
}
function seriesJson(study: string) {
  return {
    '0020000D': tag('UI', study),
    '0020000E': tag('UI', SERIES),
    '00080060': tag('CS', 'CT'),
    '0008103E': tag('LO', 'Abdomen 5mm (synthetic)'),
    '00200011': tag('IS', 2),
    '00201209': tag('IS', SLICES),
  };
}
function instanceJson(study: string, k: number) {
  return {
    ...seriesJson(study),
    ...studyJson(study),
    '00020010': tag('UI', '1.2.840.10008.1.2.1'),
    '00080016': tag('UI', '1.2.840.10008.5.1.4.1.1.2'),
    '00080018': tag('UI', sop(k)),
    '00080008': tag('CS', 'ORIGINAL', 'PRIMARY', 'AXIAL'),
    '00200013': tag('IS', k + 1),
    '00200052': tag('UI', FRAME_OF_REFERENCE),
    '00200032': tag('DS', ...ipp(k)),
    '00200037': tag('DS', 1, 0, 0, 0, 1, 0),
    '00280030': tag('DS', PIXEL_MM, PIXEL_MM),
    '00180050': tag('DS', SLICE_MM),
    '00280002': tag('US', 1),
    '00280004': tag('CS', 'MONOCHROME2'),
    '00280010': tag('US', SIZE),
    '00280011': tag('US', SIZE),
    '00280100': tag('US', 16),
    '00280101': tag('US', 16),
    '00280102': tag('US', 15),
    '00280103': tag('US', 0),
    '00281050': tag('DS', 40),
    '00281051': tag('DS', 400),
    '00281052': tag('DS', -1024),
    '00281053': tag('DS', 1),
    '00281054': tag('LO', 'HU'),
  };
}

// ---- its anatomy ------------------------------------------------------------------------
/** (column, row, slice) -> RAS mm, the rows flipped: index j holds image row 63 - j. */
const AFFINE = [
  [-PIXEL_MM, 0, 0, 128],
  [0, PIXEL_MM, 0, 128 - PIXEL_MM * (SIZE - 1)],
  [0, 0, SLICE_MM, -50],
  [0, 0, 0, 1],
];
function labelmap(value: (u: number, v: number, k: number) => number) {
  const data: number[] = [];
  for (let k = 0; k < SLICES; k++) {
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        data.push(value(i, SIZE - 1 - j, k));
      }
    }
  }
  const gz = gzipSync(makeNifti({ dims: [SIZE, SIZE, SLICES], data, sform: AFFINE }));
  return { gz, sha256: createHash('sha256').update(gz).digest('hex'), data };
}
const TOTAL = labelmap((u, v, k) => (inLiver(u, v, k) ? 1 : inKidney(u, v, k) ? 2 : 0));
const CAVITIES = labelmap((u, v, k) => (inBody(u, v) && k >= 2 && k <= 17 ? 1 : 0));
const count = (data: number[], value: number) => data.filter(x => x === value).length;

/**
 * A labelmap's display surfaces (contract 1.17): a box around each structure's
 * block (LPS mm, the voxels' outer faces), 8 corners and 12 outward triangles
 * each, little-endian points then triangles, gzip.
 */
type Corners = [[number, number, number], [number, number, number]];
function surfaces(task: string, boxes: Array<[number, Corners]>) {
  const points: number[] = [];
  const triangles: number[] = [];
  const index: Record<number, Record<string, number>> = {};
  for (const [value, [[x0, y0, z0], [x1, y1, z1]]] of boxes) {
    const vertexOffset = points.length / 3;
    const triangleOffset = triangles.length / 3;
    // Corner n is (x0 or x1, y0 or y1, z0 or z1) by its bits 1, 2 and 4.
    for (const z of [z0, z1]) {
      for (const y of [y0, y1]) {
        for (const x of [x0, x1]) {
          points.push(x, y, z);
        }
      }
    }
    // prettier-ignore
    triangles.push(0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5);
    index[value] = {
      vertexOffset,
      vertexCount: 8,
      triangleOffset,
      triangleCount: 12,
      samplingMm: 4,
    };
  }
  const vertices = points.length / 3;
  const raw = Buffer.alloc(4 * (points.length + triangles.length));
  points.forEach((v, n) => raw.writeFloatLE(v, 4 * n));
  triangles.forEach((v, n) => raw.writeUInt32LE(v, 4 * (points.length + n)));
  const gz = gzipSync(raw);
  return {
    gz,
    index,
    surfaces: {
      file: `anatomy/0.${task}.surfaces.bin.gz`,
      sha256: createHash('sha256').update(gz).digest('hex'),
      encoding: SURFACES_ENCODING,
      use: 'display',
      vertices,
      triangles: triangles.length / 3,
      method: { builder: 'e2e boxes', version: '1', field: 'none', triangleBudget: 12 },
    },
  };
}
// Pixel (u, v) of slice k is at LPS (-128 + 4u, -128 + 4v, -50 + 5k): each box reaches its voxels' outer faces.
const LIVER_BOX: Corners = [
  [-98, -50, -12.5],
  [-34, 14, 12.5],
];
const KIDNEY_BOX: Corners = [
  [30, 30, -27.5],
  [62, 62, 22.5],
];
const CAVITY_BOX: Corners = [
  [-114, -98, -42.5],
  [110, 94, 37.5],
];
const TOTAL_SURFACES = surfaces('total', [
  [1, LIVER_BOX],
  [2, KIDNEY_BOX],
]);
const CAVITY_SURFACES = surfaces('trunk_cavities', [[1, CAVITY_BOX]]);

function anatomyJson(study: string) {
  return {
    contractVersion: 'pacsai.reading/1.17',
    artifact: 'anatomy',
    snapshotId: null,
    studyUID: study,
    bundleHash: 'e2e',
    mode: 'fixture',
    purpose: 'display',
    series: [
      {
        seriesKey: 'e2e#1',
        seriesUID: SERIES,
        frameOfReferenceUID: FRAME_OF_REFERENCE,
        grid: { shape: [SLICES, SIZE, SIZE], affineRAS: AFFINE },
        frame: {},
        labelmaps: [
          {
            task: 'total',
            file: 'anatomy/0.total.labels.nii.gz',
            sha256: TOTAL.sha256,
            datatype: 'uint8',
            surfaces: TOTAL_SURFACES.surfaces,
            labels: [
              {
                value: 1,
                concept: 'e2e.liver',
                name: 'liver',
                rawClass: 'liver',
                voxels: count(TOTAL.data, 1),
                measurementEligible: true,
                surface: TOTAL_SURFACES.index[1],
                // Research features (contract 1.15), made up for the test.
                radiomics: {
                  use: 'research',
                  featureSet: 'radiomics_v1',
                  engine: 'pyradiomics 3.0.1',
                  state: 'computed',
                  reason: '',
                  features: {
                    firstorder_Median: 180.25,
                    firstorder_Entropy: 0.5,
                    shape_Sphericity: 0.81,
                    glcm_Contrast: null,
                  },
                },
              },
              {
                value: 2,
                concept: 'e2e.kidney',
                name: 'left kidney',
                rawClass: 'kidney_left',
                voxels: count(TOTAL.data, 2),
                measurementEligible: true,
                surface: TOTAL_SURFACES.index[2],
                radiomics: {
                  use: 'research',
                  featureSet: 'radiomics_v1',
                  engine: null,
                  state: 'not_computed',
                  reason: 'no radiomics engine is installed in this build',
                  features: {},
                },
              },
            ],
          },
          {
            task: 'trunk_cavities',
            file: 'anatomy/0.trunk_cavities.labels.nii.gz',
            sha256: CAVITIES.sha256,
            datatype: 'uint8',
            surfaces: CAVITY_SURFACES.surfaces,
            labels: [
              {
                value: 1,
                concept: 'e2e.cavity',
                name: 'abdominal cavity',
                rawClass: 'abdominal_cavity',
                voxels: count(CAVITIES.data, 1),
                measurementEligible: false,
                surface: CAVITY_SURFACES.index[1],
              },
            ],
          },
        ],
        labelmapsWithheld: null,
        unnamed: 1,
      },
    ],
  };
}

// ---- the routes -------------------------------------------------------------------------
const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/dicom+json', body: JSON.stringify(body) });

async function serveArchiveAndAnatomy(context: BrowserContext, unknown: string[]) {
  await context.route(
    url => url.pathname.startsWith('/dicomweb'),
    async route => {
      const url = new URL(route.request().url());
      const p = url.pathname.replace(/^\/dicomweb/, '');
      let m: RegExpExecArray | null;
      if (p === '/studies') {
        const study = url.searchParams.get('StudyInstanceUID');
        return json(route, study ? [studyJson(study)] : []);
      }
      if ((m = /^\/studies\/([^/]+)\/series$/.exec(p))) {
        return json(route, [seriesJson(m[1])]);
      }
      if ((m = /^\/studies\/([^/]+)(?:\/series\/[^/]+)?\/metadata$/.exec(p))) {
        const study = m[1];
        return json(
          route,
          Array.from({ length: SLICES }, (_, k) => instanceJson(study, k))
        );
      }
      if ((m = /^\/studies\/[^/]+\/series\/[^/]+\/instances\/([^/]+)\/frames\/1$/.exec(p))) {
        const k = Array.from({ length: SLICES }, (_, n) => n).find(n => sop(n) === m![1]);
        if (k !== undefined) {
          return route.fulfill({
            status: 200,
            contentType: 'application/octet-stream',
            body: frame(k),
          });
        }
      }
      unknown.push(p.replace(/[0-9]+(\.[0-9]+){2,}/g, '<uid>'));
      return route.fulfill({ status: 404, body: '' });
    }
  );
  await context.route(
    url => /^\/rs-api\/studies\/[^/]+\/anatomy(\/|$)/.test(url.pathname),
    async route => {
      const p = new URL(route.request().url()).pathname;
      const m = /^\/rs-api\/studies\/([^/]+)\/anatomy(?:\/(.+))?$/.exec(p)!;
      if (!m[2]) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(anatomyJson(decodeURIComponent(m[1]))),
        });
      }
      const files: Record<string, { gz: Buffer }> = {
        '0.total.labels.nii.gz': TOTAL,
        '0.trunk_cavities.labels.nii.gz': CAVITIES,
        '0.total.surfaces.bin.gz': TOTAL_SURFACES,
        '0.trunk_cavities.surfaces.bin.gz': CAVITY_SURFACES,
      };
      const file = files[m[2]];
      return file
        ? route.fulfill({ status: 200, contentType: 'application/gzip', body: file.gz })
        : route.fulfill({ status: 404, body: '' });
    }
  );
}

type Box = { x0: number; y0: number; x1: number; y1: number } | null;
interface Measured {
  bright: { left: Box; right: Box };
  drawn: { left: Box; right: Box };
  rect: { left: number; top: number };
  centre: {
    left: { r: number; g: number; b: number; a: number } | null;
    right: { r: number; g: number; b: number; a: number } | null;
  };
}

/** In the page: the bright blocks on cornerstone's canvas and the drawn labels on the layer, as boxes (CSS px). */
function measure(): Measured | null {
  const layer = document.querySelector(
    'canvas[data-pacsai-anatomy-layer]'
  ) as HTMLCanvasElement | null;
  const host = layer?.parentElement;
  const cs = host?.querySelector('canvas.cornerstone-canvas') as HTMLCanvasElement | null;
  if (!layer || !host || !cs) {
    return null;
  }
  const W = layer.width;
  const H = layer.height;
  const grow = (b: Box, x: number, y: number): Box =>
    b
      ? {
          x0: Math.min(b.x0, x),
          y0: Math.min(b.y0, y),
          x1: Math.max(b.x1, x),
          y1: Math.max(b.y1, y),
        }
      : { x0: x, y0: y, x1: x, y1: y };
  // Cornerstone's canvas is in device pixels: draw it down to the layer's CSS pixels.
  const scratch = document.createElement('canvas');
  scratch.width = W;
  scratch.height = H;
  const sctx = scratch.getContext('2d')!;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(cs, 0, 0, W, H);
  const img = sctx.getImageData(0, 0, W, H).data;
  const lay = layer.getContext('2d')!.getImageData(0, 0, W, H).data;
  const out: Measured = {
    bright: { left: null, right: null },
    drawn: { left: null, right: null },
    rect: { left: host.getBoundingClientRect().left, top: host.getBoundingClientRect().top },
    centre: { left: null, right: null },
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const q = (y * W + x) * 4;
      const side = x < W / 2 ? 'left' : 'right';
      if (img[q] > 200) {
        out.bright[side] = grow(out.bright[side], x, y);
      }
      if (lay[q + 3] > 0) {
        out.drawn[side] = grow(out.drawn[side], x, y);
      }
    }
  }
  (['left', 'right'] as const).forEach(side => {
    const b = out.drawn[side];
    if (b) {
      const cx = Math.round((b.x0 + b.x1) / 2);
      const cy = Math.round((b.y0 + b.y1) / 2);
      const q = (cy * W + cx) * 4;
      out.centre[side] = { r: lay[q], g: lay[q + 1], b: lay[q + 2], a: lay[q + 3] };
    }
  });
  return out;
}

const centre = (b: Box) => (b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : null);

/**
 * How many pixels of an element's screenshot are drawn (not the 3D view's
 * background, 10 17 27), in its left and right halves: the screenshot is what
 * the page shows, WebGL included.
 */
async function drawnHalves(page: Page, el: Locator): Promise<{ left: number; right: number }> {
  const png = (await el.screenshot()).toString('base64');
  return page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let left = 0;
    let right = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const q = (y * c.width + x) * 4;
        if (Math.abs(d[q] - 10) + Math.abs(d[q + 1] - 17) + Math.abs(d[q + 2] - 27) > 40) {
          if (x < c.width / 2) {
            left++;
          } else {
            right++;
          }
        }
      }
    }
    return { left, right };
  }, png);
}
/**
 * Drawn pixels (as drawnHalves counts them) near the sides of an element's
 * middle rows (the model is centred; the page's notices may cover the bottom
 * of a viewport), two columns in from each side (the viewport pane's border
 * may show in the outermost): the model clipped at its sides.
 */
async function drawnEdges(page: Page, el: Locator, cols = 3): Promise<number> {
  const png = (await el.screenshot()).toString('base64');
  return page.evaluate(
    async ([b64, n]) => {
      const bytes = Uint8Array.from(atob(b64 as string), ch => ch.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let edge = 0;
      for (let y = Math.floor(c.height * 0.2); y < Math.ceil(c.height * 0.8); y++) {
        for (let x = 2; x < c.width - 2; x++) {
          if (x >= 2 + (n as number) && x < c.width - 2 - (n as number)) {
            continue;
          }
          const q = (y * c.width + x) * 4;
          if (Math.abs(d[q] - 10) + Math.abs(d[q + 1] - 17) + Math.abs(d[q + 2] - 27) > 40) {
            edge++;
          }
        }
      }
      return edge;
    },
    [png, cols]
  );
}
const MANY = 200;
const halves = async (page: Page, el: Locator) => {
  const h = await drawnHalves(page, el);
  return { left: h.left > MANY, right: h.right > MANY };
};

/**
 * The drawn label lies on its block: their centres within a pixel and a bit,
 * and the drawn box holding the bright one, larger by less than a voxel on each
 * side (the rendered block's edge blurs inward as the image is interpolated;
 * a label's voxels have hard edges).
 */
function lies(drawn: Box, bright: Box, voxel: number): boolean {
  const a = centre(drawn);
  const b = centre(bright);
  if (!a || !b || !drawn || !bright) {
    return false;
  }
  const centred =
    Math.abs(a.x - b.x) <= Math.max(1.5, voxel * 0.1) &&
    Math.abs(a.y - b.y) <= Math.max(1.5, voxel * 0.1);
  const holds =
    drawn.x0 <= bright.x0 + 1 &&
    drawn.y0 <= bright.y0 + 1 &&
    drawn.x1 >= bright.x1 - 1 &&
    drawn.y1 >= bright.y1 - 1;
  const snug =
    bright.x0 - drawn.x0 < voxel &&
    bright.y0 - drawn.y0 < voxel &&
    drawn.x1 - bright.x1 < voxel &&
    drawn.y1 - bright.y1 < voxel;
  return centred && holds && snug;
}

/** Whether cornerstone draws the viewport with WebGL ('gpu') or on its CPU path ('cpu'). */
const renderingOf = (page: Page) =>
  page.evaluate(() => {
    const layer = document.querySelector('canvas[data-pacsai-anatomy-layer]');
    const element = layer?.parentElement?.parentElement as HTMLDivElement | null | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (window as any).cornerstone;
    const vp = element && cs?.getEnabledElement(element)?.viewport;
    return vp ? (vp.useCPURendering ? 'cpu' : 'gpu') : null;
  });

/** Cornerstone falls back to its CPU path without WebGL; SwiftShader gives headless Chrome WebGL. */
export const CPU_ARGS = ['--disable-webgl', '--disable-webgl2'];
export const WEBGL_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

/**
 * The test, for one way of drawing: `cpu` (the file launched Chrome without
 * WebGL) or `gpu` (with SwiftShader's WebGL; skipped where the browser still
 * gives none).
 */
export function defineAnatomyTest(want: 'cpu' | 'gpu'): void {
  test('the anatomy layers: read and offered first, listed head to feet, drawn exactly over their structures, named on hover', async ({
    page,
    context,
  }) => {
    const unknown: string[] = [];
    await serveArchiveAndAnatomy(context, unknown);
    // The model in the tab, as before: the grid's 3D cell switched off here (rsAnatomyGrid has it on).
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('pacsai.anatomy3dViewport', 'off');
      } catch (_) {
        /* no storage: the cell stays on, and the 3D steps below say so */
      }
    });
    await openStudy(page, RICH);

    // The anatomy is read (both labelmaps checked) and its tab offered first.
    await expect
      .poll(
        async () =>
          ((await paneState(page))?.anatomy as { labelmaps?: { ready: number } } | null)?.labelmaps
            ?.ready ?? 0
      )
      .toBe(2);
    await expect(pane(page).locator('[role="tab"]').first()).toHaveText('Anatomy (3)');
    await expect(pane(page).locator('[data-rs-tab="anatomy"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // Head to feet, with extents and volumes (voxels x 80 mm³, measurement-eligible structures only):
    // the liver (centred at slice 10) above the kidney (9.5).
    const organs = pane(page).locator('[data-rs-anatomy-task="total"] tr[data-rs-structure]');
    await expect(organs).toHaveCount(2);
    await expect(organs.nth(0).locator('.prs-structure')).toHaveText('Liver');
    await expect(organs.nth(0).locator('[data-rs-extent]')).toHaveText('5 sl');
    await expect(organs.nth(0).locator('[data-rs-volume]')).toHaveText('102 mL');
    await expect(organs.nth(1).locator('.prs-structure')).toHaveText('Left kidney');
    await expect(organs.nth(1).locator('[data-rs-extent]')).toHaveText('10 sl');
    await expect(organs.nth(1).locator('[data-rs-volume]')).toHaveText('51.2 mL');
    const cavities = pane(page).locator('[data-rs-anatomy-task="trunk_cavities"]');
    await expect(cavities.locator('[data-rs-anatomy-task-toggle]')).not.toBeChecked();
    // Unfolded: the abdominal cavity, not measurement eligible, shows its extent and no volume.
    await cavities.locator('.prs-fold').click();
    const cavity = cavities.locator('tr[data-rs-structure]');
    await expect(cavity.locator('.prs-structure')).toHaveText('Abdominal cavity');
    await expect(cavity.locator('[data-rs-extent]')).toHaveText('16 sl');
    await expect(cavity.locator('[data-rs-volume]')).toHaveText('');

    // Research features (1.15): a section of their own behind each row's Research button, marked research use only.
    await organs.nth(0).locator('[data-rs-research-toggle]').click();
    const research = pane(page).locator('[data-rs-research="total/1"]');
    await expect(research.locator('.prs-research-head')).toHaveText(
      'Research features (radiomics_v1) · pyradiomics 3.0.1'
    );
    await expect(research.locator('.prs-research-banner')).toContainText('Research use only');
    await expect(
      research.locator('details[data-rs-research-class="firstorder"] dd').first()
    ).toHaveText('180.3');
    if (process.env.RS_E2E_SHOTS) {
      await pane(page).screenshot({
        path: path.join(__dirname, 'test-results', `anatomy-research-${want}.png`),
      });
    }
    await organs.nth(1).locator('[data-rs-research-toggle]').click();
    await expect(research).toHaveCount(0);
    await expect(
      pane(page).locator('[data-rs-research="total/2"] [data-rs-research-reason]')
    ).toHaveText('Not computed: no radiomics engine is installed in this build.');
    await organs.nth(1).locator('[data-rs-research-toggle]').click();
    await expect(pane(page).locator('[data-rs-research]')).toHaveCount(0);

    // The series is on a viewport, with the layer canvas over it.
    await expect
      .poll(async () => {
        const s = (await paneState(page))?.anatomyOverlay as {
          viewports?: Array<{ anatomy: boolean }>;
        } | null;
        return Boolean(s?.viewports?.some(v => v.anatomy));
      })
      .toBe(true);
    expect(unknown, 'archive requests the test does not serve').toEqual([]);
    const rendering = await renderingOf(page);
    test.info().annotations.push({ type: 'rendering', description: String(rendering) });
    if (want === 'gpu') {
      test.skip(
        rendering !== 'gpu',
        'this browser gives no WebGL, so cornerstone draws on its CPU path'
      );
    } else {
      expect(rendering).toBe('cpu');
    }

    // A click on the liver brings its slice into view: each label lies exactly over its block.
    await organs.nth(0).locator('.prs-structure').click();
    let m: Measured | null = null;
    await expect
      .poll(async () => {
        m = await page.evaluate(measure);
        return Boolean(m?.drawn.left && m?.drawn.right && m?.bright.left && m?.bright.right);
      })
      .toBe(true);
    const at = m as unknown as Measured;
    const voxel = (at.drawn.left!.x1 - at.drawn.left!.x0 + 1) / 16;
    const report = JSON.stringify({ rendering, voxel, drawn: at.drawn, bright: at.bright });
    expect(lies(at.drawn.left, at.bright.left, voxel), report).toBe(true);
    expect(lies(at.drawn.right, at.bright.right, voxel), report).toBe(true);
    // The liver in its own colour (an atlas's reddish brown, 190 104 78), filled; a canvas
    // keeps colours premultiplied, so a translucent pixel reads back within a step or two.
    const c = at.centre.left!;
    expect([c.r, c.g, c.b].map((v, n) => Math.abs(v - [190, 104, 78][n]) <= 3)).toEqual([
      true,
      true,
      true,
    ]);
    expect(c.a).toBeGreaterThan(0);
    if (process.env.RS_E2E_SHOTS) {
      await page.screenshot({
        path: path.join(__dirname, 'test-results', `anatomy-layers-${rendering}.png`),
      });
    }

    // The liver in the spotlight: the kidney at a quarter of its strength, the liver named
    // beside it, the leader ending inside it, the name clear of it.
    const fill = Math.round(0.35 * 255);
    expect(at.centre.right!.a, report).toBe(Math.round(fill * 0.25));
    const name = page.locator('[data-pacsai-anatomy-name]');
    await expect(name).toHaveText('Liver');
    await expect(name).toBeVisible();
    const marks = await page.evaluate(() => {
      const line = document.querySelector('[data-pacsai-anatomy-marks] line');
      const chip = document.querySelector('[data-pacsai-anatomy-name]') as HTMLElement | null;
      return line && chip
        ? {
            end: [Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))],
            chip: {
              x0: chip.offsetLeft,
              y0: chip.offsetTop,
              x1: chip.offsetLeft + chip.offsetWidth,
              y1: chip.offsetTop + chip.offsetHeight,
            },
          }
        : null;
    });
    const liver = at.drawn.left!;
    const marksReport = JSON.stringify({ marks, liver });
    expect(marks, marksReport).not.toBeNull();
    const [ex, ey] = marks!.end;
    expect(
      ex >= liver.x0 && ex <= liver.x1 + 1 && ey >= liver.y0 && ey <= liver.y1 + 1,
      marksReport
    ).toBe(true);
    const c2 = marks!.chip;
    expect(
      c2.x1 <= liver.x0 || c2.x0 > liver.x1 || c2.y1 <= liver.y0 || c2.y0 > liver.y1,
      marksReport
    ).toBe(true);
    // Esc clears it: the name goes, the kidney back to its own strength.
    await page.keyboard.press('Escape');
    await expect(name).toBeHidden();
    await expect
      .poll(async () => (await page.evaluate(measure))?.centre.right?.a ?? null)
      .toBe(fill);
    await expect(organs.nth(0)).toHaveAttribute('aria-selected', 'false');
    // Picked out again, Show all in the layers' row lets it go the same way, the keys staying in
    // the row.
    const showAll = pane(page).locator('.prs-anatomy-controls [data-rs-anatomy-show-all]');
    await expect(showAll).toHaveCount(0);
    await organs.nth(0).locator('.prs-structure').click();
    await expect(name).toBeVisible();
    await expect(showAll).toHaveText('Show all');
    if (process.env.RS_E2E_SHOTS) {
      await pane(page).screenshot({
        path: path.join(__dirname, 'test-results', `anatomy-show-all-${rendering}.png`),
      });
    }
    await showAll.click();
    await expect(name).toBeHidden();
    await expect
      .poll(async () => (await page.evaluate(measure))?.centre.right?.a ?? null)
      .toBe(fill);
    expect(
      ((await paneState(page))?.anatomy as { selected?: unknown } | null)?.selected
    ).toBeNull();
    await expect(showAll).toHaveCount(0);
    await expect(pane(page).locator('[data-rs-anatomy-enabled]')).toBeFocused();

    // Hovering the liver names it.
    const b = at.drawn.left!;
    await page.mouse.move(at.rect.left + (b.x0 + b.x1) / 2, at.rect.top + (b.y0 + b.y1) / 2);
    await expect(page.locator('[data-pacsai-anatomy-tip]')).toHaveText('Liver');

    // The bar's button turns the layers off and on.
    const toggle = pane(page).locator('[data-rs-anatomy-toggle]');
    await toggle.click();
    await expect.poll(async () => (await page.evaluate(measure))?.drawn.left ?? null).toBeNull();
    await toggle.click();
    await expect.poll(async () => Boolean((await page.evaluate(measure))?.drawn.left)).toBe(true);

    // The structures in 3D (1.17's display surfaces), behind the series' 3D button.
    const view3d = async () =>
      ((await paneState(page))?.anatomy3d ?? null) as Record<string, unknown> | null;
    const status3d = pane(page).locator('[data-rs-anatomy-3d-status]');
    const open3d = pane(page).locator('[data-rs-anatomy-3d-open="0"]');
    await expect(open3d).toHaveText('3D');
    await open3d.click();
    if (want === 'cpu') {
      await expect(status3d).toHaveText(
        'The 3D view needs WebGL, which this browser does not give.'
      );
      expect(await view3d()).toMatchObject({ open: true, webgl: false });
      return;
    }
    // Both files read and checked; the organs drawn, the body cavities hidden as their task is.
    await expect
      .poll(view3d)
      .toMatchObject({ open: true, enlarged: false, webgl: true, actors: 3, visibleActors: 2 });
    await expect(status3d).toHaveText('3 structures, 36 triangles');
    expect((await paneState(page))?.anatomy).toMatchObject({
      counts: { surfaceFiles: 2, refusedSurfaces: 0 },
    });
    // From the front, the patient's right on the left: the liver on the left, the kidney on the right.
    const inline = pane(page).locator('[data-rs-anatomy-3d-view]');
    await expect.poll(() => halves(page, inline)).toEqual({ left: true, right: true });
    if (process.env.RS_E2E_SHOTS) {
      await pane(page).screenshot({
        path: path.join(__dirname, 'test-results', 'anatomy-3d-inline.png'),
      });
    }
    // The tab's switches: the kidney off leaves the right half empty; back on.
    const kidneyBox = organs.nth(1).locator('input[type="checkbox"]');
    await kidneyBox.uncheck();
    await expect.poll(view3d).toMatchObject({ visibleActors: 1 });
    await expect.poll(async () => (await drawnHalves(page, inline)).right).toBeLessThan(20);
    await kidneyBox.check();
    await expect.poll(view3d).toMatchObject({ visibleActors: 2 });

    // Enlarged over the images, left of the report column, its keys at once; Esc takes it back.
    await pane(page).locator('[data-rs-anatomy-3d-enlarge]').click();
    const overlay = page.locator('[data-rs-anatomy-3d-overlay]');
    await expect(overlay).toBeVisible();
    await expect(pane(page).locator('[data-rs-anatomy-3d-away]')).toBeVisible();
    await expect
      .poll(view3d)
      .toMatchObject({ enlarged: true, webgl: true, actors: 3, visibleActors: 2 });
    const [ob, pb] = [
      await overlay.boundingBox(),
      await page.locator('[data-pacsai-rs-pane]').boundingBox(),
    ];
    expect(ob!.x + ob!.width).toBeLessThanOrEqual(pb!.x);
    expect(ob!.width).toBeGreaterThan(pb!.width);
    await expect
      .poll(() => halves(page, overlay.locator('[data-rs-anatomy-3d-view]')))
      .toEqual({ left: true, right: true });
    await expect(overlay.locator('[data-rs-anatomy-3d-enlarge]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(pane(page).locator('[data-rs-anatomy-3d="inline"]')).toBeVisible();
    await expect(pane(page).locator('[data-rs-anatomy-3d-enlarge]')).toBeFocused();

    // Enlarged again, the tab's switches reach it: the body cavities shown, see-through.
    await pane(page).locator('[data-rs-anatomy-3d-enlarge]').click();
    await expect(overlay).toBeVisible();
    await cavities.locator('[data-rs-anatomy-task-toggle]').check();
    await expect.poll(view3d).toMatchObject({ enlarged: true, visibleActors: 3 });
    if (process.env.RS_E2E_SHOTS) {
      await page.screenshot({
        path: path.join(__dirname, 'test-results', 'anatomy-3d-enlarged.png'),
      });
    }
    await cavities.locator('[data-rs-anatomy-task-toggle]').uncheck();
    // Its × closes it altogether.
    await overlay.locator('[data-rs-anatomy-3d-close]').click();
    await expect(overlay).toHaveCount(0);
    await expect(pane(page).locator('[data-rs-anatomy-3d]')).toHaveCount(0);
    await expect.poll(view3d).toBeNull();
  });
}

/** The gear menu's item named so, the menu open (tries each header menu, the gear among them). */
async function gearMenuItem(page: Page, name: RegExp): Promise<Locator | null> {
  const triggers = page.locator('button[aria-haspopup="menu"]');
  for (let i = (await triggers.count()) - 1; i >= 0; i--) {
    await triggers.nth(i).click();
    const item = page.getByRole('menuitem', { name });
    if (await item.count()) {
      return item;
    }
    await page.keyboard.press('Escape');
  }
  return null;
}

/**
 * RS-36 (WeiWei, 25 Nov 2026): the 3D model in a cell of the viewer's grid,
 * the gear menu's setting on (the default). With SwiftShader's WebGL; skipped
 * where the browser still gives none.
 */
export function defineAnatomyGridTest(): void {
  test("the 3D anatomy in a cell of the viewer's grid: the protocol's layout grows by one, the 3D button and the gear menu take it out", async ({
    page,
    context,
  }) => {
    const unknown: string[] = [];
    await serveArchiveAndAnatomy(context, unknown);
    await openStudy(page, RICH);
    const grid = async () =>
      ((await paneState(page))?.anatomy3dCell ?? null) as Record<string, unknown> | null;
    const view3d = async () =>
      ((await paneState(page))?.anatomy3d ?? null) as Record<string, unknown> | null;
    await expect
      .poll(async () => {
        const s = (await paneState(page))?.anatomyOverlay as {
          viewports?: Array<{ anatomy: boolean }>;
        } | null;
        return Boolean(s?.viewports?.some(v => v.anatomy));
      })
      .toBe(true);
    const rendering = await renderingOf(page);
    test.skip(rendering !== 'gpu', 'this browser gives no WebGL, so there is no 3D cell');

    // The protocol's one viewport, and the cell beside it once the surfaces are offered.
    await expect.poll(grid).toMatchObject({
      setting: true,
      shown: true,
      out: false,
      fromProtocol: true,
      layout: '1x2',
      panes: 2,
      cellPane: 1,
    });
    const cell = page.locator('[data-rs-anatomy-3d-cell]');
    await expect(cell).toBeVisible();
    await expect
      .poll(view3d)
      .toMatchObject({ open: true, where: 'viewport', webgl: true, actors: 3, visibleActors: 2 });
    await expect(cell.locator('[data-rs-anatomy-3d-status]')).toHaveText(
      '3 structures, 36 triangles'
    );
    await expect(cell.locator('[data-rs-anatomy-3d-enlarge]')).toHaveCount(0);
    // From the front in the cell: the liver on the left, the kidney on the right.
    await expect
      .poll(() => halves(page, cell.locator('[data-rs-anatomy-3d-view]')))
      .toEqual({ left: true, right: true });
    // The cell is narrower than it is tall: the front view fits the model's sides too.
    expect(await drawnEdges(page, cell.locator('[data-rs-anatomy-3d-view] canvas'))).toBe(0);
    // The image keeps its labels beside it.
    const cellBox = await cell.boundingBox();
    const layerBox = await page.locator('canvas[data-pacsai-anatomy-layer]').first().boundingBox();
    expect(layerBox!.x + layerBox!.width).toBeLessThanOrEqual(cellBox!.x + 1);
    if (process.env.RS_E2E_SHOTS) {
      await page.screenshot({ path: path.join(__dirname, 'test-results', 'anatomy-3d-grid.png') });
    }

    // The tab's 3D button works the cell: out (the protocol's 1x1 back), and in again.
    const open3d = pane(page).locator('[data-rs-anatomy-3d-open="0"]');
    await expect(open3d).toHaveAttribute('data-rs-anatomy-3d-grid', '');
    await expect(open3d).toHaveAttribute('aria-pressed', 'true');
    await open3d.click();
    await expect.poll(grid).toMatchObject({ shown: false, out: true, layout: '1x1' });
    await expect(cell).toHaveCount(0);
    await expect(pane(page).locator('[data-rs-anatomy-3d]')).toHaveCount(0);
    await open3d.click();
    await expect.poll(grid).toMatchObject({ shown: true, out: false, layout: '1x2' });
    // The cell's x takes it out too.
    await cell.locator('[data-rs-anatomy-3d-close]').click();
    await expect.poll(grid).toMatchObject({ shown: false, layout: '1x1' });
    await open3d.click();
    await expect.poll(grid).toMatchObject({ shown: true, layout: '1x2' });

    // The gear menu's switch: off, the cell goes and the 3D button opens the model in the tab.
    const off = await gearMenuItem(page, /^3D anatomy in the viewports: On$/);
    expect(off, "the gear menu's 3D anatomy item").not.toBeNull();
    await off!.click();
    await expect.poll(grid).toMatchObject({ setting: false, shown: false, layout: '1x1' });
    await expect(open3d).not.toHaveAttribute('data-rs-anatomy-3d-grid', '');
    await open3d.click();
    await expect(pane(page).locator('[data-rs-anatomy-3d="inline"]')).toBeVisible();
    await open3d.click();
    // On again: the cell back in the protocol's layout.
    const on = await gearMenuItem(page, /^3D anatomy in the viewports: Off$/);
    await on!.click();
    await expect.poll(grid).toMatchObject({ setting: true, shown: true, layout: '1x2' });
    expect(unknown, 'archive requests the test does not serve').toEqual([]);
  });
}
