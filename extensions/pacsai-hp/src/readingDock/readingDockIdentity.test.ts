import { createReadingDock, isErrorPath, isReadingPath, type ReadingDock } from './readingDock';
import type { IslandLoadResult } from './islandLoader';

// Rev 11 milestone 6, approach C, phase 2 (PR 4): the dock tells the island
// what the viewer shows (the route's study, the viewer's own signed-in user),
// for the island's identity gate before the microphone and Sign.

const A = '1.2.840.1.1';
const B = '1.2.840.1.2';
const LAUNCH_A = { attempt: 'att-aaaa1111', attemptT0: 1759300000000 };
const LAUNCH_B = { attempt: 'att-bbbb2222', attemptT0: 1759300005000 };

type Opts = Record<string, (arg?: unknown) => void> & { studyInstanceUid: string };

function fakeIsland({ withIdentity = true, setCaseOk = true } = {}) {
  let generation = 1;
  let options: Opts | null = null;
  const calls: string[] = [];
  const handle: Record<string, unknown> = {
    api: 'pacsai.reportIsland',
    version: 1,
    setCase: jest.fn((study: string) => {
      calls.push(`setCase ${study}`);
      return setCaseOk
        ? { ok: true, generation: ++generation, sameCase: false }
        : { ok: false, reason: 'submitting' };
    }),
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
    isSubmitting: jest.fn(() => false),
  };
  if (withIdentity) {
    handle.setViewerIdentity = jest.fn(
      (identity: { studyInstanceUid: string | null; userSub: string | null }) => {
        calls.push(`identity ${identity.studyInstanceUid} ${identity.userSub}`);
        return true;
      }
    );
  }
  const module = {
    ISLAND_API: 'pacsai.reportIsland',
    ISLAND_API_VERSION: 1,
    ISLAND_BUILD: 'test',
    mountReportEditor: jest.fn((_el: HTMLElement, o: Opts) => {
      options = o;
      return handle;
    }),
  };
  return { module, handle, calls, options: () => options as Opts };
}

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
};

let dock: ReadingDock | null = null;
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
  opts: { viewerUser?: () => string | null; withIdentity?: boolean; setCaseOk?: boolean } = {}
) {
  const isl = fakeIsland({ withIdentity: opts.withIdentity, setCaseOk: opts.setCaseOk });
  const user = { value: 'kc-sub-reader' as string | null };
  dock = createReadingDock({
    win: window,
    load: async (): Promise<IslandLoadResult> => ({
      ok: true,
      module: isl.module as never,
      build: 'test',
    }),
    isReadingPath,
    isErrorPath,
    viewerUser: opts.viewerUser ?? (() => user.value),
  });
  dock.enter(A, LAUNCH_A);
  await flush();
  isl.options().onReady({ studyInstanceUid: A, generation: 1, state: 'reportable' });
  return { dock, isl, user };
}

describe("the viewer's identity, told to the island (phase 2, PR 4)", () => {
  it("at the mount: the route's study and the viewer's signed-in user", async () => {
    const { dock: d, isl } = await mounted();
    expect(isl.handle.setViewerIdentity).toHaveBeenCalledTimes(1);
    expect(isl.handle.setViewerIdentity).toHaveBeenCalledWith({
      studyInstanceUid: A,
      userSub: 'kc-sub-reader',
    });
    expect(d.getSnapshot().identity).toMatchObject({ user: true, told: 1 });
  });

  it('after a route entry, once the island was asked to take the case (never before it)', async () => {
    const { dock: d, isl } = await mounted();
    d.enter(B, LAUNCH_B);
    expect(isl.calls.slice(-2)).toEqual([`setCase ${B}`, `identity ${B} kc-sub-reader`]);
    expect(d.getSnapshot().identity?.told).toBe(2);
    // The same route again tells nothing new.
    d.enter(B, LAUNCH_B);
    expect(d.getSnapshot().identity?.told).toBe(2);
  });

  it('a case the island refused while a Submit ends: told the route anyway, so the old case is held', async () => {
    const { dock: d, isl } = await mounted({ setCaseOk: false });
    d.enter(B, LAUNCH_B);
    expect(isl.handle.setViewerIdentity).toHaveBeenLastCalledWith({
      studyInstanceUid: B,
      userSub: 'kc-sub-reader',
    });
    expect(d.getSnapshot().islandCase?.studyRef).not.toBe(d.getSnapshot().routeStudyRef);
  });

  it('a user change seen when the window comes back to the front is told; the same identity is not told twice', async () => {
    const { dock: d, isl, user } = await mounted();
    window.dispatchEvent(new Event('focus'));
    expect(isl.handle.setViewerIdentity).toHaveBeenCalledTimes(1);
    user.value = 'kc-sub-someone-else';
    window.dispatchEvent(new Event('focus'));
    expect(isl.handle.setViewerIdentity).toHaveBeenLastCalledWith({
      studyInstanceUid: A,
      userSub: 'kc-sub-someone-else',
    });
    user.value = null;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(isl.handle.setViewerIdentity).toHaveBeenLastCalledWith({
      studyInstanceUid: A,
      userSub: null,
    });
    expect(d.getSnapshot().identity).toMatchObject({ user: false, told: 3 });
  });

  it('a viewer user that cannot be read is not known (null), never a guess', async () => {
    const { isl } = await mounted({
      viewerUser: () => {
        throw new Error('no service');
      },
    });
    expect(isl.handle.setViewerIdentity).toHaveBeenCalledWith({
      studyInstanceUid: A,
      userSub: null,
    });
    await dock?.destroy();
    const long = await mounted({ viewerUser: () => 'x'.repeat(129) });
    expect(long.isl.handle.setViewerIdentity).toHaveBeenCalledWith({
      studyInstanceUid: A,
      userSub: null,
    });
  });

  it('an island without setViewerIdentity (v1 before PR 4) mounts and switches as before', async () => {
    const { dock: d, isl } = await mounted({ withIdentity: false });
    d.enter(B, LAUNCH_B);
    window.dispatchEvent(new Event('focus'));
    expect(isl.handle.setCase).toHaveBeenCalledWith(B, LAUNCH_B);
    expect(d.getSnapshot()).toMatchObject({ phase: 'mounted', identity: null });
  });
});
