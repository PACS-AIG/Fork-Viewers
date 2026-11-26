import type { Vec3 } from '../anatomy/anatomyGeometry';
import type { CornerstoneApi } from '../anatomy/anatomyOverlay';
import { NOT_ON_SLICES, createRefineGesture } from './refineGesture';
import type { RefineStore } from './refineStore';
import type { RefineViewport } from './refineViewport';

function fakeStore() {
  const calls: Array<[string, ...unknown[]]> = [];
  const store = {
    beginMark: (...a: unknown[]) => calls.push(['begin', ...a]),
    moveMark: (...a: unknown[]) => calls.push(['move', ...a]),
    endMark: (...a: unknown[]) => calls.push(['end', ...a]),
    refuseMark: (...a: unknown[]) => calls.push(['refuse', ...a]),
  } as unknown as RefineStore;
  return { store, calls };
}

const meta = new Map<string, unknown>([
  ['generalSeriesModule|img-2', { seriesInstanceUID: 'series-1' }],
  [
    'imagePlaneModule|img-2',
    {
      frameOfReferenceUID: 'for-1',
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
      rowPixelSpacing: 0.8,
      columnPixelSpacing: 0.6,
    },
  ],
]);
const metaData: CornerstoneApi['metaData'] = { get: (type, id) => meta.get(`${type}|${id}`) };

const element = document.createElement('div');
const stack = (cpu = false): RefineViewport => ({
  id: 'vp-1',
  element,
  canvasToWorld: () => [0, 0, 0],
  getCurrentImageId: () => 'img-2',
  setImageIdIndex: () => undefined,
  useCPURendering: cpu,
});
const at = (world: Vec3, canvas: [number, number]) => ({
  element,
  viewportId: 'vp-1',
  currentPoints: { world, canvas },
});

describe('the refine tool’s gesture', () => {
  it('marks on a stack: down, a drag with its canvas distance, up over the image shown', () => {
    const { store, calls } = fakeStore();
    const g = createRefineGesture({ store: () => store, viewportOf: () => stack(), metaData });
    expect(g.down(at([1, 2, 3], [10, 10]))).toBe(true);
    expect(g.marking).toBe(true);
    g.drag(at([4, 6, 3], [13, 14]));
    g.up(at([4, 6, 3], [13, 14]));
    expect(g.marking).toBe(false);
    expect(calls).toEqual([
      ['begin', 'vp-1', [1, 2, 3]],
      ['move', [4, 6, 3], 5],
      ['move', [4, 6, 3], 5],
      ['end', { seriesUID: 'series-1', frameOfReferenceUID: 'for-1', imageId: 'img-2' }],
    ]);
  });

  it('takes the CPU path’s half pixel off the mark’s points', () => {
    const { store, calls } = fakeStore();
    const g = createRefineGesture({ store: () => store, viewportOf: () => stack(true), metaData });
    g.down(at([1, 2, 3], [10, 10]));
    expect(calls[0]).toEqual(['begin', 'vp-1', [1 - 0.3, 2 - 0.4, 3]]);
  });

  it('refuses a mark on a volume viewport (a reformat), and keeps the mouse-down', () => {
    const { store, calls } = fakeStore();
    const volume = { ...stack(), setImageIdIndex: undefined };
    const g = createRefineGesture({ store: () => store, viewportOf: () => volume, metaData });
    expect(g.down(at([1, 2, 3], [10, 10]))).toBe(true);
    expect(g.marking).toBe(false);
    expect(calls).toEqual([['refuse', 'vp-1', NOT_ON_SLICES]]);
  });

  it('leaves the mouse alone while the pane has no refine store', () => {
    const g = createRefineGesture({ store: () => null, viewportOf: () => stack(), metaData });
    expect(g.down(at([1, 2, 3], [10, 10]))).toBe(false);
  });

  it('ends a mark it lost the viewport of with nothing shown', () => {
    const { store, calls } = fakeStore();
    let vp: RefineViewport | null = stack();
    const g = createRefineGesture({ store: () => store, viewportOf: () => vp, metaData });
    g.down(at([1, 2, 3], [10, 10]));
    vp = null;
    g.up(undefined);
    expect(calls.at(-1)).toEqual(['end', null]);
  });
});
