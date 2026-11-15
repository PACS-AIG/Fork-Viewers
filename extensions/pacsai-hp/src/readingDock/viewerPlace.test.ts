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

/**
 * Rev 11 milestone 25, PR 6 (F61's selection message, F87): what the reader is
 * looking at, for the report: the active viewport's study, series and image,
 * the measurement selected, today's study or a prior. Identifiers only.
 */
import { sopInstanceOf } from './viewerPlace';

describe("the reader's selection (milestone 25, PR 6)", () => {
  const ROUTE = '1.2.840.9.1';
  const PRIOR = '1.2.840.9.2';
  function fakeServices() {
    const state = {
      layout: { numRows: 1, numCols: 2 },
      viewports: new Map([
        ['vp-a', { viewportId: 'vp-a', displaySetInstanceUIDs: ['ds-a'] }],
        ['vp-b', { viewportId: 'vp-b', displaySetInstanceUIDs: ['ds-b'] }],
      ]),
      activeViewportId: 'vp-a' as string | null,
    };
    const imageIds: Record<string, string> = {
      'vp-a':
        'wadors:https://pacs.example/dicom-web/studies/1.2.840.9.1/series/1.2.840.9.1.4/instances/1.2.840.9.1.4.7/frames/1',
      'vp-b':
        'wadouri:https://pacs.example/wado?requestType=WADO&studyUID=1.2.840.9.2&objectUID=1.2.840.9.2.3.5',
    };
    const measurements: Array<{ uid: string; isSelected: boolean }> = [
      { uid: 'm-1', isSelected: false },
      { uid: '5e1c-a2', isSelected: false },
    ];
    const displaySets: Record<string, Record<string, unknown>> = {
      'ds-a': {
        displaySetInstanceUID: 'ds-a',
        StudyInstanceUID: ROUTE,
        SeriesInstanceUID: '1.2.840.9.1.4',
        PatientName: 'never told',
      },
      'ds-b': {
        displaySetInstanceUID: 'ds-b',
        StudyInstanceUID: PRIOR,
        SeriesInstanceUID: '1.2.840.9.2.3',
      },
    };
    const services = {
      viewportGridService: {
        getState: () => state,
        setLayout: () => undefined,
        getLayoutOptionsFromState: () => ({}),
        setActiveViewportId: (id: string) => {
          state.activeViewportId = id;
        },
      },
      cornerstoneViewportService: {
        getCornerstoneViewport: (id: string) => ({ getCurrentImageId: () => imageIds[id] }),
      },
      displaySetService: {
        getDisplaySetByUID: (uid: string) => displaySets[uid] as never,
        getActiveDisplaySets: () => [],
      },
      measurementService: { getMeasurements: () => measurements },
    };
    return { services, state, imageIds, measurements };
  }

  it("names today's image by its UIDs, then a prior's, with the measurement selected", () => {
    const f = fakeServices();
    const place = createViewerPlace(() => f.services as never, window);
    expect(place.selection(ROUTE)).toEqual({
      studyInstanceUid: ROUTE,
      seriesInstanceUid: '1.2.840.9.1.4',
      sopInstanceUid: '1.2.840.9.1.4.7',
      measurement: null,
      timepoint: 'current',
    });
    f.state.activeViewportId = 'vp-b';
    f.measurements[1].isSelected = true;
    expect(place.selection(ROUTE)).toEqual({
      studyInstanceUid: PRIOR,
      seriesInstanceUid: '1.2.840.9.2.3',
      sopInstanceUid: '1.2.840.9.2.3.5',
      measurement: '5e1c-a2',
      timepoint: 'prior',
    });
    expect(JSON.stringify(place.selection(ROUTE))).not.toContain('never told');
  });

  it('none without a route study, an active viewport, a series in it, or services; an unreadable image is null', () => {
    const f = fakeServices();
    const place = createViewerPlace(() => f.services as never, window);
    expect(place.selection(null)).toBeNull();
    f.state.activeViewportId = null;
    expect(place.selection(ROUTE)).toBeNull();
    f.state.activeViewportId = 'vp-a';
    f.imageIds['vp-a'] = 'blob:not-dicom';
    expect(place.selection(ROUTE)?.sopInstanceUid).toBeNull();
    expect(createViewerPlace(() => null, window).selection(ROUTE)).toBeNull();
  });

  it("an image's SOP instance: the display set's own entry first, else the one its imageId names", () => {
    expect(sopInstanceOf('x:1', [{ imageId: 'x:1', SOPInstanceUID: '1.2.3' }])).toBe('1.2.3');
    expect(sopInstanceOf('wadors:/studies/1/series/2/instances/1.2.4/frames/1')).toBe('1.2.4');
    expect(sopInstanceOf('wadouri:/wado?objectUID=1.2.5&x=1')).toBe('1.2.5');
    expect(sopInstanceOf('wadors:/instances/1.2.x/frames/1')).toBeNull();
    expect(sopInstanceOf(null)).toBeNull();
  });
});
