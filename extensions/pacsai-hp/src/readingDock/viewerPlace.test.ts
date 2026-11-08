/**
 * F58's images place, put back (viewerPlace.restore). Milestone 7 (8 Nov):
 * Arrange's Cancel from a 1×3 preview back to 1×2 found the zoom left wrong —
 * the viewport still settling when the held view was applied, and the check
 * after it looking at the slice and window only. The check now compares the
 * zoom and pan too, and a later one puts back the zoom and pan alone, only
 * while the slice and window are still the held ones.
 */
import { createViewerPlace, VIEW_LATE_SETTLE_MS, VIEW_SETTLE_MS } from './viewerPlace';

type View = {
  idx: number;
  zoom: number;
  pan: [number, number];
  voi: { lower: number; upper: number };
};

function fakeViewer(initial: View) {
  const view: View = {
    ...initial,
    pan: [...initial.pan] as [number, number],
    voi: { ...initial.voi },
  };
  const presentations: Array<{ zoom: number; pan: [number, number] }> = [];
  const cs = {
    getViewReference: () => ({ sliceIndex: view.idx }),
    setViewReference: (ref: { sliceIndex: number }) => {
      view.idx = ref.sliceIndex;
    },
    getViewPresentation: () => ({ zoom: view.zoom, pan: [...view.pan], rotation: 0 }),
    setViewPresentation: (p: { zoom: number; pan: [number, number] }) => {
      presentations.push({ zoom: p.zoom, pan: [...p.pan] as [number, number] });
      view.zoom = p.zoom;
      view.pan = [...p.pan] as [number, number];
    },
    getProperties: () => ({ voiRange: { ...view.voi } }),
    setProperties: (p: { voiRange: { lower: number; upper: number } }) => {
      view.voi = { ...p.voiRange };
    },
    getCurrentImageIdIndex: () => view.idx,
    getCurrentImageId: () => 'img',
    render: () => undefined,
  };
  const grid = {
    layout: { numRows: 1, numCols: 2 },
    viewports: new Map([
      ['vp-0', { viewportId: 'vp-0', positionId: '0-0', displaySetInstanceUIDs: ['ds-1'] }],
    ]),
    activeViewportId: 'vp-0',
  };
  const services = {
    viewportGridService: {
      getState: () => grid,
      setLayout: jest.fn(),
      getLayoutOptionsFromState: () => [],
      getDisplaySetsUIDsForViewport: () => ['ds-1'],
      setActiveViewportId: jest.fn(),
    },
    cornerstoneViewportService: { getCornerstoneViewport: () => cs },
    displaySetService: {
      getDisplaySetByUID: () => ({ displaySetInstanceUID: 'ds-1', SeriesNumber: 4 }),
      getActiveDisplaySets: () => [],
    },
  };
  return { view, presentations, place: createViewerPlace(() => services as never, window) };
}

const HELD: View = { idx: 98, zoom: 1.4, pan: [3, -2], voi: { lower: -200, upper: 300 } };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** Runs a restore to its end, letting the given step happen at a time after it starts. */
async function restoreWith(f: ReturnType<typeof fakeViewer>, at: number, step: () => void) {
  const held = f.place.capture();
  // The preview changed the view; the restore starts from there.
  Object.assign(f.view, { idx: 10, zoom: 0.5, pan: [0, 0], voi: { lower: 0, upper: 80 } });
  const done = f.place.restore(held!);
  let elapsed = 0;
  let stepped = false;
  const total = VIEW_SETTLE_MS + VIEW_LATE_SETTLE_MS + 50;
  while (elapsed < total) {
    if (!stepped && elapsed >= at) {
      step();
      stepped = true;
    }
    await jest.advanceTimersByTimeAsync(50);
    elapsed += 50;
  }
  await done;
}

describe('F58: putting the held view back (zoom and pan, milestone 7)', () => {
  it('puts back slice, window, zoom and pan', async () => {
    const f = fakeViewer(HELD);
    await restoreWith(f, 0, () => undefined);
    expect(f.view).toEqual(HELD);
  });

  it('a zoom undone before the first check is put back by it, before the later one', async () => {
    const f = fakeViewer(HELD);
    const held = f.place.capture();
    Object.assign(f.view, { idx: 10, zoom: 0.5, pan: [0, 0], voi: { lower: 0, upper: 80 } });
    const done = f.place.restore(held!);
    await jest.advanceTimersByTimeAsync(VIEW_SETTLE_MS - 100);
    f.view.zoom = 0.37;
    await jest.advanceTimersByTimeAsync(150);
    // Past the first check, well before the later one.
    expect(f.view.zoom).toBe(1.4);
    await jest.advanceTimersByTimeAsync(VIEW_LATE_SETTLE_MS + 100);
    await done;
    expect(f.view).toEqual(HELD);
  });

  it('a zoom undone after the first check is put back by the later one', async () => {
    const f = fakeViewer(HELD);
    await restoreWith(f, VIEW_SETTLE_MS + 200, () => {
      f.view.zoom = 0.37;
      f.view.pan = [0, 0];
    });
    expect(f.view.zoom).toBe(1.4);
    expect(f.view.pan).toEqual([3, -2]);
  });

  it('the later check leaves a reader who scrolled since alone', async () => {
    const f = fakeViewer(HELD);
    await restoreWith(f, VIEW_SETTLE_MS + 200, () => {
      f.view.idx = 120;
      f.view.zoom = 2.0;
    });
    expect(f.view.idx).toBe(120);
    expect(f.view.zoom).toBe(2.0);
  });
});
