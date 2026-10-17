import { createReadingDock, isErrorPath, isReadingPath, type ReadingDock } from './readingDock';
import type { IslandLoadResult } from './islandLoader';
import { MAX_CASES_IN_DOCUMENT } from './readingChannel';

// Rev 11 milestone 6, approach C, phase 2: the dock's side of the worklist's
// channel (readingChannel.ts): its advertisement, a Read as the in-document
// switch or a planned reload, refusals, and the closeWindow relay after Sign.

const A = '1.2.840.1.1';
const B = '1.2.840.1.2';
const LAUNCH_A = { attempt: 'att-aaaa1111', attemptT0: 1759300000000 };
const LAUNCH_B = { attempt: 'att-bbbb2222', attemptT0: 1759300005000 };
const ORIGIN = window.location.origin;
const DOC = '0123456789abcdef0123456789abcdef';

type Opts = Record<string, (arg?: unknown) => void> & { studyInstanceUid: string };

function fakeIsland({ submitting = () => false } = {}) {
  let generation = 1;
  let options: Opts | null = null;
  const handle = {
    api: 'pacsai.reportIsland',
    version: 1,
    setCase: jest.fn(() => ({ ok: true, generation: ++generation, sameCase: false })),
    setVisibility: jest.fn(),
    setFocus: jest.fn(() => true),
    settle: jest.fn(async () => ({
      studyInstanceUid: A,
      generation,
      state: 'reportable',
      draft: 'saved',
    })),
    unmount: jest.fn(),
    toggleDictation: jest.fn(() => true),
    isSubmitting: jest.fn(submitting),
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
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
};

function fakeOpener() {
  return { closed: false, postMessage: jest.fn() } as unknown as Window & {
    postMessage: jest.Mock;
  };
}

let dock: ReadingDock | null = null;
function makeDock({
  load,
  opener,
  gateways = ['GW1'],
}: {
  load: () => Promise<IslandLoadResult>;
  opener: Window | null;
  gateways?: string[];
}) {
  const switchTo = jest.fn();
  const loadNew = jest.fn();
  dock = createReadingDock({
    win: window,
    load,
    isReadingPath,
    isErrorPath,
    channel: {
      opener: () => opener,
      ownOrigin: ORIGIN,
      documentGateways: () => gateways,
      openedPath: '/viewer/viewer/radcopilot',
      switchTo,
      loadNew,
      mintId: () => DOC,
    },
  });
  return { dock, switchTo, loadNew };
}

const command = (over: Record<string, unknown> = {}) => ({
  action: 'workspaceOpenCase',
  requestId: 'req-11111111',
  studyInstanceUid: B,
  attempt: LAUNCH_B.attempt,
  attemptT0: LAUNCH_B.attemptT0,
  gatewayAET: 'GW1',
  ...over,
});

/** A message as the window receives it, from `source`. */
function receive(data: unknown, source: unknown, origin = ORIGIN) {
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: source });
  window.dispatchEvent(event);
}

const posted = (opener: { postMessage: jest.Mock }, action: string) =>
  opener.postMessage.mock.calls
    .filter(([m]) => (m as { action?: string })?.action === action)
    .map(([m, target]) => ({ m, target }));

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });
  window.history.replaceState(
    null,
    '',
    `/viewer/viewer/radcopilot?StudyInstanceUIDs=${A}&gatewayAET=GW1`
  );
});
afterEach(async () => {
  await dock?.destroy();
  jest.runOnlyPendingTimers();
  dock = null;
  jest.useRealTimers();
});

async function mounted(
  opts: { opener?: Window | null; gateways?: string[]; submitting?: () => boolean } = {}
) {
  const isl = fakeIsland({ submitting: opts.submitting });
  const opener = opts.opener === undefined ? fakeOpener() : opts.opener;
  const made = makeDock({
    load: async () => ({ ok: true, module: isl.module as never, build: 'test' }),
    opener,
    gateways: opts.gateways,
  });
  made.dock.enter(A, LAUNCH_A);
  await flush();
  isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
  return { ...made, isl, opener: opener as Window & { postMessage: jest.Mock } };
}

describe('the reading dock and the worklist that opened its window', () => {
  it('advertises, once mounted, that it can open the next case in its page, with the launch it shows', async () => {
    const { opener, dock: d } = await mounted();
    const adverts = posted(opener, 'workspaceState');
    expect(adverts).toHaveLength(1);
    expect(adverts[0]).toEqual({
      m: { action: 'workspaceState', documentId: DOC, activeLaunch: LAUNCH_A, caseSwitch: 1 },
      target: ORIGIN,
    });
    expect(d.getSnapshot().channel).toMatchObject({
      documentId: DOC,
      opener: true,
      casesInDocument: 1,
      adverts: 1,
    });
  });

  it('a report that cannot load advertises no switch (the worklist then replaces the page: the retry)', async () => {
    const opener = fakeOpener();
    const { dock: d } = makeDock({
      load: async () => ({ ok: false, failure: 'ISLAND_LOAD_FAILED' }),
      opener,
    });
    d.enter(A, LAUNCH_A);
    await flush();
    expect(posted(opener, 'workspaceState').map(p => p.m)).toEqual([
      { action: 'workspaceState', documentId: DOC, activeLaunch: LAUNCH_A },
    ]);
    receive(command(), opener);
    expect(posted(opener, 'workspaceCaseOpened').map(p => p.m)).toEqual([
      {
        action: 'workspaceCaseOpened',
        requestId: 'req-11111111',
        documentId: DOC,
        accepted: false,
        reason: 'reload',
      },
    ]);
  });

  it('a Read of another study on this gateway is the in-document switch, answered at once', async () => {
    const { opener, switchTo, loadNew, isl, dock: d } = await mounted();
    receive(command(), opener);
    expect(posted(opener, 'workspaceCaseOpened').map(p => p.m)).toEqual([
      {
        action: 'workspaceCaseOpened',
        requestId: 'req-11111111',
        documentId: DOC,
        accepted: true,
        activeLaunch: LAUNCH_B,
      },
    ]);
    expect(switchTo).toHaveBeenCalledWith(
      `${ORIGIN}/viewer/viewer/radcopilot?StudyInstanceUIDs=${B}&gatewayAET=GW1&attempt=${LAUNCH_B.attempt}&attemptT0=${LAUNCH_B.attemptT0}`
    );
    expect(loadNew).not.toHaveBeenCalled();
    expect(d.getSnapshot().channel).toMatchObject({ casesInDocument: 2, answers: { switched: 1 } });
    // The route lands (the mode re-entered for B): setCase with B's launch, and
    // the advertisement now names B's launch.
    window.history.replaceState(
      null,
      '',
      `/viewer/viewer/radcopilot?StudyInstanceUIDs=${B}&gatewayAET=GW1`
    );
    d.enter(B, LAUNCH_B);
    expect(isl.handle.setCase).toHaveBeenCalledWith(B, LAUNCH_B);
    expect(
      posted(opener, 'workspaceState')
        .map(p => p.m)
        .pop()
    ).toEqual({ action: 'workspaceState', documentId: DOC, activeLaunch: LAUNCH_B, caseSwitch: 1 });
  });

  it('a Read of the case already shown only focuses the report', async () => {
    const { opener, switchTo, isl } = await mounted();
    receive(command({ studyInstanceUid: A }), opener);
    expect(posted(opener, 'workspaceCaseOpened').map(p => p.m)).toEqual([
      {
        action: 'workspaceCaseOpened',
        requestId: 'req-11111111',
        documentId: DOC,
        accepted: true,
        sameCase: true,
        activeLaunch: LAUNCH_A,
      },
    ]);
    expect(switchTo).not.toHaveBeenCalled();
    expect(isl.handle.setFocus).toHaveBeenCalled();
  });

  it('counts and never answers a command that is not from its opener, not of its origin, or invalid', async () => {
    const { opener, switchTo, dock: d } = await mounted();
    const stranger = fakeOpener();
    receive(command(), stranger);
    receive(command(), opener, 'https://elsewhere.example.org');
    receive(command({ requestId: 'x' }), opener);
    receive({ type: 'oidc-silent-renew' }, stranger); // not the channel's at all
    expect(posted(opener, 'workspaceCaseOpened')).toHaveLength(0);
    expect(stranger.postMessage).not.toHaveBeenCalled();
    expect(switchTo).not.toHaveBeenCalled();
    expect(d.getSnapshot().channel.ignored).toEqual({ source: 1, origin: 1, payload: 1 });
  });

  it('another gateway: accepted, the report settled (a Submit in flight first), then the new address loads with no leave prompt', async () => {
    let submitting = true;
    const {
      opener,
      switchTo,
      loadNew,
      isl,
      dock: d,
    } = await mounted({ submitting: () => submitting });
    // The reader has a report open: the page would ask before it unloads.
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    receive(command({ gatewayAET: 'GW2' }), opener);
    expect(posted(opener, 'workspaceCaseOpened').map(p => p.m)).toEqual([
      {
        action: 'workspaceCaseOpened',
        requestId: 'req-11111111',
        documentId: DOC,
        accepted: true,
        activeLaunch: LAUNCH_B,
      },
    ]);
    expect(d.getSnapshot()).toMatchObject({
      coverText: 'Saving the report, then opening the next case…',
      channel: { plannedReload: 'settling' },
    });
    // No switch can be offered meanwhile.
    expect(
      posted(opener, 'workspaceState')
        .map(p => p.m)
        .pop()
    ).toEqual({ action: 'workspaceState', documentId: DOC, activeLaunch: LAUNCH_A });
    await flush();
    expect(isl.handle.settle).not.toHaveBeenCalled(); // the Submit first
    submitting = false;
    jest.advanceTimersByTime(250);
    await flush();
    expect(isl.handle.settle).toHaveBeenCalledTimes(1);
    await flush();
    expect(loadNew).toHaveBeenCalledWith(
      `${ORIGIN}/viewer/viewer/radcopilot?StudyInstanceUIDs=${B}&gatewayAET=GW2&attempt=${LAUNCH_B.attempt}&attemptT0=${LAUNCH_B.attemptT0}`
    );
    expect(switchTo).not.toHaveBeenCalled();
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    // A Read while the reload is under way: refused (the worklist's replace supersedes it).
    receive(command({ requestId: 'req-22222222' }), opener);
    expect(
      posted(opener, 'workspaceCaseOpened')
        .map(p => p.m)
        .pop()
    ).toEqual({
      action: 'workspaceCaseOpened',
      requestId: 'req-22222222',
      documentId: DOC,
      accepted: false,
      reason: 'reload',
    });
  });

  it(`the ${MAX_CASES_IN_DOCUMENT + 1}th case loads in a fresh document`, async () => {
    const { opener, switchTo, loadNew, isl, dock: d } = await mounted();
    for (let i = 2; i <= MAX_CASES_IN_DOCUMENT; i++) {
      const uid = `1.2.840.9.${i}`;
      receive(
        command({ requestId: `req-${String(i).padStart(8, '0')}`, studyInstanceUid: uid }),
        opener
      );
      window.history.replaceState(
        null,
        '',
        `/viewer/viewer/radcopilot?StudyInstanceUIDs=${uid}&gatewayAET=GW1`
      );
      d.enter(uid, LAUNCH_B);
    }
    expect(switchTo).toHaveBeenCalledTimes(MAX_CASES_IN_DOCUMENT - 1);
    expect(d.getSnapshot().channel.casesInDocument).toBe(MAX_CASES_IN_DOCUMENT);
    receive(command({ requestId: 'req-99999999', studyInstanceUid: '1.2.840.9.99' }), opener);
    await flush();
    jest.advanceTimersByTime(0);
    await flush();
    expect(switchTo).toHaveBeenCalledTimes(MAX_CASES_IN_DOCUMENT - 1);
    expect(isl.handle.settle).toHaveBeenCalled();
    expect(loadNew).toHaveBeenCalledTimes(1);
    expect(String(loadNew.mock.calls[0][0])).toContain(
      'StudyInstanceUIDs=1.2.840.9.99&gatewayAET=GW1'
    );
  });

  it("relays closeWindow after Sign, with the signed case's session; signed only for the case shown", async () => {
    const { opener, isl, dock: d } = await mounted();
    isl.options().onSigned({ studyInstanceUid: A, sessionId: LAUNCH_A.attempt });
    expect(posted(opener, 'closeWindow')).toEqual([
      { m: { action: 'closeWindow', sessionId: LAUNCH_A.attempt }, target: ORIGIN },
    ]);
    expect(d.getSnapshot()).toMatchObject({ signed: true, channel: { relays: 1 } });
  });

  it('a late Sign of a case switched away from is relayed (the worklist ignores it) and does not mark the shown case signed', async () => {
    const { opener, isl, dock: d } = await mounted();
    receive(command(), opener);
    window.history.replaceState(
      null,
      '',
      `/viewer/viewer/radcopilot?StudyInstanceUIDs=${B}&gatewayAET=GW1`
    );
    d.enter(B, LAUNCH_B);
    // A's return signal, reported with the island's study now B.
    isl.options().onSigned({ studyInstanceUid: B, sessionId: LAUNCH_A.attempt });
    expect(posted(opener, 'closeWindow').map(p => p.m)).toEqual([
      { action: 'closeWindow', sessionId: LAUNCH_A.attempt },
    ]);
    expect(d.getSnapshot().signed).toBe(false);
  });

  it('with no opener it talks to nobody, and the dock works as in phase 1', async () => {
    const { switchTo, dock: d } = await mounted({ opener: null });
    receive(command(), window);
    expect(switchTo).not.toHaveBeenCalled();
    expect(d.getSnapshot()).toMatchObject({
      phase: 'mounted',
      channel: { opener: false, adverts: 0 },
    });
  });
});

describe('the cover\'s "Report without images" (phase 2, PR 3)', () => {
  const button = () =>
    document.querySelector('[data-pacsai-reading-report-only]') as HTMLButtonElement | null;
  const make = (
    load: () => Promise<IslandLoadResult>,
    openReportOnly = jest.fn(() => ({}) as Window)
  ) => {
    dock = createReadingDock({ win: window, load, isReadingPath, isErrorPath, openReportOnly });
    return { dock, openReportOnly };
  };

  it("is offered when the report cannot be shown here, and opens the report-only page for the route's case", async () => {
    const { dock: d, openReportOnly } = make(async () => ({
      ok: false,
      failure: 'ISLAND_LOAD_FAILED',
    }));
    d.enter(A, LAUNCH_A);
    await flush();
    expect(button()?.hidden).toBe(false);
    expect(button()?.textContent).toBe('Report without images');
    button()?.click();
    expect(openReportOnly).toHaveBeenCalledWith(A, LAUNCH_A);
    expect(d.getSnapshot().reportOnlyOpens).toBe(1);
  });

  it('for every failure but a missing app session (that one offers Sign in)', async () => {
    // (an index loop: the fork's Babel cannot compile for…of in an async test)
    const failures = ['FLAGS_UNREADABLE', 'VIEWER_HOST_OFF', 'ISLAND_VERSION_MISMATCH'] as const;
    for (let i = 0; i < failures.length; i++) {
      const failure = failures[i];
      const { dock: d } = make(async () => ({ ok: false, failure }));
      d.enter(A, LAUNCH_A);
      await flush();
      expect([failure, button()?.hidden]).toEqual([failure, false]);
      await d.destroy();
    }
    const { dock: d } = make(async () => ({ ok: false, failure: 'APP_SIGNED_OUT' }));
    d.enter(A, LAUNCH_A);
    await flush();
    expect(button()?.hidden).toBe(true);
  });

  it('is not offered while the report is there', async () => {
    const isl = fakeIsland();
    const { dock: d } = make(async () => ({
      ok: true,
      module: isl.module as never,
      build: 'test',
    }));
    d.enter(A, LAUNCH_A);
    await flush();
    expect(d.getSnapshot().phase).toBe('mounted');
    expect(button()?.hidden).toBe(true);
  });
});
