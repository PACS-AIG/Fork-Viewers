import { studyRefFor } from '@ohif/core/src/utils/attempt/attemptTrace';
import {
  IMAGES_WIDTH_VAR,
  createReadingDock,
  isErrorPath,
  isReadingPath,
  onParkedChange,
  type ReadingDock,
} from './readingDock';
import type { IslandLoadResult } from './islandLoader';

const A = '1.2.840.1.1';
const B = '1.2.840.1.2';

type Opts = Record<string, (arg?: unknown) => void> & { studyInstanceUid: string };

function fakeIsland({ firstAnswers = [] as Array<Record<string, unknown>> } = {}) {
  let generation = 1;
  let options: Opts | null = null;
  const answers = [...firstAnswers];
  const handle = {
    api: 'pacsai.reportIsland',
    version: 1,
    setCase: jest.fn(() => answers.shift() ?? { ok: true, generation: ++generation, sameCase: false }),
    setVisibility: jest.fn(),
    setFocus: jest.fn(() => true),
    settle: jest.fn(async () => ({ studyInstanceUid: A, generation, state: 'reportable', draft: 'saved' })),
    unmount: jest.fn(),
    toggleDictation: jest.fn(() => true),
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
  return {
    module,
    handle,
    options: () => options as Opts,
    gen: () => generation,
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

function setPath(path: string) {
  window.history.replaceState(null, '', path);
}

let dock: ReadingDock | null = null;
function makeDock(load: () => Promise<IslandLoadResult>) {
  dock = createReadingDock({ win: window, load, isReadingPath, isErrorPath });
  return dock;
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });
  setPath('/viewer/viewer/radcopilot?StudyInstanceUIDs=' + A);
});
afterEach(async () => {
  await dock?.destroy();
  jest.runOnlyPendingTimers();
  dock = null;
  jest.useRealTimers();
});

const column = () => document.querySelector('[data-pacsai-reading-column]') as HTMLElement | null;
const cover = () => document.querySelector('[data-pacsai-reading-cover]') as HTMLElement;

describe('the reading dock', () => {
  it('mounts the island once, on the route entry, in a column outside the React root', async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    d.enter(A);
    await flush();
    expect(isl.module.mountReportEditor).toHaveBeenCalledTimes(1);
    expect(isl.options().studyInstanceUid).toBe(A);
    expect(isl.options().paneLayout).toBe(true);
    expect(column()?.parentElement).toBe(document.body);
    // The Tab order follows the screen: the divider before the report.
    const divider = document.querySelector('[data-pacsai-reading-divider]') as HTMLElement;
    expect(divider.compareDocumentPosition(column() as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[data-pacsai-reading-island]')).toBe(
      isl.module.mountReportEditor.mock.calls[0][0]
    );
    expect(d.getSnapshot()).toMatchObject({ phase: 'mounted', covered: true, mode: 'both' });
    expect(document.documentElement.style.getPropertyValue(IMAGES_WIDTH_VAR)).toBe(`${1912 - Math.round(1912 * 0.4)}px`);
  });

  it("holds the cover until the island is ready on the route's study", async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    expect(cover().style.display).toBe('flex');
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    expect(d.getSnapshot().covered).toBe(false);
    expect(cover().style.display).toBe('none');
    expect(d.getSnapshot().islandCase).toEqual({ studyRef: studyRefFor(A), generation: 1, state: 'reportable' });
  });

  it('an in-document switch is setCase, covered until B is ready (a late A never uncovers it)', async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    setPath('/viewer/viewer/radcopilot?StudyInstanceUIDs=' + B);
    d.enter(B);
    d.routeLeft(); // the previous run's onModeExit
    jest.runOnlyPendingTimers();
    expect(isl.handle.setCase).toHaveBeenCalledWith(B, undefined);
    expect(isl.module.mountReportEditor).toHaveBeenCalledTimes(1);
    expect(isl.handle.unmount).not.toHaveBeenCalled();
    expect(d.getSnapshot().covered).toBe(true);
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    expect(d.getSnapshot().covered).toBe(true);
    isl.options().onReady({ studyInstanceUid: B, generation: isl.gen(), state: 'reportable' });
    expect(d.getSnapshot()).toMatchObject({ covered: false, routeStudyRef: studyRefFor(B) });
  });

  it('retries a not-ready island and waits out a Submit in flight', async () => {
    const isl = fakeIsland({
      firstAnswers: [
        { ok: false, reason: 'not-ready' },
        { ok: false, reason: 'submitting' },
      ],
    });
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    d.enter(B);
    expect(isl.handle.setCase).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(200);
    expect(isl.handle.setCase).toHaveBeenCalledTimes(2);
    expect(d.getSnapshot().coverText).toBe('Finishing the signature on the previous case…');
    isl.options().onSigned({ studyInstanceUid: A, sessionId: null });
    expect(isl.handle.setCase).toHaveBeenCalledTimes(3);
    expect(d.getSnapshot().coverText).toBe('Opening the report for this study…');
  });

  it('refuses Images until the microphone state is known, then hides the report and parks nothing', async () => {
    const isl = fakeIsland();
    const parked: string[] = [];
    const off = onParkedChange(s => parked.push(s));
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    expect(d.setMode('images')).toBe(false);
    expect(d.getSnapshot()).toMatchObject({ mode: 'both', counts: { refusedImages: 1 } });
    isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    expect(d.setMode('images')).toBe(true);
    expect(isl.handle.setVisibility).toHaveBeenLastCalledWith(false);
    expect(column()?.getAttribute('aria-hidden')).toBe('true');
    expect(d.getSnapshot().mode).toBe('images');
    d.setMode('report');
    expect(isl.handle.setVisibility).toHaveBeenLastCalledWith(true);
    expect(isl.handle.setFocus).toHaveBeenCalled();
    expect(parked).toEqual(['parked']);
    d.setMode('both');
    expect(parked).toEqual(['parked', 'visible']);
    off();
  });

  it('a new case clears the microphone state: Images is held as Both until it comes', async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    d.setMode('images');
    d.enter(B);
    isl.options().onDictation(null);
    expect(d.getSnapshot()).toMatchObject({ requested: 'images', mode: 'both', imagesHeld: true });
    expect(isl.handle.setVisibility).toHaveBeenLastCalledWith(true);
    isl.options().onDictation({ started: false, busy: false, available: true, pending: 0 });
    expect(d.getSnapshot()).toMatchObject({ mode: 'images', imagesHeld: false });
  });

  it('shows notices only while the report is hidden', async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    isl.options().onNotice({ level: 'error', code: 'DRAFT_NOT_SAVED' });
    expect(d.getSnapshot().notices).toEqual([]);
    isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    d.setMode('images');
    isl.options().onNotice({ level: 'error', code: 'DRAFT_NOT_SAVED' });
    isl.options().onAuthRequired({ reason: 'AccessTokenError' });
    isl.options().onNotice({ level: 'warning', code: 'not a code' });
    expect(d.getSnapshot().notices.map(n => n.code)).toEqual(['DRAFT_NOT_SAVED', 'AUTH_REQUIRED']);
    d.setMode('both');
    expect(d.getSnapshot().notices).toEqual([]);
  });

  it('a case switch stays; an error route keeps the report alone; leaving settles, then unmounts', async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    d.routeLeft();
    jest.runOnlyPendingTimers();
    expect(d.isGone()).toBe(false);

    setPath('/viewer/notfoundstudy');
    d.routeLeft();
    jest.runOnlyPendingTimers();
    expect(d.isGone()).toBe(false);
    expect(d.getSnapshot()).toMatchObject({ viewerShown: false, mode: 'report' });
    expect((document.querySelector('[data-pacsai-reading-images-gone]') as HTMLElement).style.display).toBe('flex');

    setPath('/viewer/viewer/');
    d.routeLeft();
    jest.runOnlyPendingTimers();
    await flush();
    expect(isl.handle.settle).toHaveBeenCalledTimes(1);
    expect(isl.handle.unmount).toHaveBeenCalledTimes(1);
    expect(d.isGone()).toBe(true);
    expect(column()).toBeNull();
    expect(document.documentElement.style.getPropertyValue(IMAGES_WIDTH_VAR)).toBe('');
  });

  it('leaving: nothing of the report on screen while it settles, its recognizer stopped first, the images not held parked', async () => {
    const isl = fakeIsland();
    let release: () => void = () => undefined;
    isl.handle.settle.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve({ studyInstanceUid: A, generation: 1, state: 'reportable', draft: 'saved' });
        })
    );
    const parked: string[] = [];
    const off = onParkedChange(s => parked.push(s));
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    d.setMode('report');
    expect(parked).toEqual(['parked']);
    isl.handle.setVisibility.mockClear();

    setPath('/viewer/viewer/viewer?StudyInstanceUIDs=' + A); // another mode, same document
    d.routeLeft();
    jest.runOnlyPendingTimers();
    await flush();
    // Settling: the column is still in the page (the island mounted), off the window and inert.
    expect(isl.handle.settle).toHaveBeenCalledTimes(1);
    expect(isl.handle.unmount).not.toHaveBeenCalled();
    const col = column() as HTMLElement & { inert?: boolean };
    expect(col).not.toBeNull();
    expect(parseInt(col.style.left, 10)).toBeGreaterThanOrEqual(1920);
    expect(col.inert).toBe(true);
    expect(col.getAttribute('aria-hidden')).toBe('true');
    expect((document.querySelector('[data-pacsai-reading-divider]') as HTMLElement).hidden).toBe(true);
    expect(isl.handle.setVisibility).toHaveBeenLastCalledWith(false);
    expect(isl.handle.toggleDictation).toHaveBeenCalledTimes(1);
    expect(isl.handle.toggleDictation.mock.invocationCallOrder[0]).toBeLessThan(
      isl.handle.settle.mock.invocationCallOrder[0]
    );
    expect(parked).toEqual(['parked', 'visible']);
    expect(document.documentElement.style.getPropertyValue(IMAGES_WIDTH_VAR)).toBe('');
    // A resize while it settles does not bring it back.
    window.dispatchEvent(new Event('resize'));
    expect(parseInt(col.style.left, 10)).toBeGreaterThanOrEqual(1920);

    release();
    await flush();
    expect(isl.handle.unmount).toHaveBeenCalledTimes(1);
    expect(column()).toBeNull();
    off();
  });

  it('leaving with the microphone off, or between states, toggles nothing; a settle that never ends is cut at 10 s', async () => {
    for (let i = 0; i < 2; i++) {
      const isl = fakeIsland();
      isl.handle.settle.mockImplementation(() => new Promise(() => undefined));
      const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
      d.enter(A);
      await flush();
      isl.options().onDictation(
        i === 0
          ? { started: false, busy: false, available: true, pending: 0 }
          : { started: true, busy: true, available: true, pending: 0 }
      );
      setPath('/viewer/viewer/');
      d.routeLeft();
      jest.runOnlyPendingTimers(); // the leave
      await flush();
      expect(isl.handle.toggleDictation).not.toHaveBeenCalled();
      expect(isl.handle.unmount).not.toHaveBeenCalled();
      jest.advanceTimersByTime(10_000);
      await flush();
      expect(isl.handle.unmount).toHaveBeenCalledTimes(1);
      expect(column()).toBeNull();
      setPath('/viewer/viewer/radcopilot?StudyInstanceUIDs=' + A);
    }
  });

  it("the sign-in pop-up's poll: one at a time, and it ends with the dock", async () => {
    const popup = { closed: false };
    const load = jest.fn(async () => ({ ok: false as const, failure: 'APP_SIGNED_OUT' as const }));
    dock = createReadingDock({
      win: window,
      load,
      isReadingPath,
      isErrorPath,
      openAppSignIn: () => popup as unknown as Window,
    });
    dock.enter(A);
    await flush();
    const action = document.querySelector('[data-pacsai-reading-cover-action]') as HTMLButtonElement;
    expect(action.hidden).toBe(false);
    action.click();
    action.click(); // a second click: still one poll
    expect(jest.getTimerCount()).toBe(1);
    // The pop-up closes: the dock asks again.
    popup.closed = true;
    jest.advanceTimersByTime(500);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
    // Signed out still: Sign in again, then leave while the pop-up is open.
    popup.closed = false;
    action.click();
    expect(jest.getTimerCount()).toBe(1);
    await dock.destroy();
    expect(jest.getTimerCount()).toBe(0);
    popup.closed = true;
    jest.advanceTimersByTime(2000);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(column()).toBeNull();
  });

  it('asks before the page unloads while a report is open, not after it is signed', async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    const fire = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(fire()).toBe(false); // still loading: nothing on screen to lose
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    expect(fire()).toBe(true);
    isl.options().onSigned({ studyInstanceUid: A, sessionId: 's' });
    expect(fire()).toBe(false);
  });

  it('relays Alt+1/2/3 from inside the report; outside it leaves them to the viewer', async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    isl.options().onDictation({ started: false, busy: false, available: true, pending: 0 });
    const inside = document.createElement('input');
    document.querySelector('[data-pacsai-reading-island]')?.appendChild(inside);
    const key = new KeyboardEvent('keydown', { code: 'Digit3', key: '£', altKey: true, bubbles: true, cancelable: true });
    inside.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(d.getSnapshot().mode).toBe('report');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const key2 = new KeyboardEvent('keydown', { code: 'Digit1', altKey: true, bubbles: true, cancelable: true });
    outside.dispatchEvent(key2);
    expect(key2.defaultPrevented).toBe(false);
    expect(d.getSnapshot().mode).toBe('report');
    outside.remove();
  });

  it('says why there is no report when the island cannot be had, and never mounts one', async () => {
    const d = makeDock(async () => ({ ok: false, failure: 'VIEWER_HOST_OFF' }));
    d.enter(A);
    await flush();
    expect(d.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'VIEWER_HOST_OFF', covered: true });
    expect(cover().textContent).toMatch(/not offered in the viewer/);
    expect(d.setMode('images')).toBe(true); // no report to dictate: the images may have the window
  });

  it('refuses a handle that is not v1, and unmounts it', async () => {
    const isl = fakeIsland();
    (isl.handle as { version: number }).version = 2;
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    expect(isl.handle.unmount).toHaveBeenCalledTimes(1);
    expect(d.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'ISLAND_VERSION_MISMATCH' });
  });

  it('the divider moves the report by keys and by drag, and gives the caret back after a drag', async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    const divider = document.querySelector('[data-pacsai-reading-divider]') as HTMLElement;
    expect(divider.getAttribute('aria-valuenow')).toBe('40');
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    divider.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
    expect(divider.getAttribute('aria-valuenow')).toBe('42');
    // jsdom has no PointerEvent: a MouseEvent carrying pointerId stands in.
    const pointer = (type: string, clientX: number) => {
      const e = new MouseEvent(type, { clientX, bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      divider.dispatchEvent(e);
    };
    pointer('pointerdown', 1000);
    pointer('pointermove', 1920 - 4 - 0.5 * 1912);
    pointer('pointerup', 1920 - 4 - 0.5 * 1912);
    expect(d.getSnapshot().reportPercent).toBe(50);
    expect(isl.handle.setFocus).toHaveBeenCalled();
  });
});

describe('the paths', () => {
  it('knows its own route and the error routes', () => {
    expect(isReadingPath('/viewer/viewer/radcopilot')).toBe(true);
    expect(isReadingPath('/viewer/viewer/radcopilot/arc-src-0')).toBe(true);
    expect(isReadingPath('/viewer/viewer/viewer')).toBe(false);
    expect(isReadingPath('/viewer/viewer/')).toBe(false);
    expect(isErrorPath('/viewer/notfoundstudy')).toBe(true);
    expect(isErrorPath('/viewer/viewer/notfoundserver')).toBe(true);
    expect(isErrorPath('/viewer/viewer/')).toBe(false);
  });
});
