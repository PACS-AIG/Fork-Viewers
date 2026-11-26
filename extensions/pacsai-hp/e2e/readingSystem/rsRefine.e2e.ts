/**
 * RS-38: the refine tool end to end in the viewer, Chrome launched without
 * WebGL (cornerstone's CPU path, where a mark's points need the half pixel
 * taken off).
 *
 * The archive is rsAnatomyCase's synthetic CT (20 axial slices of 64 x 64, 4 mm
 * pixels, 5 mm apart, its grid stored with the rows flipped). The study's
 * refine targets, POST /segment and the keep (a `refine_keep` event) are this
 * test's own: one made-up liver lesion on slice 10, and SAM2CT's answer a
 * larger disc on slices 10 and 11. Until ct-analysis-system serves them in
 * fixture mode (the refine plan's step 1), these routes stand in for it; every
 * other route is the served API's, as in the other tests.
 *
 * What it checks: the toolbar's Refine outline button arms the tool; a box
 * drawn around the lesion on its slice sends one refine naming the lesion's
 * revisions, with the box put exactly on the slice; SAM2CT's outline is drawn
 * over the lesion beside the current one, with the bar's Keep / Discard /
 * Try again; Keep sends the keep and reads the targets again; a click sends
 * one positive point; a mark far from the lesion names nothing; a stale or
 * refused answer is said; and nothing becomes a measurement.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { packBox } from '../../src/readingSystem/refine/refineTestData';
import {
  AFFINE,
  CPU_ARGS,
  FRAME_OF_REFERENCE,
  PIXEL_MM,
  RICH,
  SERIES,
  SIZE,
  SLICES,
  ipp,
  renderingOf,
  serveArchiveAndAnatomy,
} from './rsAnatomyCase';
import { openStudy, paneState } from './rsE2e';

test.use({ launchOptions: { args: CPU_ARGS } });

/** The liver's middle slice, where the lesion is. */
const K = 10;
type Index = [number, number, number];

/** Grid index (slice, row, column) of image pixel (u, v) on slice k: the grid stores the rows flipped. */
const indexOf = (u: number, v: number, k: number): Index => [k, SIZE - 1 - v, u];
/** Image pixel (u, v) on slice k, LPS mm. */
const worldOf = (u: number, v: number, k: number): [number, number, number] => {
  const p = ipp(k);
  return [p[0] + u * PIXEL_MM, p[1] + v * PIXEL_MM, p[2]];
};

function discVoxels(u0: number, v0: number, radius: number, slices: number[]): Index[] {
  const out: Index[] = [];
  for (const k of slices) {
    for (let v = v0 - radius; v <= v0 + radius; v++) {
      for (let u = u0 - radius; u <= u0 + radius; u++) {
        if ((u - u0) ** 2 + (v - v0) ** 2 <= radius * radius) {
          out.push(indexOf(u, v, k));
        }
      }
    }
  }
  return out;
}

function maskJson(voxels: Index[], digest: string) {
  const lo: Index = [0, 1, 2].map(a => Math.min(...voxels.map(x => x[a]))) as Index;
  const hi: Index = [0, 1, 2].map(a => Math.max(...voxels.map(x => x[a])) + 1) as Index;
  return { box: [lo, hi], bits: packBox(lo, hi, voxels), digest, voxels: voxels.length };
}

const CURRENT = discVoxels(15, 27, 3, [K]);
const SAM2CT = discVoxels(15, 27, 4, [K, K + 1]);

const targetJson = (maskRevision: number, voxels: Index[]) => ({
  observationId: 'obs-e2e-1',
  findingId: 'finding-e2e-1',
  entryId: null,
  kind: 'candidate',
  label: 'liver lesion',
  seriesRef: SERIES,
  seriesUID: SERIES,
  frameOfReferenceUID: FRAME_OF_REFERENCE,
  grid: { shape: [SLICES, SIZE, SIZE], affineRAS: AFFINE },
  seriesRevision: 1,
  observationRevision: 1,
  maskRevision,
  mask: maskJson(voxels, `digest-${maskRevision}`),
  geometry: null,
  task: 'hepatic_lesion_boundary',
  recipeId: 'sam2ct@pinned',
  promptTypes: ['line', 'arrow', 'box', 'point'],
});

interface SentRefine extends Record<string, unknown> {
  prompt: { type: string; world_mm: number[][]; polarity?: string[] };
  base_mask_revision: number | null;
}

interface Routes {
  targetsReads: number;
  segments: SentRefine[];
  keeps: Array<Record<string, unknown>>;
  answer: 'ok' | 'stale' | 'refused';
  kept: boolean;
}

const asJson = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });

async function serveRefine(context: BrowserContext, s: Routes) {
  await context.route(
    url => /^\/rs-api\/studies\/[^/]+\/refine_targets$/.test(url.pathname),
    route => {
      s.targetsReads++;
      return route.fulfill({
        status: 200,
        ...asJson({
          contractVersion: 'pacsai.reading/1.18',
          artifact: 'refine_targets',
          snapshotId: null,
          studyUID: 'e2e',
          bundleHash: 'e2e',
          mode: 'fixture',
          targets: [s.kept ? targetJson(2, SAM2CT) : targetJson(1, CURRENT)],
        }),
      });
    }
  );
  await context.route(
    url => url.pathname === '/rs-api/segment',
    route => {
      s.segments.push(route.request().postDataJSON());
      if (s.answer === 'stale') {
        return route.fulfill({
          status: 409,
          ...asJson({
            status: 'stale',
            reason: 'the mask revision moved',
            current: { mask_revision: 2 },
          }),
        });
      }
      if (s.answer === 'refused') {
        return route.fulfill({
          status: 422,
          ...asJson({ status: 'refused', reason: 'sam2ct@pinned takes a box on one slice' }),
        });
      }
      return route.fulfill({
        status: 200,
        ...asJson({
          result: {
            status: 'ok',
            reasons: [],
            mask_revision: 2,
            qc: {
              truncated_at: [],
              truncated_at_crop: false,
              truncated_at_volume_edge: false,
              slices: 2,
              partial_volume: false,
              components: 1,
              failures: [],
              passed: true,
            },
            timing: { started_s: 0, runtime_s: 1.2, passes: 1 },
          },
          mask: { shape: [SLICES, SIZE, SIZE], ...maskJson(SAM2CT, 'digest-2') },
          resultId: 'attempt-e2e-1',
        }),
      });
    }
  );
  await context.route(
    url => url.pathname === '/rs-api/events',
    route => {
      const body = route.request().postDataJSON();
      if (body?.event?.type !== 'refine_keep') {
        return route.fallback();
      }
      s.keeps.push(body.event);
      s.kept = true;
      return route.fulfill({
        status: 200,
        ...asJson({
          contractVersion: body.contractVersion,
          artifact: 'intake_response',
          eventId: body.eventId,
          studyUID: body.studyUID,
          status: 'applied',
          httpStatus: 200,
          revision: 1,
        }),
      });
    }
  );
}

type Refine = {
  armed?: boolean;
  phase?: string;
  targetsState?: string;
  message?: string | null;
  target?: { label: string } | null;
  counts?: Record<string, number>;
};
const refineState = async (page: Page): Promise<Refine> =>
  ((await paneState(page))?.refine as Refine | null) ?? {};
const phase = async (page: Page) => (await refineState(page)).phase;

/** The synthetic series' stack viewport: shows slice k, and gives image pixel (u, v)'s place on the page. */
async function onSlice(page: Page, k: number): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        ([series, z]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cs = (window as any).cornerstone;
          for (const engine of cs?.getRenderingEngines?.() ?? []) {
            for (const vp of engine.getViewports()) {
              const ids: string[] = vp.getImageIds?.() ?? [];
              const shown = vp.getCurrentImageId?.();
              if (typeof vp.setImageIdIndex !== 'function' || !shown) {
                continue;
              }
              if (cs.metaData.get('generalSeriesModule', shown)?.seriesInstanceUID !== series) {
                continue;
              }
              const at = ids.findIndex(
                id =>
                  Math.abs(cs.metaData.get('imagePlaneModule', id)?.imagePositionPatient?.[2] - z) <
                  1e-3
              );
              if (at < 0) {
                return false;
              }
              if (vp.getCurrentImageIdIndex() !== at) {
                vp.setImageIdIndex(at);
                return false;
              }
              return true;
            }
          }
          return false;
        },
        [SERIES, ipp(k)[2]] as const
      )
    )
    .toBe(true);
}

async function pageAt(
  page: Page,
  u: number,
  v: number,
  k: number
): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(
    ([series, world]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cs = (window as any).cornerstone;
      for (const engine of cs.getRenderingEngines() ?? []) {
        for (const vp of engine.getViewports()) {
          const shown = vp.getCurrentImageId?.();
          if (
            !shown ||
            cs.metaData.get('generalSeriesModule', shown)?.seriesInstanceUID !== series
          ) {
            continue;
          }
          const c = vp.worldToCanvas(world);
          const r = vp.element.getBoundingClientRect();
          return { x: r.left + c[0], y: r.top + c[1] };
        }
      }
      return null;
    },
    [SERIES, worldOf(u, v, k)] as const
  );
  expect(p, 'the synthetic series is on a viewport').not.toBeNull();
  return p as { x: number; y: number };
}

async function box(page: Page, from: [number, number], to: [number, number]) {
  const a = await pageAt(page, from[0], from[1], K);
  const b = await pageAt(page, to[0], to[1], K);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function click(page: Page, u: number, v: number) {
  const p = await pageAt(page, u, v, K);
  await page.mouse.click(p.x, p.y);
}

/** SAM2CT's outline on the refine layer: its yellow pixels' centre, and the lesion centre's place there (CSS px). */
function previewCentre(world: number[]) {
  const layer = document.querySelector(
    'canvas[data-pacsai-refine-layer]'
  ) as HTMLCanvasElement | null;
  const element = layer?.parentElement?.parentElement as HTMLDivElement | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cs = (window as any).cornerstone;
  const vp = element && cs?.getEnabledElement(element)?.viewport;
  if (!layer || !vp) {
    return null;
  }
  const { data } = layer.getContext('2d')!.getImageData(0, 0, layer.width, layer.height);
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      const p = (y * layer.width + x) * 4;
      if (data[p + 3] > 0 && data[p] === 255 && data[p + 1] === 216 && data[p + 2] === 77) {
        n++;
        sx += x;
        sy += y;
      }
    }
  }
  // Where the image shows the lesion's centre (on the CPU path, half a pixel past its world).
  const shift = vp.useCPURendering ? [2, 2, 0] : [0, 0, 0];
  const c = vp.worldToCanvas([world[0] + shift[0], world[1] + shift[1], world[2]]);
  const one = vp.worldToCanvas([world[0] + shift[0] + 4, world[1] + shift[1], world[2]]);
  return n
    ? { n, x: sx / n, y: sy / n, expected: { x: c[0], y: c[1] }, voxelPx: Math.abs(one[0] - c[0]) }
    : null;
}

test('the refine tool: mark a lesion, see SAM2CT’s outline, keep it', async ({ page, context }) => {
  const unknown: string[] = [];
  await serveArchiveAndAnatomy(context, unknown);
  const routes: Routes = { targetsReads: 0, segments: [], keeps: [], answer: 'ok', kept: false };
  await serveRefine(context, routes);
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('pacsai.anatomy3dViewport', 'off');
    } catch (_) {
      /* no storage */
    }
  });
  await openStudy(page, RICH);
  await expect.poll(async () => (await refineState(page)).targetsState).toBe('ready');
  expect(await renderingOf(page).catch(() => null)).not.toBe('gpu');
  await onSlice(page, K);
  const measurements = () =>
    page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).services?.measurementService?.getMeasurements?.()?.length ?? 0
    );
  const before = await measurements();

  // The button arms the tool.
  const button = page.locator('[data-cy="PacsaiRefine"]');
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(async () => (await refineState(page)).armed).toBe(true);

  // A box around the lesion on its slice: one refine, naming the lesion, on the slice.
  await box(page, [9, 21], [21, 33]);
  await expect.poll(() => phase(page)).toBe('preview');
  expect(routes.segments).toHaveLength(1);
  const sent = routes.segments[0];
  expect(sent).toMatchObject({
    mode: 'refine',
    seriesRef: SERIES,
    series_revision: 1,
    parent_observation_id: 'obs-e2e-1',
    parent_observation_revision: 1,
    base_mask_revision: 1,
    recipe_id: 'sam2ct@pinned',
    task: 'hepatic_lesion_boundary',
    alternative: false,
    budget: { max_passes: 1, timeout_s: 45 },
    reader: { role: 'radiologist' },
    prompt: { type: 'box', frameOfReferenceUID: FRAME_OF_REFERENCE },
  });
  expect(sent).not.toHaveProperty('trigger');
  const corners = sent.prompt.world_mm;
  expect(corners).toHaveLength(2);
  for (const c of corners) {
    expect(c[2]).toBeCloseTo(ipp(K)[2], 6);
  }
  // In plane, within a pixel of where it was drawn (the CPU path's half pixel taken off).
  const xs = corners.map(c => c[0]).sort((p, q) => p - q);
  expect(Math.abs(xs[0] - worldOf(9, 0, K)[0])).toBeLessThanOrEqual(PIXEL_MM);
  expect(Math.abs(xs[1] - worldOf(21, 0, K)[0])).toBeLessThanOrEqual(PIXEL_MM);

  // SAM2CT's outline is drawn over the lesion, beside the current one; the bar offers Keep.
  const bar = page.locator('[data-rs-refine-bar]');
  await expect(bar).toHaveAttribute('data-rs-refine-bar', 'preview');
  await expect(bar.locator('[role="status"]')).toHaveText(
    `SAM2CT’s outline: ${SAM2CT.length} voxels on 2 slices. The current one.`
  );
  await expect
    .poll(async () => {
      const o = (await paneState(page))?.refineOverlay as {
        viewports?: Array<{ preview: boolean; outlines: number }>;
      } | null;
      return Boolean(o?.viewports?.some(v => v.preview && v.outlines === 1));
    })
    .toBe(true);
  const drawn = await page.evaluate(previewCentre, worldOf(15, 27, K));
  expect(drawn, 'SAM2CT’s outline on the refine layer').not.toBeNull();
  expect(Math.abs(drawn!.x - drawn!.expected.x)).toBeLessThanOrEqual(drawn!.voxelPx);
  expect(Math.abs(drawn!.y - drawn!.expected.y)).toBeLessThanOrEqual(drawn!.voxelPx);

  // Keep: the keep goes as a refine_keep event, then the targets are read again.
  const readsBefore = routes.targetsReads;
  await bar.getByRole('button', { name: 'Keep' }).click();
  await expect.poll(() => phase(page)).toBe('kept');
  expect(routes.keeps).toEqual([
    { type: 'refine_keep', resultId: 'attempt-e2e-1', observationId: 'obs-e2e-1', maskRevision: 2 },
  ]);
  expect(routes.targetsReads).toBeGreaterThan(readsBefore);
  await expect(bar.locator('[role="status"]')).toHaveText(
    'Kept: the liver lesion’s outline is the new one.'
  );

  // A click inside the lesion: one positive point.
  await click(page, 15, 27);
  await expect.poll(() => phase(page)).toBe('preview');
  expect(routes.segments[1].prompt).toMatchObject({ type: 'point', polarity: ['positive'] });
  expect(routes.segments[1].base_mask_revision).toBe(2);
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => phase(page)).toBe('idle');
  await expect(page.locator('[data-rs-refine-bar]')).toHaveCount(0);

  // Far from the lesion: nothing is sent, and the bar says why.
  await click(page, 50, 12);
  await expect.poll(() => phase(page)).toBe('missed');
  await expect(page.locator('[data-rs-refine-bar="missed"] [role="status"]')).toHaveText(
    'No lesion the system found is here.'
  );
  expect(routes.segments).toHaveLength(2);

  // A stale answer reads the targets again and asks for a new mark; a refused one says why.
  routes.answer = 'stale';
  const readsAtStale = routes.targetsReads;
  await box(page, [9, 21], [21, 33]);
  await expect.poll(() => phase(page)).toBe('answered');
  await expect(page.locator('[data-rs-refine-bar] [role="status"]')).toContainText(
    'changed since this page read it'
  );
  await expect.poll(() => routes.targetsReads).toBeGreaterThan(readsAtStale);
  routes.answer = 'refused';
  await box(page, [9, 21], [21, 33]);
  await expect(page.locator('[data-rs-refine-bar] [role="status"]')).toHaveText(
    'Not refined: sam2ct@pinned takes a box on one slice.'
  );

  // Nothing the tool did became a measurement, and another tool disarms it.
  expect(await measurements()).toBe(before);
  await page.locator('[data-cy="WindowLevel"]').click();
  await expect.poll(async () => (await refineState(page)).armed).toBe(false);
  expect(unknown, 'archive requests the test does not serve').toEqual([]);
});
