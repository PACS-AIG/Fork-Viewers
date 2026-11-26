/**
 * RS-38: the refine tool end to end in the viewer, against the reading
 * system's own refine routes in fixture mode (ct-analysis-system's D-347,
 * output contract 1.18). Chrome is launched without WebGL (cornerstone's CPU
 * path, where a mark's points need the half pixel taken off).
 *
 * The study is the fixture `refine` (snapshot fx-refine). Its series is
 * rsAnatomyCase's synthetic CT: 20 axial slices of 64 x 64, 4 mm pixels, 5 mm
 * apart. The archive serves it through this test's routes, as for the anatomy
 * tests. Its one candidate, "liver", is outlined as the bright block (slices 8
 * to 12, rows 20 to 35, columns 8 to 23). The fixture SAM2CT answers any mark
 * with the block grown by one voxel in plane (1,620 voxels on 5 slices).
 * Everything else, including refine_targets, POST /segment and the keep (an
 * accept of the attempt's proposal), is the served API's.
 *
 * What it checks:
 * - the toolbar's Refine outline button arms the tool;
 * - a box drawn around the lesion on its slice sends one refine naming the
 *   lesion's revisions as the targets give them, with the box put exactly on
 *   the slice;
 * - SAM2CT's outline is drawn over the lesion beside the current one, and the
 *   bar offers Keep;
 * - Keep accepts the attempt, and the targets read again show outline
 *   revision 2;
 * - a click sends one positive point, and Discard rejects that attempt;
 * - a mark far from the lesion names nothing;
 * - the server's stale (409) and refused (422) answers to /segment, provoked by
 *   altering one request in flight, are said;
 * - a keep against a published revision that moved is sent again and kept;
 * - nothing becomes a measurement, and another tool disarms it.
 */
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import {
  CPU_ARGS,
  FRAME_OF_REFERENCE,
  PIXEL_MM,
  SERIES,
  ipp,
  renderingOf,
  serveArchiveAndAnatomy,
} from './rsAnatomyCase';
import { doc, expectOpened, openStudy, pane, paneState } from './rsE2e';

test.use({ launchOptions: { args: CPU_ARGS } });

const FIXTURE = 'refine';
/** The block's middle slice. */
const K = 10;
/** The fixture SAM2CT's outline: the block grown by one voxel in plane, slices 8 to 12. */
const SAM2CT_VOXELS = 1620;

/** Image pixel (u, v) on slice k, LPS mm. */
const worldOf = (u: number, v: number, k: number): [number, number, number] => {
  const p = ipp(k);
  return [p[0] + u * PIXEL_MM, p[1] + v * PIXEL_MM, p[2]];
};

interface SentRefine extends Record<string, unknown> {
  prompt: { type: string; world_mm: number[][]; polarity?: string[]; frameOfReferenceUID: string };
  base_mask_revision: number | null;
}

interface Traffic {
  segments: SentRefine[];
  events: Array<{ event: { type: string; target?: { kind: string; id: string } } }>;
  /** Alter the next refine's body before it goes (to provoke the server's 409 or 422). */
  alterSegment: ((body: Record<string, unknown>) => Record<string, unknown>) | null;
  /** Alter the next keep's (an accept's) body before it goes. */
  alterKeep: ((body: Record<string, unknown>) => Record<string, unknown>) | null;
}

async function watchTraffic(context: BrowserContext, t: Traffic) {
  await context.route(
    url => url.pathname === '/rs-api/segment',
    (route: Route) => {
      const body = route.request().postDataJSON();
      t.segments.push(body);
      const alter = t.alterSegment;
      t.alterSegment = null;
      return alter ? route.continue({ postData: JSON.stringify(alter(body)) }) : route.fallback();
    }
  );
  await context.route(
    url => url.pathname === '/rs-api/events',
    (route: Route) => {
      const body = route.request().postDataJSON();
      t.events.push(body);
      const alter =
        body?.event?.type === 'accept' && body?.event?.target?.kind === 'proposal'
          ? t.alterKeep
          : null;
      if (alter) {
        t.alterKeep = null;
        return route.continue({ postData: JSON.stringify(alter(body)) });
      }
      return route.fallback();
    }
  );
}

type Refine = {
  armed?: boolean;
  phase?: string;
  targetsState?: string;
  keepPossible?: boolean | null;
  target?: { label: string; maskRevision: number | null } | null;
};
const refineState = async (page: Page): Promise<Refine> =>
  ((await paneState(page))?.refine as Refine | null) ?? {};
const phase = async (page: Page) => (await refineState(page)).phase;

/** The synthetic series' stack viewport shows slice k. */
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

/** Image pixel (u, v) on slice K: where it is on the page. */
async function pageAt(page: Page, u: number, v: number): Promise<{ x: number; y: number }> {
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
    [SERIES, worldOf(u, v, K)] as const
  );
  expect(p, 'the synthetic series is on a viewport').not.toBeNull();
  return p as { x: number; y: number };
}

async function box(page: Page, from: [number, number], to: [number, number]) {
  const a = await pageAt(page, from[0], from[1]);
  const b = await pageAt(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function click(page: Page, u: number, v: number) {
  const p = await pageAt(page, u, v);
  await page.mouse.click(p.x, p.y);
}

/**
 * SAM2CT's outline on the refine layer: its yellow pixels' box, and where the
 * outline's voxel edges are on that canvas (CSS px). `edges` are the outline's
 * first and last column and row, in image pixels.
 */
function previewBox(edges: { u0: number; u1: number; v0: number; v1: number; k: number }) {
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
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      const p = (y * layer.width + x) * 4;
      if (data[p + 3] > 0 && data[p] === 255 && data[p + 1] === 216 && data[p + 2] === 77) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) {
    return null;
  }
  // Image pixel (u, v)'s centre on the canvas (on the CPU path, half a pixel past its world).
  const shift = vp.useCPURendering ? 2 : 0;
  const at = (u: number, v: number) =>
    vp.worldToCanvas([-128 + 4 * u + shift, -128 + 4 * v + shift, -50 + 5 * edges.k]);
  const a = at(edges.u0 - 0.5, edges.v0 - 0.5);
  const b = at(edges.u1 + 0.5, edges.v1 + 0.5);
  const one = Math.abs(at(1, 0)[0] - at(0, 0)[0]);
  return {
    drawn: { x0, y0, x1, y1 },
    expected: { x0: a[0], y0: a[1], x1: b[0], y1: b[1] },
    voxelPx: one,
  };
}

const status = (page: Page) => page.locator('[data-rs-refine-bar] [role="status"]');

test('the refine tool, against the served refine routes: mark a lesion, see SAM2CT’s outline, keep it', async ({
  page,
  context,
  request,
}) => {
  const unknown: string[] = [];
  await serveArchiveAndAnatomy(context, unknown);
  const traffic: Traffic = { segments: [], events: [], alterSegment: null, alterKeep: null };
  await watchTraffic(context, traffic);
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('pacsai.anatomy3dViewport', 'off');
    } catch (_) {
      /* no storage */
    }
  });
  await openStudy(page, FIXTURE);
  await expectOpened(request, FIXTURE);
  await expect.poll(async () => (await refineState(page)).targetsState).toBe('ready');
  expect(await renderingOf(page).catch(() => null)).not.toBe('gpu');
  await onSlice(page, K);
  const measurements = () =>
    page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).services?.measurementService?.getMeasurements?.()?.length ?? 0
    );
  const before = await measurements();
  type Targets = {
    targets: Array<{
      observationId: string;
      seriesRevision: number;
      observationRevision: number;
      maskRevision: number | null;
      label: string;
      recipeId: string;
      task: string;
    }>;
  };
  const served = await doc<Targets>(request, FIXTURE, 'refine_targets');
  expect(served.targets).toHaveLength(1);
  const lesion = served.targets[0];
  expect(lesion).toMatchObject({ label: 'liver', maskRevision: 1, recipeId: 'sam2ct@pinned' });

  // The button arms the tool.
  const button = page.locator('[data-cy="PacsaiRefine"]');
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(async () => (await refineState(page)).armed).toBe(true);

  // A box around the lesion on its slice: one refine naming it as the targets give it, on the slice.
  await box(page, [6, 18], [25, 37]);
  await expect.poll(() => phase(page)).toBe('preview');
  expect(traffic.segments).toHaveLength(1);
  const sent = traffic.segments[0];
  expect(sent).toMatchObject({
    mode: 'refine',
    seriesRef: SERIES,
    series_revision: lesion.seriesRevision,
    parent_observation_id: lesion.observationId,
    parent_observation_revision: lesion.observationRevision,
    base_mask_revision: 1,
    recipe_id: lesion.recipeId,
    task: lesion.task,
    budget: { max_passes: 1, timeout_s: 45 },
    reader: { role: 'radiologist' },
    prompt: { type: 'box', frameOfReferenceUID: FRAME_OF_REFERENCE },
  });
  expect(sent).not.toHaveProperty('trigger');
  expect(sent).not.toHaveProperty('alternative');
  const corners = sent.prompt.world_mm;
  expect(corners).toHaveLength(2);
  for (const c of corners) {
    expect(c[2]).toBeCloseTo(ipp(K)[2], 6);
  }
  // In plane, within a pixel of where it was drawn (the CPU path's half pixel taken off).
  const xs = corners.map(c => c[0]).sort((p, q) => p - q);
  expect(Math.abs(xs[0] - worldOf(6, 0, K)[0])).toBeLessThanOrEqual(PIXEL_MM);
  expect(Math.abs(xs[1] - worldOf(25, 0, K)[0])).toBeLessThanOrEqual(PIXEL_MM);

  // SAM2CT's outline is drawn over the lesion beside the current one; the bar offers Keep.
  await expect(page.locator('[data-rs-refine-bar]')).toHaveAttribute(
    'data-rs-refine-bar',
    'preview'
  );
  await expect(status(page)).toHaveText(
    `SAM2CT’s outline: ${SAM2CT_VOXELS} voxels on 5 slices. The current one.`
  );
  expect((await refineState(page)).keepPossible).toBe(true);
  await expect
    .poll(async () => {
      const o = (await paneState(page))?.refineOverlay as {
        viewports?: Array<{ preview: boolean; outlines: number }>;
      } | null;
      return Boolean(o?.viewports?.some(v => v.preview && v.outlines === 1));
    })
    .toBe(true);
  // Its edges lie on the outline's voxels (columns 7 to 24, rows 19 to 36), within a pixel and its width.
  const drawn = await page.evaluate(previewBox, { u0: 7, u1: 24, v0: 19, v1: 36, k: K });
  expect(drawn, 'SAM2CT’s outline on the refine layer').not.toBeNull();
  const near = (got: number, want: number) =>
    expect(Math.abs(got - want), JSON.stringify(drawn)).toBeLessThanOrEqual(3);
  near(drawn!.drawn.x0, drawn!.expected.x0);
  near(drawn!.drawn.y0, drawn!.expected.y0);
  near(drawn!.drawn.x1, drawn!.expected.x1);
  near(drawn!.drawn.y1, drawn!.expected.y1);

  // Keep: the attempt is accepted, and the targets read again hold outline revision 2.
  const bar = page.locator('[data-rs-refine-bar]');
  await bar.getByRole('button', { name: 'Keep' }).click();
  await expect.poll(() => phase(page)).toBe('kept');
  const accept = traffic.events.filter(e => e.event.type === 'accept');
  expect(accept).toHaveLength(1);
  expect(accept[0].event.target).toMatchObject({ kind: 'proposal' });
  expect(accept[0].event.target?.id).toMatch(/^refine-[0-9a-f]{20}$/);
  await expect(status(page)).toHaveText('Kept: the liver’s outline is the new one.');
  expect((await refineState(page)).target?.maskRevision).toBe(2);
  expect((await doc<Targets>(request, FIXTURE, 'refine_targets')).targets[0].maskRevision).toBe(2);
  await expect(pane(page)).toContainText('Kept the new outline');

  // A click inside the lesion: one positive point against revision 2; Discard rejects that attempt.
  await click(page, 15, 27);
  await expect.poll(() => phase(page)).toBe('preview');
  expect(traffic.segments[1].prompt).toMatchObject({ type: 'point', polarity: ['positive'] });
  expect(traffic.segments[1].base_mask_revision).toBe(2);
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => phase(page)).toBe('idle');
  await expect.poll(() => traffic.events.filter(e => e.event.type === 'reject').length).toBe(1);
  expect(traffic.events.find(e => e.event.type === 'reject')?.event.target?.kind).toBe('proposal');
  await expect(page.locator('[data-rs-refine-bar]')).toHaveCount(0);

  // Far from the lesion: nothing is sent, and the bar says why.
  await click(page, 50, 8);
  await expect.poll(() => phase(page)).toBe('missed');
  await expect(status(page)).toHaveText('No lesion the system found is here.');
  expect(traffic.segments).toHaveLength(2);

  // The server's stale answer (the request altered to name outline revision 7): said, and the targets read again.
  traffic.alterSegment = body => ({ ...body, base_mask_revision: 7 });
  await box(page, [6, 18], [25, 37]);
  await expect.poll(() => phase(page)).toBe('answered');
  await expect(status(page)).toContainText('changed since this page read it');
  // Its refused answer (a frame of reference that is not the series').
  traffic.alterSegment = body => ({
    ...body,
    prompt: { ...(body.prompt as Record<string, unknown>), frameOfReferenceUID: '2.25.999' },
  });
  await box(page, [6, 18], [25, 37]);
  await expect(status(page)).toHaveText(/^Not refined: .+\.$/);

  // A keep made against a published revision that moved (altered in flight) is answered 409, then sent again and kept.
  await box(page, [6, 18], [25, 37]);
  await expect.poll(() => phase(page)).toBe('preview');
  traffic.alterKeep = body => ({
    ...body,
    baseRevision: 0,
    capture: { ...(body.capture as Record<string, unknown>), reportRevision: 0 },
  });
  await bar.getByRole('button', { name: 'Keep' }).click();
  await expect.poll(() => phase(page)).toBe('kept');
  expect(traffic.events.filter(e => e.event.type === 'accept')).toHaveLength(3);
  expect((await refineState(page)).target?.maskRevision).toBe(3);

  // Nothing the tool did became a measurement, and another tool disarms it.
  expect(await measurements()).toBe(before);
  await page.locator('[data-cy="WindowLevel"]').click();
  await expect.poll(async () => (await refineState(page)).armed).toBe(false);
  expect(unknown, 'archive requests the test does not serve').toEqual([]);
});
