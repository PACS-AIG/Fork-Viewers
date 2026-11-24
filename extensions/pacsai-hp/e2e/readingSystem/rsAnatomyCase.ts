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
 * layers off and on.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
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

function anatomyJson(study: string) {
  return {
    contractVersion: 'pacsai.reading/1.10',
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
            labels: [
              {
                value: 1,
                concept: 'e2e.liver',
                name: 'liver',
                rawClass: 'liver',
                voxels: count(TOTAL.data, 1),
                measurementEligible: true,
              },
              {
                value: 2,
                concept: 'e2e.kidney',
                name: 'left kidney',
                rawClass: 'kidney_left',
                voxels: count(TOTAL.data, 2),
                measurementEligible: true,
              },
            ],
          },
          {
            task: 'trunk_cavities',
            file: 'anatomy/0.trunk_cavities.labels.nii.gz',
            sha256: CAVITIES.sha256,
            datatype: 'uint8',
            labels: [
              {
                value: 1,
                concept: 'e2e.cavity',
                name: 'abdominal cavity',
                rawClass: 'abdominal_cavity',
                voxels: count(CAVITIES.data, 1),
                measurementEligible: false,
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
      const file =
        m[2] === '0.total.labels.nii.gz'
          ? TOTAL
          : m[2] === '0.trunk_cavities.labels.nii.gz'
            ? CAVITIES
            : null;
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
  centre: { left: { r: number; g: number; b: number; a: number } | null };
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
    centre: { left: null },
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
  const b = out.drawn.left;
  if (b) {
    const cx = Math.round((b.x0 + b.x1) / 2);
    const cy = Math.round((b.y0 + b.y1) / 2);
    const q = (cy * W + cx) * 4;
    out.centre.left = { r: lay[q], g: lay[q + 1], b: lay[q + 2], a: lay[q + 3] };
  }
  return out;
}

const centre = (b: Box) => (b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : null);

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
  });
}
