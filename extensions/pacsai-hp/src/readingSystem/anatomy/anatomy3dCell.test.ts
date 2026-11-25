import {
  ANATOMY3D_SOP_CLASS_HANDLER_ID,
  createAnatomy3dCell,
  currentAnatomy3dCell,
  seriesWithSurfaces,
  type Anatomy3dCell,
} from './anatomy3dCell';
import type { AnatomySnapshot, AnatomyStore } from './anatomyStore';
import { fakeViewerServices } from './anatomyTestData';

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};

/** An anatomy store as the cell reads it: a series whose surfaces are offered, or not. */
function fakeStore(offered: boolean) {
  const listeners = new Set<() => void>();
  const snapOf = (on: boolean) =>
    ({
      series: [
        { index: 0, tasks: [{ task: 'total', surfaces: { status: on ? 'ready' : 'none' } }] },
      ],
    }) as unknown as AnatomySnapshot;
  let snap = snapOf(offered);
  return {
    getSnapshot: () => snap,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    offer(on: boolean) {
      snap = snapOf(on);
      listeners.forEach(l => l());
    },
  };
}

function setup(o: { offered?: boolean; webgl?: boolean; setting?: string | null } = {}) {
  const v = fakeViewerServices({ numRows: 1, numCols: 1, ids: ['ax'] });
  const store = fakeStore(o.offered ?? true);
  let kept: string | null = o.setting ?? null;
  const cell: Anatomy3dCell = createAnatomy3dCell({
    services: v.services,
    store: store as unknown as AnatomyStore,
    storage: { get: () => kept, set: value => (kept = value) },
    webgl: () => o.webgl ?? true,
    lookMs: 0,
  });
  return { v, store, cell, kept: () => kept };
}

let made: Anatomy3dCell[] = [];
afterEach(() => {
  made.forEach(c => c.destroy());
  made = [];
});

describe("the 3D anatomy cell in the viewer's grid (RS-36)", () => {
  it("joins the protocol's layout once the surfaces are offered, its display set the cell's own", async () => {
    const { v, store, cell } = setup({ offered: false });
    made.push(cell);
    await flush();
    cell.enter('study-1');
    v.hp.hang(1, 1, ['ax']);
    await flush();
    expect(v.layout()).toBe('1x1');
    expect(cell.shown()).toBe(false);
    // The surfaces come: the protocol's layout gains the cell, last.
    store.offer(true);
    await flush();
    expect(v.layout()).toBe('1x2');
    expect(v.ids()).toEqual(['ax', 'pacsai-anatomy-3d-1']);
    expect(v.boxOf('ax')).toEqual([0, 0, 0.5, 1]);
    expect(cell.shown()).toBe(true);
    expect(cell.harnessState()).toMatchObject({
      setting: true,
      shown: true,
      out: false,
      fromProtocol: true,
      layout: '1x2',
      panes: 2,
      cellPane: 1,
      series: 0,
    });
    // Its display set: no images, out of the series list, of the route's study, named for its viewport.
    expect([...v.sets.values()]).toEqual([
      expect.objectContaining({
        StudyInstanceUID: 'study-1',
        SOPClassHandlerId: ANATOMY3D_SOP_CLASS_HANDLER_ID,
        isAnatomy3D: true,
        excludeFromThumbnailBrowser: true,
        numImageFrames: 0,
        madeInClient: false,
      }),
    ]);
    expect(currentAnatomy3dCell()).toBe(cell);
  });

  it("grows each protocol layout as agreed, and leaves the reader's own layouts alone", async () => {
    const { v, cell } = setup();
    made.push(cell);
    cell.enter('study-1');
    await flush();
    v.hp.hang(1, 3, ['ax', 'cor', 'sag']);
    await flush();
    expect(v.layout()).toBe('2x2');
    expect(v.ids()).toEqual(['ax', 'cor', 'sag', 'pacsai-anatomy-3d-2']);
    expect(v.boxOf('sag')).toEqual([0, 0.5, 0.5, 0.5]);
    v.hp.hang(2, 2, ['a', 'b', 'c', 'd']);
    await flush();
    expect(v.layout()).toBe('2x3');
    expect(v.boxOf('pacsai-anatomy-3d-3')).toEqual([0.667, 0, 0.333, 1]);
    // The reader's layout (the layout button), or OHIF's one-up: no cell added.
    await v.grid.setLayout({
      numRows: 1,
      numCols: 1,
      findOrCreateViewport: () => ({
        displaySetInstanceUIDs: ['ds-a'],
        viewportOptions: { viewportId: 'a' },
      }),
    });
    await flush();
    expect(v.layout()).toBe('1x1');
    expect(cell.shown()).toBe(false);
    expect(cell.harnessState()).toMatchObject({ fromProtocol: false });
    // The next stage is the protocol's again: the cell comes back.
    v.hp.hang(1, 2, ['cur', 'pri']);
    await flush();
    expect(v.layout()).toBe('1x3');
    expect(v.ids()).toEqual(['cur', 'pri', 'pacsai-anatomy-3d-4']);
  });

  it('joins the last of two protocol layouts in a row (the first case, then an immediate re-hang)', async () => {
    const { v, cell } = setup();
    made.push(cell);
    cell.enter('study-1');
    await flush();
    v.hp.hang(1, 1, ['ax']);
    v.hp.hang(1, 2, ['cur', 'pri']);
    await flush();
    expect(v.layout()).toBe('1x3');
    expect(v.ids()).toEqual(['cur', 'pri', expect.stringMatching(/^pacsai-anatomy-3d-/)]);
    expect(cell.harnessState()).toMatchObject({ fromProtocol: true, shown: true });
  });

  it("comes back with a stage OHIF puts back as it was, and goes out to that stage's own layout", async () => {
    const { v, cell } = setup();
    made.push(cell);
    cell.enter('study-1');
    await flush();
    v.hp.hang(1, 3, ['ax', 'cor', 'sag']);
    await flush();
    expect(v.layout()).toBe('2x2');
    const first = v.snapshot();
    v.hp.hang(1, 2, ['cur', 'pri']);
    await flush();
    expect(v.layout()).toBe('1x3');
    // Back to the first stage, which OHIF puts back as it was: its three viewports and the cell.
    v.hp.restore({ ids: ['ax', 'cor', 'sag'], rows: 1, cols: 3 }, 2, 2, first);
    await flush();
    expect([v.layout(), cell.shown()]).toEqual(['2x2', true]);
    // The 3D button: that stage's own 1x3, not the other stage's layout, nor a square grid.
    cell.toggle();
    await flush();
    expect([v.layout(), v.ids()]).toEqual(['1x3', ['ax', 'cor', 'sag']]);
    expect(v.boxOf('sag')).toEqual([0.667, 0, 0.333, 1]);
    cell.toggle();
    await flush();
    expect(v.layout()).toBe('2x2');
    // A series dropped on the cell OHIF brought back takes it out, as on any cell.
    v.hp.hang(1, 2, ['cur', 'pri']);
    await flush();
    v.hp.restore({ ids: ['ax', 'cor', 'sag'], rows: 1, cols: 3 }, 2, 2, first);
    await flush();
    v.grid.drop(v.ids()[3], 'ds-other');
    await flush();
    expect(cell.harnessState()).toMatchObject({ shown: false, out: true });
  });

  it('goes with the setting off, the stage as the protocol laid it out, and comes back with it on', async () => {
    const { v, cell, kept } = setup();
    made.push(cell);
    cell.enter('study-1');
    await flush();
    v.hp.hang(1, 2, ['cur', 'pri']);
    await flush();
    expect(v.layout()).toBe('1x3');
    cell.setSetting(false);
    await flush();
    expect(kept()).toBe('off');
    expect(v.layout()).toBe('1x2');
    expect(v.ids()).toEqual(['cur', 'pri']);
    expect(v.boxOf('pri')).toEqual([0.5, 0, 0.5, 1]);
    expect(cell.inGrid()).toBe(false);
    // Off: the protocol's next layout stays as it is.
    v.hp.hang(1, 1, ['ax']);
    await flush();
    expect(v.layout()).toBe('1x1');
    cell.setSetting(true);
    await flush();
    expect(kept()).toBe('on');
    expect(v.layout()).toBe('1x2');
  });

  it("is taken out by the 3D button, the cell's x or a series dropped on it, and stays out for the study", async () => {
    const { v, cell } = setup();
    made.push(cell);
    cell.enter('study-1');
    await flush();
    v.hp.hang(1, 2, ['cur', 'pri']);
    await flush();
    // The 3D button: out, the protocol's layout put back; out across the protocol's next layout.
    cell.toggle();
    await flush();
    expect(v.layout()).toBe('1x2');
    expect(cell.harnessState()).toMatchObject({ shown: false, out: true });
    v.hp.hang(1, 2, ['cur', 'pri']);
    await flush();
    expect(cell.shown()).toBe(false);
    // In again, into the layout there is.
    cell.toggle();
    await flush();
    expect(v.layout()).toBe('1x3');
    // The cell's x.
    cell.hide();
    await flush();
    expect([v.layout(), cell.shown()]).toEqual(['1x2', false]);
    cell.toggle();
    await flush();
    // A series dropped on the cell: the reader's choice, out until the 3D button.
    const cellId = v.ids()[2];
    v.grid.drop(cellId, 'ds-other');
    await flush();
    expect(cell.harnessState()).toMatchObject({ shown: false, out: true });
    expect(v.layout()).toBe('1x3');
    // Another study: in again.
    cell.enter('study-2');
    v.hp.hang(1, 1, ['ax']);
    await flush();
    expect([v.layout(), cell.shown()]).toEqual(['1x2', true]);
    expect([...v.sets.values()].map(s => s.StudyInstanceUID)).toEqual(['study-1', 'study-2']);
  });

  it('never joins without WebGL or surfaces, nor when switched off at the start, and stops listening when destroyed', async () => {
    const none = setup({ webgl: false });
    made.push(none.cell);
    none.cell.enter('study-1');
    none.v.hp.hang(1, 1, ['ax']);
    await flush();
    expect([none.v.layout(), none.cell.inGrid()]).toEqual(['1x1', false]);
    const off = setup({ setting: 'off' });
    made.push(off.cell);
    off.cell.enter('study-1');
    off.v.hp.hang(1, 1, ['ax']);
    await flush();
    expect([off.v.layout(), off.cell.setting()]).toEqual(['1x1', false]);
    const bare = setup({ offered: false });
    made.push(bare.cell);
    bare.cell.enter('study-1');
    bare.v.hp.hang(1, 1, ['ax']);
    await flush();
    expect(bare.v.layout()).toBe('1x1');
    bare.cell.destroy();
    bare.store.offer(true);
    bare.v.hp.hang(1, 1, ['ax']);
    await flush();
    expect(bare.v.layout()).toBe('1x1');
    expect(currentAnatomy3dCell()).not.toBe(bare.cell);
  });

  it('finds the first series that offers surfaces', () => {
    const snap = (statuses: string[][]) =>
      ({
        series: statuses.map((ts, index) => ({
          index,
          tasks: ts.map(status => ({ surfaces: { status } })),
        })),
      }) as unknown as AnatomySnapshot;
    expect(seriesWithSurfaces(snap([['none'], ['withheld', 'loading']]))).toBe(1);
    expect(seriesWithSurfaces(snap([['none', 'withheld']]))).toBeNull();
  });
});
