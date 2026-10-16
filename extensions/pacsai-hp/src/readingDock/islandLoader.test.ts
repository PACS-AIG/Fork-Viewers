import {
  FLAGS_PATH,
  ISLAND_LOADER_PATH,
  handleSpeaksV1,
  launchFromQuery,
  loadIsland,
  routeStudyOf,
} from './islandLoader';

const v1Module = {
  ISLAND_API: 'pacsai.reportIsland',
  ISLAND_API_VERSION: 1,
  ISLAND_BUILD: '1ef3c71',
  mountReportEditor: () => null,
};
const answer = (status: number, body: unknown = {}) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

describe('loadIsland', () => {
  it('asks the flags first, then imports the loader, and accepts v1', async () => {
    const asked: string[] = [];
    const r = await loadIsland({
      fetchFn: async (url, init) => {
        asked.push(`${url} ${JSON.stringify(init)}`);
        return answer(200, { viewerHost: true })();
      },
      importFn: async url => {
        asked.push(url);
        return v1Module;
      },
    });
    expect(r).toMatchObject({ ok: true, build: '1ef3c71' });
    expect(asked).toEqual([`${FLAGS_PATH} {"credentials":"same-origin","cache":"no-store"}`, ISLAND_LOADER_PATH]);
  });

  it('never imports when the app does not serve the island (WORKSPACE_VIEWER_HOST off)', async () => {
    const importFn = jest.fn();
    const r = await loadIsland({ fetchFn: answer(200, { viewerHost: false, caseSwitch: true }), importFn });
    expect(r).toEqual({ ok: false, failure: 'VIEWER_HOST_OFF' });
    expect(importFn).not.toHaveBeenCalled();
  });

  it('a 401 is no app session; any other answer or none is unreadable', async () => {
    const importFn = jest.fn();
    expect(await loadIsland({ fetchFn: answer(401), importFn })).toEqual({ ok: false, failure: 'APP_SIGNED_OUT' });
    expect(await loadIsland({ fetchFn: answer(500), importFn })).toMatchObject({ ok: false, failure: 'FLAGS_UNREADABLE' });
    expect(
      await loadIsland({
        fetchFn: async () => {
          throw new Error('offline');
        },
        importFn,
      })
    ).toMatchObject({ ok: false, failure: 'FLAGS_UNREADABLE', detail: 'offline' });
    expect(importFn).not.toHaveBeenCalled();
  });

  it('refuses a module of another api or version, and says so', async () => {
    const r = await loadIsland({
      fetchFn: answer(200, { viewerHost: true }),
      importFn: async () => ({ ...v1Module, ISLAND_API_VERSION: 2 }),
    });
    expect(r).toEqual({ ok: false, failure: 'ISLAND_VERSION_MISMATCH', detail: 'pacsai.reportIsland v2' });
    const failed = await loadIsland({
      fetchFn: answer(200, { viewerHost: true }),
      importFn: async () => {
        throw new Error('404');
      },
    });
    expect(failed).toMatchObject({ ok: false, failure: 'ISLAND_LOAD_FAILED' });
  });

  it("checks the handle's api and version too", () => {
    const h = {
      api: 'pacsai.reportIsland',
      version: 1,
      setCase: () => null,
      setVisibility: () => null,
      setFocus: () => null,
      settle: () => null,
      unmount: () => null,
    };
    expect(handleSpeaksV1(h)).toBe(true);
    expect(handleSpeaksV1({ ...h, version: 2 })).toBe(false);
    expect(handleSpeaksV1({ ...h, settle: undefined })).toBe(false);
    expect(handleSpeaksV1(null)).toBe(false);
  });
});

describe('the route', () => {
  it("reads the route's first study, as the island accepts one", () => {
    expect(routeStudyOf('?StudyInstanceUIDs=1.2.3,4.5.6&gatewayAET=X')).toBe('1.2.3');
    expect(routeStudyOf('?StudyInstanceUIDs=')).toBeNull();
    expect(routeStudyOf('?StudyInstanceUIDs=1.2.x')).toBeNull();
    expect(routeStudyOf('')).toBeNull();
  });

  it('carries the launch only when both halves are valid', () => {
    expect(launchFromQuery('?attempt=att-1&attemptT0=1760000000000')).toEqual({ attempt: 'att-1', attemptT0: 1760000000000 });
    expect(launchFromQuery('?attempt=att-1')).toBeUndefined();
    expect(launchFromQuery('?attempt=a b&attemptT0=1')).toBeUndefined();
    expect(launchFromQuery('?attempt=att-1&attemptT0=0')).toBeUndefined();
  });
});
