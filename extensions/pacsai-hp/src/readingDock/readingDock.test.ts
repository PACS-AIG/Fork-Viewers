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

describe("the reading dock's gear menu items (18 Oct)", () => {
  function islandWithMenu() {
    const isl = fakeIsland();
    let quiet = false;
    Object.assign(isl.handle, {
      openReportSettings: jest.fn(() => true),
      quietWorkspace: jest.fn(() => quiet),
      setQuietWorkspace: jest.fn((on: boolean) => {
        quiet = on;
        return true;
      }),
    });
    return isl;
  }

  it('lists nothing before the report is up, then its settings and the quiet_workspace switch', async () => {
    const isl = islandWithMenu();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    expect(d.menuOptions()).toEqual([]);
    d.enter(A);
    await flush();
    expect(d.menuOptions().map(o => o.title)).toEqual(['Report settings', 'Quiet report layout: off']);
    d.menuOptions()[0].onClick();
    expect((isl.handle as unknown as { openReportSettings: jest.Mock }).openReportSettings).toHaveBeenCalledTimes(1);
    d.menuOptions()[1].onClick();
    expect((isl.handle as unknown as { setQuietWorkspace: jest.Mock }).setQuietWorkspace).toHaveBeenCalledWith(true);
    expect(d.menuOptions()[1].title).toBe('Quiet report layout: on');
    d.menuOptions()[1].onClick();
    expect((isl.handle as unknown as { setQuietWorkspace: jest.Mock }).setQuietWorkspace).toHaveBeenLastCalledWith(false);
  });

  it('Report settings from Images brings the report back first (its popups hide with it)', async () => {
    const isl = islandWithMenu();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    expect(d.setMode('images')).toBe(true);
    expect(d.getSnapshot().mode).toBe('images');
    d.menuOptions()[0].onClick();
    expect(d.getSnapshot().mode).toBe('both');
    expect((isl.handle as unknown as { openReportSettings: jest.Mock }).openReportSettings).toHaveBeenCalledTimes(1);
  });

  it('F55 PR 2: the sound cues switch, listed only where the app allows the cues, and flipped from the menu', async () => {
    const isl = islandWithMenu();
    let allowed = false;
    let cues = false;
    Object.assign(isl.handle, {
      earcons: jest.fn(() => (allowed ? cues : null)),
      setEarcons: jest.fn((on: boolean) => {
        cues = on;
        return true;
      }),
    });
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    expect(d.menuOptions().map(o => o.title)).toEqual([
      'Report settings',
      'Quiet report layout: off',
    ]);
    allowed = true;
    expect(d.menuOptions().map(o => o.title)).toEqual([
      'Report settings',
      'Quiet report layout: off',
      'Sound cues: off',
    ]);
    d.menuOptions()[2].onClick();
    expect((isl.handle as unknown as { setEarcons: jest.Mock }).setEarcons).toHaveBeenCalledWith(
      true
    );
    expect(d.menuOptions()[2].title).toBe('Sound cues: on');
    d.menuOptions()[2].onClick();
    expect(
      (isl.handle as unknown as { setEarcons: jest.Mock }).setEarcons
    ).toHaveBeenLastCalledWith(false);
    // A switch that throws or answers something else lists nothing.
    (isl.handle as unknown as { earcons: jest.Mock }).earcons.mockImplementation(() => {
      throw new Error('gone');
    });
    expect(d.menuOptions()).toHaveLength(2);
    (isl.handle as unknown as { earcons: jest.Mock }).earcons.mockImplementation(() => 'on');
    expect(d.menuOptions()).toHaveLength(2);
  });

  it('lists nothing for an island without them (a v1 build from before), and nothing once the dock is gone', async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    expect(d.menuOptions()).toEqual([]);
    const withMenu = islandWithMenu();
    await d.destroy();
    const d2 = makeDock(async () => ({ ok: true, module: withMenu.module as never, build: 'test' }));
    d2.enter(A);
    await flush();
    expect(d2.menuOptions()).toHaveLength(2);
    await d2.destroy();
    expect(d2.menuOptions()).toEqual([]);
  });
});

describe("the reading dock's Logout with the app's sign-in (21 Oct)", () => {
  const loaded = (isl: ReturnType<typeof fakeIsland>) => async () =>
    ({ ok: true, module: isl.module as never, build: 'test' }) as IslandLoadResult;
  function appDock(isl: ReturnType<typeof fakeIsland>, extra: Record<string, unknown> = {}) {
    const log: string[] = [];
    const signOutOfApp = jest.fn(async () => {
      log.push('signOut');
      return true;
    });
    const leaveAfterSignOut = jest.fn((signedOut: boolean) => log.push(`leave:${signedOut}`));
    isl.handle.settle.mockImplementation(async () => {
      log.push('settle');
      return { studyInstanceUid: A, generation: isl.gen(), state: 'reportable', draft: 'saved' };
    });
    dock = createReadingDock({
      win: window,
      load: loaded(isl),
      isReadingPath,
      isErrorPath,
      viewerUserIsApp: () => true,
      signOutOfApp,
      leaveAfterSignOut,
      ...extra,
    });
    return { d: dock, log, signOutOfApp, leaveAfterSignOut };
  }

  it("is not taken when the viewer's user is its own, or without the app's sign-out: OHIF's /logout as before", async () => {
    const isl = fakeIsland();
    const plain = makeDock(loaded(isl));
    expect(plain.logout()).toBe(false);
    await plain.destroy();
    const own = appDock(fakeIsland(), { viewerUserIsApp: () => false });
    expect(own.d.logout()).toBe(false);
    expect(own.signOutOfApp).not.toHaveBeenCalled();
    await own.d.destroy();
    const noSignOut = appDock(fakeIsland(), { signOutOfApp: undefined });
    expect(noSignOut.d.logout()).toBe(false);
  });

  it('settles the report first (its draft saved while the session takes it), then signs out of the app, then leaves', async () => {
    const isl = fakeIsland();
    const { d, log, leaveAfterSignOut } = appDock(isl);
    d.enter(A);
    await flush();
    expect(d.logout()).toBe(true);
    await flush();
    expect(log).toEqual(['settle', 'signOut', 'leave:true']);
    expect(leaveAfterSignOut).toHaveBeenCalledWith(true);
  });

  it('a second Logout while one runs adds nothing', async () => {
    const isl = fakeIsland();
    const { d, signOutOfApp } = appDock(isl);
    d.enter(A);
    await flush();
    expect(d.logout()).toBe(true);
    expect(d.logout()).toBe(true);
    await flush();
    expect(signOutOfApp).toHaveBeenCalledTimes(1);
  });

  it("a sign-out that did not answer leaves for the app's own sign-out page", async () => {
    const isl = fakeIsland();
    const { d, leaveAfterSignOut } = appDock(isl, { signOutOfApp: jest.fn(async () => false) });
    d.enter(A);
    await flush();
    d.logout();
    await flush();
    expect(leaveAfterSignOut).toHaveBeenCalledWith(false);
  });

  it('a report that does not settle within the bound does not hold the sign-out; no report at all signs out at once', async () => {
    const isl = fakeIsland();
    const { d, log, signOutOfApp } = appDock(isl);
    d.enter(A);
    await flush();
    isl.handle.settle.mockImplementation(() => new Promise(() => {}));
    d.logout();
    await flush();
    expect(signOutOfApp).not.toHaveBeenCalled();
    jest.advanceTimersByTime(10_000);
    await flush();
    expect(log).toEqual(['signOut', 'leave:true']);
    // The leave's own settle answers again, so the dock can go.
    isl.handle.settle.mockImplementation(async () => ({
      studyInstanceUid: A,
      generation: isl.gen(),
      state: 'reportable',
      draft: 'saved',
    }));
    await d.destroy();

    const none = appDock(fakeIsland());
    expect(none.d.logout()).toBe(true);
    await flush();
    expect(none.log).toEqual(['signOut', 'leave:true']);
  });
});

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

  // 30 Oct (the acceptance, pass 2): a signed-out route never enters its mode,
  // so OHIF never calls onModeExit (routeLeft) when the reader leaves it.
  it("leaving a route whose mode never entered: the window's own route takes the dock away", async () => {
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
    (document.querySelector('[data-pacsai-reading-cover-action]') as HTMLButtonElement).click();
    expect(jest.getTimerCount()).toBe(1);
    // The router moves to the study list; nothing calls routeLeft.
    window.history.pushState(null, '', '/viewer/viewer/');
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    jest.advanceTimersByTime(0);
    await flush();
    expect(dock.isGone()).toBe(true);
    expect(column()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    // The pop-up closes with the session back: no report on the study list.
    popup.closed = true;
    jest.advanceTimersByTime(2000);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(column()).toBeNull();
  });

  it("the window's own route: a move that stays on radcopilot keeps the dock, an error route keeps the report", async () => {
    const load = jest.fn(async () => ({ ok: false as const, failure: 'APP_SIGNED_OUT' as const }));
    const d = makeDock(load);
    d.enter(A);
    await flush();
    // radcopilot under a data source: still the reading route.
    window.history.pushState(null, '', '/viewer/viewer/radcopilot/dicomweb?StudyInstanceUIDs=' + A);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    jest.advanceTimersByTime(0);
    await flush();
    expect(d.isGone()).toBe(false);
    expect(column()).not.toBeNull();
    // The viewer's not-found route keeps the report, as onModeExit's routeLeft does.
    window.history.pushState(null, '', '/viewer/notfoundstudy');
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    jest.advanceTimersByTime(0);
    await flush();
    expect(d.isGone()).toBe(false);
    expect(d.getSnapshot().viewerShown).toBe(false);
    expect(column()).not.toBeNull();
    // A path the watch has already seen is not a move.
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    jest.advanceTimersByTime(0);
    await flush();
    expect(d.isGone()).toBe(false);
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

  it("F4 toggles the report's microphone on the whole page, once per press; other F4 chords pass", async () => {
    const isl = fakeIsland();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    const press = (target: EventTarget, o: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', {
        code: 'F4',
        key: 'F4',
        bubbles: true,
        cancelable: true,
        ...o,
      });
      target.dispatchEvent(e);
      return e;
    };
    // From inside the report.
    const inside = document.createElement('input');
    document.querySelector('[data-pacsai-reading-island]')?.appendChild(inside);
    const e1 = press(inside);
    expect(e1.defaultPrevented).toBe(true);
    expect(isl.handle.toggleDictation).toHaveBeenCalledTimes(1);
    // From the images (outside the report), and in Images mode too.
    d.setMode('images');
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const e2 = press(outside);
    expect(e2.defaultPrevented).toBe(true);
    expect(isl.handle.toggleDictation).toHaveBeenCalledTimes(2);
    // Held: the repeats are taken, and toggle nothing.
    const r = press(outside, { repeat: true });
    expect(r.defaultPrevented).toBe(true);
    press(outside, { repeat: true });
    expect(isl.handle.toggleDictation).toHaveBeenCalledTimes(2);
    expect(d.getSnapshot().counts.micKeys).toBe(2);
    // Alt/Ctrl/Shift/Meta+F4 are not the microphone key.
    for (const mod of ['altKey', 'ctrlKey', 'shiftKey', 'metaKey']) {
      const e = press(outside, { [mod]: true });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(isl.handle.toggleDictation).toHaveBeenCalledTimes(2);
    // Gone with the dock.
    await d.destroy();
    const callsAtLeave = isl.handle.toggleDictation.mock.calls.length;
    const e3 = press(outside);
    expect(e3.defaultPrevented).toBe(false);
    expect(isl.handle.toggleDictation).toHaveBeenCalledTimes(callsAtLeave);
    inside.remove();
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

describe('F56: the reading layouts (29 Oct)', () => {
  type Layout = { mode: string; reportRatio: number };
  function islandWithLayouts(
    menu: { modality: string | null; ownLayout: boolean } | null = {
      modality: 'CT',
      ownLayout: false,
    }
  ) {
    const isl = fakeIsland();
    const told: Layout[] = [];
    const actions: Array<[string, Layout]> = [];
    let shown: Layout | null = null;
    Object.assign(isl.handle, {
      layoutChanged: jest.fn((l: Layout) => {
        told.push({ ...l });
        return true;
      }),
      layoutMenu: jest.fn(() => menu),
      layoutAction: jest.fn((action: string, current: Layout) => {
        actions.push([action, { ...current }]);
        // Reset shows the Saved default through onLayout, as the island does.
        if (action === 'reset' && shown) {
          isl.options().onLayout(shown, 'reader');
        }
        return true;
      }),
    });
    return { isl, told, actions, setDefault: (l: Layout) => (shown = l) };
  }
  async function up(isl: ReturnType<typeof fakeIsland>, { micKnown = true } = {}) {
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    await flush();
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    if (micKnown) {
      isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    }
    return d;
  }

  it("tells the island the reader's own choices, and not the dock's or the report's", async () => {
    const { isl, told } = islandWithLayouts();
    const d = await up(isl);
    expect(d.setMode('report')).toBe(true);
    expect(told).toEqual([{ mode: 'report', reportRatio: 0.4 }]);
    d.setMode('report');
    expect(told).toHaveLength(1);
    d.setMode('both', 'system');
    expect(told).toHaveLength(1);
    // A spoken mode is the reader's; the report's own request is not.
    expect(isl.options().onModeRequest('images', 'spoken')).toBe(true);
    expect(told[1]).toEqual({ mode: 'images', reportRatio: 0.4 });
    isl.options().onModeRequest('both', 'report');
    isl.options().onModeRequest('report');
    expect(told).toHaveLength(2);
    // Report settings from Images brings the report back: not a choice.
    Object.assign(isl.handle, { openReportSettings: jest.fn(() => true) });
    d.setMode('images');
    const before = told.length;
    d.menuOptions()
      .find(o => o.title === 'Report settings')!
      .onClick();
    expect(d.getSnapshot().mode).toBe('both');
    expect(told).toHaveLength(before);
    expect(d.getSnapshot().layoutCounts.told).toBe(told.length);
  });

  it('tells the divider once a drag ends, and each key step', async () => {
    const { isl, told } = islandWithLayouts();
    await up(isl);
    const divider = document.querySelector('[data-pacsai-reading-divider]') as HTMLElement;
    divider.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    );
    expect(told).toEqual([{ mode: 'both', reportRatio: 0.42 }]);
    const pointer = (type: string, clientX: number) => {
      const e = new MouseEvent(type, { clientX, bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      divider.dispatchEvent(e);
    };
    pointer('pointerdown', 1000);
    pointer('pointermove', 1920 - 4 - 0.5 * 1912);
    pointer('pointermove', 1920 - 4 - 0.45 * 1912);
    expect(told).toHaveLength(1);
    pointer('pointerup', 1920 - 4 - 0.45 * 1912);
    expect(told).toHaveLength(2);
    expect(told[1].mode).toBe('both');
    expect(Math.round(told[1].reportRatio * 100)).toBe(45);
    // A click on the divider that moves nothing tells nothing.
    pointer('pointerdown', 1000);
    pointer('pointerup', 1000);
    expect(told).toHaveLength(2);
  });

  it("shows the island's layout without telling it back; Images waits for the microphone", async () => {
    const { isl, told } = islandWithLayouts();
    const d = await up(isl, { micKnown: false });
    expect(isl.options().onLayout({ mode: 'report', reportRatio: 0.5 })).toBe(true);
    expect(d.getSnapshot()).toMatchObject({
      requested: 'report',
      mode: 'report',
      reportPercent: 50,
    });
    expect(isl.options().onLayout({ mode: 'images', reportRatio: 0.45 })).toBe(true);
    expect(d.getSnapshot()).toMatchObject({
      requested: 'images',
      mode: 'both',
      imagesHeld: true,
      reportPercent: 45,
    });
    isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    expect(d.getSnapshot()).toMatchObject({
      requested: 'images',
      mode: 'images',
      imagesHeld: false,
    });
    expect(told).toEqual([]);
    expect(d.getSnapshot().layoutCounts).toEqual({ restores: 2, refusedRestores: 0, told: 0 });
    for (const bad of [
      null,
      {},
      { mode: 'wide', reportRatio: 0.4 },
      { mode: 'both', reportRatio: 1 },
      { mode: 'both', reportRatio: '0.4' },
    ]) {
      expect(isl.options().onLayout(bad)).toBe(false);
    }
    expect(d.getSnapshot()).toMatchObject({ requested: 'images', reportPercent: 45 });
    expect(d.getSnapshot().layoutCounts.refusedRestores).toBe(5);
  });

  it("keeps a drag under the reader's hand: a layout arriving mid-drag is refused", async () => {
    const { isl } = islandWithLayouts();
    const d = await up(isl);
    const divider = document.querySelector('[data-pacsai-reading-divider]') as HTMLElement;
    const e = new MouseEvent('pointerdown', {
      clientX: 1000,
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    divider.dispatchEvent(e);
    expect(isl.options().onLayout({ mode: 'report', reportRatio: 0.5 })).toBe(false);
    expect(d.getSnapshot().requested).toBe('both');
  });

  it("lists the gear menu's layout items and passes the layout on screen", async () => {
    const { isl, actions, setDefault } = islandWithLayouts();
    const d = await up(isl);
    d.setMode('report');
    const titles = () => d.menuOptions().map(o => o.title);
    expect(titles()).toEqual([
      'Layout: save as my default',
      'Layout: reset to my default',
      'Own layout for CT: off',
    ]);
    d.menuOptions()[0].onClick();
    expect(actions[0]).toEqual(['save', { mode: 'report', reportRatio: 0.4 }]);
    d.menuOptions()[2].onClick();
    expect(actions[1]).toEqual(['own-on', { mode: 'report', reportRatio: 0.4 }]);
    setDefault({ mode: 'both', reportRatio: 0.44 });
    d.menuOptions()[1].onClick();
    expect(actions[2][0]).toBe('reset');
    expect(d.getSnapshot()).toMatchObject({ requested: 'both', reportPercent: 44 });
  });

  it('lists the own-layout item only for a modality code, and nothing when the island cannot remember', async () => {
    let menu: { modality: unknown; ownLayout: unknown } | null = {
      modality: 'CT',
      ownLayout: true,
    };
    const { isl } = islandWithLayouts();
    (isl.handle as unknown as { layoutMenu: jest.Mock }).layoutMenu.mockImplementation(() => menu);
    const d = await up(isl);
    const titles = () => d.menuOptions().map(o => o.title);
    expect(titles()).toContain('Own layout for CT: on');
    menu = { modality: null, ownLayout: false };
    expect(titles()).toEqual(['Layout: save as my default', 'Layout: reset to my default']);
    menu = { modality: 'ct<b>', ownLayout: false };
    expect(titles()).toEqual(['Layout: save as my default', 'Layout: reset to my default']);
    menu = { modality: 'CT', ownLayout: 'yes' };
    expect(titles()).toEqual([]);
    menu = null;
    expect(titles()).toEqual([]);
    (isl.handle as unknown as { layoutMenu: jest.Mock }).layoutMenu.mockImplementation(() => {
      throw new Error('gone');
    });
    expect(titles()).toEqual([]);
  });

  it("refuses the case's remembered layout once the reader chose in the case, and takes it again for the next case", async () => {
    const { isl, told } = islandWithLayouts();
    const d = await up(isl);
    expect(d.setMode('report')).toBe(true);
    expect(isl.options().onLayout({ mode: 'both', reportRatio: 0.5 }, 'case')).toBe(false);
    expect(d.getSnapshot()).toMatchObject({ requested: 'report', reportPercent: 40 });
    // The reader's own Reset is shown whatever was chosen, and is not told back.
    expect(isl.options().onLayout({ mode: 'both', reportRatio: 0.44 }, 'reader')).toBe(true);
    expect(d.getSnapshot()).toMatchObject({ requested: 'both', reportPercent: 44 });
    expect(told).toHaveLength(1);
    // The next case opens with its remembered layout again.
    setPath('/viewer/viewer/radcopilot?StudyInstanceUIDs=' + B);
    d.enter(B);
    d.routeLeft();
    jest.runOnlyPendingTimers();
    expect(isl.handle.setCase).toHaveBeenCalledWith(B, undefined);
    expect(isl.options().onLayout({ mode: 'report', reportRatio: 0.5 }, 'case')).toBe(true);
    expect(d.getSnapshot()).toMatchObject({ requested: 'report', reportPercent: 50 });
    expect(d.getSnapshot().layoutCounts.refusedRestores).toBe(1);
  });

  it('tells a choice made while the island loaded once it is up, and keeps it over the remembered one', async () => {
    const { isl, told } = islandWithLayouts();
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    expect(d.getSnapshot().phase).toBe('loading');
    expect(d.setMode('report')).toBe(true);
    expect(told).toEqual([]);
    await flush();
    expect(d.getSnapshot().phase).toBe('mounted');
    expect(told).toEqual([{ mode: 'report', reportRatio: 0.4 }]);
    expect(isl.options().onLayout({ mode: 'both', reportRatio: 0.46 }, 'case')).toBe(false);
    expect(d.getSnapshot().requested).toBe('report');
  });

  it("tells a choice again when the case is ready, if the island's tree was not up to take it", async () => {
    const { isl, told } = islandWithLayouts();
    // The island's handle answers false until its tree is up.
    let up = false;
    (isl.handle as unknown as { layoutChanged: jest.Mock }).layoutChanged.mockImplementation(
      (l: { mode: string; reportRatio: number }) => {
        if (!up) {
          return false;
        }
        told.push({ ...l });
        return true;
      }
    );
    const d = makeDock(async () => ({ ok: true, module: isl.module as never, build: 'test' }));
    d.enter(A);
    d.setMode('report');
    await flush();
    expect(told).toEqual([]);
    expect(d.getSnapshot().layoutCounts.told).toBe(0);
    up = true;
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    expect(told).toEqual([{ mode: 'report', reportRatio: 0.4 }]);
    // Told once: a later ready tells nothing more.
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    expect(told).toHaveLength(1);
  });

  it('an island without them (a v1 build from before) is told nothing and lists nothing', async () => {
    const isl = fakeIsland();
    const d = await up(isl);
    expect(d.setMode('report')).toBe(true);
    expect(d.getSnapshot().layoutCounts.told).toBe(0);
    expect(d.menuOptions()).toEqual([]);
  });
});

describe('F58: Hold / Back (29 Oct)', () => {
  function islandWithPlace({ report = true } = {}) {
    const isl = fakeIsland();
    const ret = { caret: 'restored', section: 'FINDINGS', placedSince: 2, waiting: 0 };
    const told: unknown[] = [];
    if (report) {
      Object.assign(isl.handle, {
        holdPlace: jest.fn(() => true),
        returnToPlace: jest.fn(() => ret),
        layoutChanged: jest.fn((l: unknown) => {
          told.push(l);
          return true;
        }),
      });
    }
    return { isl, ret, told };
  }
  function viewerPlace() {
    let series = [
      { uid: 'a', label: 'series 1' },
      { uid: 'b', label: 'series 2' },
    ];
    const view = { held: 'the grid' };
    const adapter = {
      capture: jest.fn(() => view),
      restore: jest.fn(async () => ({ missing: [] as string[] })),
      series: jest.fn(() => series),
    };
    return {
      adapter,
      view,
      arrive: (s: { uid: string; label: string }) => (series = [...series, s]),
    };
  }
  async function up(isl: ReturnType<typeof fakeIsland>, adapter: unknown) {
    dock = createReadingDock({
      win: window,
      load: async () => ({ ok: true, module: isl.module as never, build: 'test' }),
      isReadingPath,
      isErrorPath,
      viewerPlace: adapter as never,
    });
    const d = dock;
    d.enter(A);
    await flush();
    isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
    isl.options().onDictation({ started: true, busy: false, available: true, pending: 0 });
    return d;
  }

  it('holds the images, the report and the mode, and Back puts them back with a line', async () => {
    const { isl, told } = islandWithPlace();
    const vp = viewerPlace();
    const d = await up(isl, vp.adapter);
    expect(d.holdPlace()).toBe(true);
    expect(vp.adapter.capture).toHaveBeenCalledTimes(1);
    expect((isl.handle as unknown as { holdPlace: jest.Mock }).holdPlace).toHaveBeenCalledTimes(1);
    expect(d.getSnapshot().place).toMatchObject({ held: true, holds: 1 });
    expect(d.getSnapshot().place.line).toMatch(/^Place held: the images and the report/);
    // The reader moves on: another mode, and a series arrives.
    d.setMode('report');
    vp.arrive({ uid: 'c', label: 'series 5' });
    const toldBefore = told.length;
    await expect(d.backToPlace()).resolves.toBe(true);
    expect(d.getSnapshot()).toMatchObject({ requested: 'both', mode: 'both' });
    expect(told).toHaveLength(toldBefore);
    expect(vp.adapter.restore).toHaveBeenCalledWith(vp.view);
    expect(
      (isl.handle as unknown as { returnToPlace: jest.Mock }).returnToPlace
    ).toHaveBeenCalledTimes(1);
    expect(d.getSnapshot().place.line).toBe(
      'Back to your place. Since then: 1 new series (series 5), 2 sentences placed.'
    );
    expect(d.getSnapshot().place.lastBack).toEqual({
      missing: 0,
      arrived: 1,
      caret: 'restored',
      section: 'FINDINGS',
      placedSince: 2,
      waiting: 0,
    });
    // The place stays: Back again works.
    await expect(d.backToPlace()).resolves.toBe(true);
    expect(d.getSnapshot().place).toMatchObject({ held: true, backs: 2 });
  });

  it('names a series no longer available, and says nothing is held before a hold', async () => {
    const { isl } = islandWithPlace();
    const vp = viewerPlace();
    vp.adapter.restore.mockResolvedValue({ missing: ['series 3'] });
    const d = await up(isl, vp.adapter);
    await expect(d.backToPlace()).resolves.toBe(false);
    expect(d.getSnapshot().place.line).toMatch(/^Nothing held yet/);
    expect(vp.adapter.restore).not.toHaveBeenCalled();
    d.holdPlace();
    await d.backToPlace();
    expect(d.getSnapshot().place.line).toMatch(
      /Series 3 is no longer available; its viewport is left as it is\.$/
    );
  });

  it('Alt+H holds and Alt+B goes back on the whole page; a held key acts once', async () => {
    const { isl } = islandWithPlace();
    const vp = viewerPlace();
    const d = await up(isl, vp.adapter);
    const key = (code: string, repeat = false) => {
      const e = new KeyboardEvent('keydown', {
        code,
        altKey: true,
        repeat,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(e);
      return e;
    };
    expect(key('KeyH').defaultPrevented).toBe(true);
    key('KeyH', true);
    expect(d.getSnapshot().place.holds).toBe(1);
    key('KeyB');
    await flush();
    expect(vp.adapter.restore).toHaveBeenCalledTimes(1);
    // Without Alt, or with another modifier, nothing.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', bubbles: true }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyH', altKey: true, ctrlKey: true, bubbles: true })
    );
    expect(d.getSnapshot().place.holds).toBe(1);
  });

  it('takes a spoken hold and back from the island', async () => {
    const { isl } = islandWithPlace();
    const vp = viewerPlace();
    const d = await up(isl, vp.adapter);
    expect(isl.options().onPlaceRequest('hold')).toBe(true);
    expect(d.getSnapshot().place.held).toBe(true);
    expect(isl.options().onPlaceRequest('back')).toBe(true);
    await flush();
    expect(vp.adapter.restore).toHaveBeenCalledTimes(1);
    expect(isl.options().onPlaceRequest('forward')).toBe(false);
  });

  it('a held place belongs to its case: another case opened clears it', async () => {
    const { isl } = islandWithPlace();
    const vp = viewerPlace();
    const d = await up(isl, vp.adapter);
    d.holdPlace();
    setPath('/viewer/viewer/radcopilot?StudyInstanceUIDs=' + B);
    d.enter(B);
    d.routeLeft();
    jest.runOnlyPendingTimers();
    expect(d.getSnapshot().place.held).toBe(false);
    await expect(d.backToPlace()).resolves.toBe(false);
    expect(vp.adapter.restore).not.toHaveBeenCalled();
  });

  it('an island without the report half (an older build) still holds the images', async () => {
    const { isl } = islandWithPlace({ report: false });
    const vp = viewerPlace();
    const d = await up(isl, vp.adapter);
    d.holdPlace();
    expect(d.getSnapshot().place.line).toBe(
      'Place held: the images. Say "back" or press Alt+B to return'
    );
    await d.backToPlace();
    expect(vp.adapter.restore).toHaveBeenCalledTimes(1);
    expect(d.getSnapshot().place.lastBack).toMatchObject({ caret: null, section: null });
  });

  it('the line goes after a while', async () => {
    const { isl } = islandWithPlace();
    const vp = viewerPlace();
    const d = await up(isl, vp.adapter);
    d.holdPlace();
    expect(d.getSnapshot().place.line).not.toBeNull();
    jest.advanceTimersByTime(12_001);
    expect(d.getSnapshot().place.line).toBeNull();
    expect(d.getSnapshot().place.held).toBe(true);
  });
});
