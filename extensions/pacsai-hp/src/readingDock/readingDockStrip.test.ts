import {
  IMAGES_BOTTOM_VAR,
  createReadingDock,
  isErrorPath,
  isReadingPath,
  type ReadingDock,
} from './readingDock';
import { STRIP_HEIGHT_PX } from './readingStrip';
import type { IslandLoadResult } from './islandLoader';

// Rev 11 milestone 6, approach C (F55): the dock's Images strip, its Sign
// through the island, Review and Show report, the offer's actions on it, and
// a spoken reading mode.

const A = '1.2.840.1.1';
type Opts = Record<string, (arg?: unknown) => unknown> & { studyInstanceUid: string };

function fakeIsland(signAnswer = 'signing') {
  let options: Opts | null = null;
  const handle = {
    api: 'pacsai.reportIsland',
    version: 1,
    setCase: jest.fn(() => ({ ok: true, generation: 2, sameCase: false })),
    setVisibility: jest.fn(),
    setFocus: jest.fn(() => true),
    settle: jest.fn(async () => ({
      studyInstanceUid: A,
      generation: 1,
      state: 'reportable',
      draft: 'saved',
    })),
    unmount: jest.fn(),
    toggleDictation: jest.fn(() => true),
    sign: jest.fn(() => signAnswer),
    lineAction: jest.fn(() => true),
  };
  const module = {
    ISLAND_API: 'pacsai.reportIsland',
    ISLAND_API_VERSION: 1,
    ISLAND_BUILD: 'test',
    mountReportEditor: jest.fn((_el: HTMLElement, o: Opts) => {
      options = o;
      return handle;
    }),
  };
  return { module, handle, options: () => options as Opts };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

let dock: ReadingDock | null = null;
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });
  window.history.replaceState(null, '', '/viewer/viewer/radcopilot?StudyInstanceUIDs=' + A);
});
afterEach(async () => {
  await dock?.destroy();
  jest.runOnlyPendingTimers();
  dock = null;
  jest.useRealTimers();
});

const status = (over: Record<string, unknown> = {}) => ({
  studyInstanceUid: A,
  accession: 'ACC-7',
  exam: 'CT HEAD WO',
  linked: 'linked',
  lastPlaced: 'Small left effusion.',
  sign: 'sign',
  blocker: null,
  line: null,
  ...over,
});
const stripEl = () => document.querySelector('[data-pacsai-reading-strip]') as HTMLElement;
const action = (id: string) =>
  document.querySelector(`[data-pacsai-reading-strip-action="${id}"]`) as HTMLButtonElement | null;
const bottomVar = () => document.documentElement.style.getPropertyValue(IMAGES_BOTTOM_VAR);

async function mounted(signAnswer?: string) {
  const isl = fakeIsland(signAnswer);
  dock = createReadingDock({
    win: window,
    load: async () =>
      ({ ok: true, module: isl.module as never, build: 'test' }) as IslandLoadResult,
    isReadingPath,
    isErrorPath,
  });
  dock.enter(A);
  await flush();
  isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
  isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
  return { isl, d: dock };
}

describe('the Images strip (F55)', () => {
  it('shows only while the report is hidden, under the images, which give it its height', async () => {
    const { isl, d } = await mounted();
    isl.options().onReportStatus(status());
    expect(stripEl().style.display).toBe('none');
    expect(bottomVar()).toBe('0px');
    expect(d.setMode('images')).toBe(true);
    expect(stripEl().style.display).toBe('flex');
    expect(bottomVar()).toBe(`${STRIP_HEIGHT_PX}px`);
    expect(stripEl().style.width).toBe('1920px');
    expect(d.getSnapshot().strip).toEqual({
      shown: true,
      linked: 'linked',
      sign: 'sign',
      blocker: false,
      lastChars: 20,
      line: null,
      actions: ['sign'],
    });
    d.setMode('report');
    expect(stripEl().style.display).toBe('none');
    expect(bottomVar()).toBe('0px');
    d.setMode('both');
    expect(stripEl().style.display).toBe('none');
  });

  it('says Case linked, the case by its accession and exam, the last sentence, and offers Sign', async () => {
    const { isl, d } = await mounted();
    d.setMode('images');
    isl.options().onReportStatus(status());
    const text = stripEl().textContent ?? '';
    expect(text).toContain('Case linked');
    expect(text).toContain('ACC ACC-7 · CT HEAD WO');
    expect(text).toContain('Small left effusion.');
    expect(action('sign')?.disabled).toBe(false);
    expect(
      document
        .querySelector('[data-pacsai-reading-strip-link]')
        ?.getAttribute('data-pacsai-reading-strip-link')
    ).toBe('linked');
  });

  it("Sign is the island's; an island that answers review brings the report back (Both)", async () => {
    const { isl, d } = await mounted('review');
    d.setMode('images');
    isl.options().onReportStatus(status());
    action('sign')?.click();
    expect(isl.handle.sign).toHaveBeenCalledTimes(1);
    expect(d.getSnapshot().mode).toBe('both');
    expect(d.getSnapshot().stripCounts.signs).toBe(1);
  });

  it('Sign that the island takes stays in Images; the strip follows what the island says next', async () => {
    const { isl, d } = await mounted('signing');
    d.setMode('images');
    isl.options().onReportStatus(status());
    action('sign')?.click();
    expect(d.getSnapshot().mode).toBe('images');
    isl.options().onReportStatus(status({ sign: 'signing' }));
    expect(action('sign')?.disabled).toBe(true);
    expect(action('sign')?.textContent).toBe('Signing…');
  });

  it('Review and Show report bring the report back without signing', async () => {
    const { isl, d } = await mounted();
    d.setMode('images');
    isl.options().onReportStatus(status({ sign: 'review' }));
    expect(stripEl().textContent).toContain('Changed since you last saw the report');
    action('review')?.click();
    expect(d.getSnapshot().mode).toBe('both');
    expect(isl.handle.sign).not.toHaveBeenCalled();
    d.setMode('images');
    isl.options().onReportStatus(
      status({
        sign: 'waiting',
        blocker: { text: '2 sentences waiting for placement', fix: 'show' },
      })
    );
    expect(action('sign')?.disabled).toBe(true);
    action('show')?.click();
    expect(d.getSnapshot().mode).toBe('both');
    expect(d.getSnapshot().stripCounts).toMatchObject({ reviews: 1, shows: 1, signs: 0 });
  });

  it('not linked: held, and it says why', async () => {
    const { isl, d } = await mounted();
    d.setMode('images');
    isl.options().onReportStatus(
      status({
        linked: 'not-linked',
        sign: 'held',
        blocker: { text: 'The viewer shows another study than this report', fix: null },
      })
    );
    const text = stripEl().textContent ?? '';
    expect(text).toContain('Not linked');
    expect(text).toContain('another study');
    expect(action('sign')?.disabled).toBe(true);
  });

  it("after Sign the island's offer on the strip, its actions relayed to the island", async () => {
    const { isl, d } = await mounted();
    d.setMode('images');
    isl.options().onReportStatus(
      status({
        sign: 'held',
        line: {
          code: 'NEXT_CASE',
          text: 'Signed. Next: CT CHEST',
          actions: [
            { id: 'open', label: 'Open' },
            { id: 'skip', label: 'Skip' },
          ],
        },
      })
    );
    expect(stripEl().textContent).toContain('Signed. Next: CT CHEST');
    expect(action('sign')).toBeNull();
    action('line:skip')?.click();
    expect(isl.handle.lineAction).toHaveBeenCalledWith('NEXT_CASE', 'skip');
    expect(d.getSnapshot().strip?.line).toBe('NEXT_CASE');
  });

  it('what is not a strip shows nothing; no report text or study in the snapshot', async () => {
    const { isl, d } = await mounted();
    d.setMode('images');
    isl.options().onReportStatus({ ...status(), linked: 'maybe' });
    expect(stripEl().style.display).toBe('none');
    expect(d.getSnapshot().strip).toBeNull();
    isl.options().onReportStatus(status());
    expect(JSON.stringify(d.getSnapshot())).not.toMatch(/effusion|ACC-7|CT HEAD/);
    isl.options().onReportStatus(null);
    expect(stripEl().style.display).toBe('none');
    expect(bottomVar()).toBe('0px');
  });
});

describe('a spoken reading mode (F55)', () => {
  it("switches as the header's buttons do, under the same rules", async () => {
    const isl = fakeIsland();
    dock = createReadingDock({
      win: window,
      load: async () =>
        ({ ok: true, module: isl.module as never, build: 'test' }) as IslandLoadResult,
      isReadingPath,
      isErrorPath,
    });
    dock.enter(A);
    await flush();
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    // Images before the report has told its microphone state: refused, as the button is.
    expect(isl.options().onModeRequest('images')).toBe(false);
    isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    expect(isl.options().onModeRequest('report')).toBe(true);
    expect(dock.getSnapshot().mode).toBe('report');
    expect(isl.options().onModeRequest('images')).toBe(true);
    expect(dock.getSnapshot().mode).toBe('images');
    expect(isl.options().onModeRequest('both')).toBe(true);
    expect(dock.getSnapshot().mode).toBe('both');
    for (const bad of ['split', '', null, 3]) {
      expect(isl.options().onModeRequest(bad)).toBe(false);
    }
    // Every request for a mode is counted, taken or refused; what is not a mode
    // is not. (One more mode, so the snapshot is read after the words that are not.)
    expect(isl.options().onModeRequest('report')).toBe(true);
    expect(dock.getSnapshot().stripCounts.modeRequests).toBe(5);
  });
});
