import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { readAnatomy } from './anatomyContract';
import { createAnatomyOverlay, type CornerstoneApi, type OverlayServices } from './anatomyOverlay';
import { createAnatomyStore } from './anatomyStore';
import {
  AFFINE,
  CAVITIES,
  GRID,
  ORGANS,
  SERIES,
  STUDY,
  VERTEBRAE,
  makeAnatomyDoc,
  makeNifti,
} from './anatomyTestData';

// A stand-in for what the overlay uses of @cornerstonejs/core.
const cs = {
  listeners: new Map<string, Set<(e: unknown) => void>>(),
  enabled: new Map<unknown, { viewport: unknown }>(),
  meta: new Map<string, unknown>(),
};
const cornerstone: CornerstoneApi = {
  Enums: {
    Events: {
      IMAGE_RENDERED: 'CORNERSTONE_IMAGE_RENDERED',
      ELEMENT_ENABLED: 'CORNERSTONE_ELEMENT_ENABLED',
      ELEMENT_DISABLED: 'CORNERSTONE_ELEMENT_DISABLED',
    },
  },
  eventTarget: {
    addEventListener: (type, fn) => {
      if (!cs.listeners.has(type)) {
        cs.listeners.set(type, new Set());
      }
      cs.listeners.get(type)!.add(fn as (e: unknown) => void);
    },
    removeEventListener: (type, fn) => {
      cs.listeners.get(type)?.delete(fn as (e: unknown) => void);
    },
  },
  getEnabledElement: el => cs.enabled.get(el),
  getRenderingEngines: () => [],
  metaData: { get: (type, id) => cs.meta.get(`${type}|${id}`) },
};
const fire = (type: string, detail: unknown) =>
  cs.listeners.get(type)?.forEach(fn => fn({ detail }));

// A 2D context that keeps what was put on it.
interface FakeImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
const puts: FakeImage[] = [];
let clears = 0;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      createImageData: (w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: (img: FakeImage) => puts.push({ ...img, data: img.data.slice() }),
      clearRect: () => {
        clears++;
      },
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const frames: Array<() => void> = [];
const win = {
  document,
  requestAnimationFrame: (cb: () => void) => frames.push(cb),
} as unknown as Window;
const runFrames = () => {
  while (frames.length) {
    frames.shift()!();
  }
};
const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function loadedStore() {
  const base: Record<string, number[]> = {
    trunk_cavities: CAVITIES,
    total: ORGANS,
    vertebrae_pp: VERTEBRAE,
  };
  const files: Record<string, Uint8Array> = {};
  const raw = makeAnatomyDoc();
  for (const lm of raw.series[0].labelmaps as Array<{ task: string; sha256: string }>) {
    const f = new Uint8Array(
      gzipSync(makeNifti({ dims: [GRID.nx, GRID.ny, GRID.nz], data: base[lm.task], sform: AFFINE }))
    );
    files[`0.${lm.task}.labels.nii.gz`] = f;
    lm.sha256 = sha(f);
  }
  const store = createAnatomyStore({
    client: {
      anatomy: async () => readAnatomy(raw, 'clinical'),
      anatomyFile: async (_s: string, b: string) => files[b],
    },
    digest: async b => sha(b),
    gunzip: async b => new Uint8Array(gunzipSync(b)),
    studyRef: () => 'ref',
  });
  store.enter(STUDY);
  await flush();
  return store;
}

/** Test image k's metadata, as cornerstone's provider would answer it. */
function registerImages(series: string, prefix: string, shift = 0) {
  for (let k = 0; k < GRID.nz; k++) {
    cs.meta.set(`generalSeriesModule|${prefix}${k}`, { seriesInstanceUID: series });
    cs.meta.set(`imagePlaneModule|${prefix}${k}`, {
      imagePositionPatient: [-8 + shift, -6, 10 + 3 * k],
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
      rowPixelSpacing: 2,
      columnPixelSpacing: 2,
    });
  }
}

/**
 * A viewport showing image `slice` of a stack, one CSS pixel per image pixel,
 * pixel (0, 0)'s centre at (0.5, 0.5). With `cpu`, its world is cornerstone's
 * CPU path's: the first pixel's corner, not its centre, at ImagePositionPatient.
 */
function viewport(id: string, prefix: string, slice = 3, cpu = false) {
  const element = document.createElement('div');
  const inner = document.createElement('div');
  inner.className = 'viewport-element';
  const canvas = document.createElement('canvas');
  canvas.className = 'cornerstone-canvas';
  inner.append(canvas);
  element.append(inner);
  document.body.append(element);
  Object.defineProperty(inner, 'clientWidth', { value: GRID.nx });
  Object.defineProperty(inner, 'clientHeight', { value: GRID.ny });
  const state = { slice };
  const vp = {
    id,
    element,
    getImageIds: () => Array.from({ length: GRID.nz }, (_, k) => `${prefix}${k}`),
    getCurrentImageId: () => `${prefix}${state.slice}`,
    useCPURendering: cpu,
    canvasToWorld: ([x, y]: [number, number]) => [
      -8 + 2 * (cpu ? x : x - 0.5),
      -6 + 2 * (cpu ? y : y - 0.5),
      10 + 3 * state.slice,
    ],
    setImageIdIndex: jest.fn((index: number) => {
      state.slice = index;
    }) as jest.Mock | undefined,
    jumpToWorld: jest.fn((world: number[]) => {
      state.slice = Math.round((world[2] - 10) / 3);
      return true;
    }),
  };
  cs.enabled.set(element, { viewport: vp });
  return { element, inner, vp, state };
}

// ---- other series of the acquisition ------------------------------------------------
/** An instance as OHIF naturalizes it (made up; the test grid's frame of reference). */
const instance = (imageId: string, over: Record<string, unknown> = {}) => ({
  imageId,
  FrameOfReferenceUID: '2.25.1003',
  Modality: 'CT',
  ImageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'],
  AcquisitionDate: '20261124',
  AcquisitionTime: '101500',
  ...over,
});
const displaySet = (
  uid: string,
  series: string,
  ids: string[],
  over: Record<string, unknown> = {}
) => ({
  displaySetInstanceUID: uid,
  SeriesInstanceUID: series,
  instances: ids.map(id => instance(id, over)),
});
const nativeSet = (prefix = 'a') =>
  displaySet(
    'ds-ct',
    SERIES,
    Array.from({ length: GRID.nz }, (_, k) => `${prefix}${k}`)
  );
const REFORMAT = { ImageType: ['DERIVED', 'PRIMARY', 'AXIAL', 'MPR'] };
const COR = '2.25.1010';
/** The coronal reformat's images, anterior first: LPS y of each. */
const CORONAL_YS = [4, 2, 0, -2, -4, -6];
const idsOf = (prefix: string, ys: number[]) => ys.map((_, n) => `${prefix}${n}`);

/**
 * A coronal reformat's metadata: an image per LPS y, 8 columns of 2 mm along
 * +x and 9 rows of 1.5 mm from z = `top` down (the labelmap's slices are 3 mm
 * apart, so each covers two rows).
 */
function registerCoronal(series: string, prefix: string, ys: number[], top = 22) {
  ys.forEach((y, n) => {
    cs.meta.set(`generalSeriesModule|${prefix}${n}`, { seriesInstanceUID: series });
    cs.meta.set(`imagePlaneModule|${prefix}${n}`, {
      imagePositionPatient: [-8, y, top],
      rowCosines: [1, 0, 0],
      columnCosines: [0, 0, -1],
      rowPixelSpacing: 1.5,
      columnPixelSpacing: 2,
      rows: 9,
      columns: 8,
    });
  });
}

/** A stack viewport on a coronal reformat, one CSS pixel per image pixel (as `viewport`). */
function coronalViewport(
  id: string,
  prefix: string,
  ys: number[],
  index: number,
  cpu = false,
  top = 22
) {
  const element = document.createElement('div');
  const inner = document.createElement('div');
  inner.className = 'viewport-element';
  element.append(inner);
  document.body.append(element);
  Object.defineProperty(inner, 'clientWidth', { value: 8 });
  Object.defineProperty(inner, 'clientHeight', { value: 9 });
  const state = { index };
  const vp = {
    id,
    element,
    getImageIds: () => idsOf(prefix, ys),
    getCurrentImageId: () => `${prefix}${state.index}`,
    useCPURendering: cpu,
    canvasToWorld: ([x, y]: [number, number]) => [
      -8 + 2 * (cpu ? x : x - 0.5),
      ys[state.index],
      top - 1.5 * (cpu ? y : y - 0.5),
    ],
    setImageIdIndex: jest.fn((n: number) => {
      state.index = n;
    }),
    jumpToWorld: jest.fn(() => true),
  };
  cs.enabled.set(element, { viewport: vp });
  return { element, inner, vp, state };
}

const rendered = (el: HTMLElement) =>
  el.dispatchEvent(new CustomEvent('CORNERSTONE_IMAGE_RENDERED'));
const last = () => puts[puts.length - 1];
const alphaAt = (img: FakeImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

afterEach(() => {
  document.body.innerHTML = '';
  cs.enabled.clear();
  cs.meta.clear();
  cs.listeners.clear();
  puts.length = 0;
  frames.length = 0;
  clears = 0;
});

describe('the anatomy layers on the viewports (RS-36)', () => {
  it("puts a canvas of its own between cornerstone's canvas and the annotations, and draws the shown slice's structures", async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    const { element, inner } = viewport('vp1', 'a');
    const overlay = createAnatomyOverlay({ store, services: null, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element });
    const layer = inner.querySelector('canvas[data-pacsai-anatomy-layer]') as HTMLCanvasElement;
    expect(layer).not.toBeNull();
    expect(layer.previousElementSibling?.className).toBe('cornerstone-canvas');
    expect(layer.style.pointerEvents).toBe('none');
    rendered(element);
    runFrames();
    const img = last();
    expect([img.width, img.height]).toEqual([GRID.nx, GRID.ny]);
    expect(alphaAt(img, 1, 1)).toBeGreaterThan(0); // the liver on slice 3
    expect(alphaAt(img, 6, 4)).toBeGreaterThan(0); // the spleen
    expect(alphaAt(img, 4, 0)).toBe(0); // nothing (the cavities start hidden)
    expect(overlay.harnessState()).toMatchObject({ viewports: [{ drawn: 18, anatomy: true }] });
    // The same view rendered again is not drawn again.
    rendered(element);
    runFrames();
    expect(puts).toHaveLength(1);
    overlay.destroy();
  });

  it("draws over the image cornerstone's CPU path draws, half a pixel from DICOM's positions, and names what is under the cursor there", async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    const { element, inner } = viewport('vp1', 'a', 3, true);
    const overlay = createAnatomyOverlay({ store, services: null, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element });
    rendered(element);
    runFrames();
    const img = last();
    // Canvas pixel x shows image pixel x: the liver is columns and rows 0-2, not 1-3.
    expect(
      [alphaAt(img, 0, 0), alphaAt(img, 2, 2), alphaAt(img, 3, 1), alphaAt(img, 1, 3)].map(
        a => a > 0
      )
    ).toEqual([true, true, false, false]);
    expect(overlay.harnessState()).toMatchObject({ viewports: [{ drawn: 18 }] });
    const tip = inner.querySelector('[data-pacsai-anatomy-tip]') as HTMLElement;
    element.dispatchEvent(new MouseEvent('mousemove', { clientX: 2.9, clientY: 2.9 }));
    runFrames();
    expect(tip.textContent).toBe('Liver');
    element.dispatchEvent(new MouseEvent('mousemove', { clientX: 3.1, clientY: 1 }));
    runFrames();
    expect(tip.style.display).toBe('none');
    overlay.destroy();
  });

  it('draws nothing while a stack has not drawn its image yet (its camera is not on the image)', async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    const { element, vp } = viewport('vp1', 'a', 3);
    // Cornerstone's default camera before the first image: the canvas maps near the origin.
    vp.canvasToWorld = ([x, y]: [number, number]) => [x * 0.01, y * 0.01, 0];
    const overlay = createAnatomyOverlay({ store, services: null, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element });
    rendered(element);
    runFrames();
    expect(puts).toHaveLength(0);
    expect(overlay.harnessState()).toMatchObject({ viewports: [{ drawn: 0, anatomy: false }] });
    overlay.destroy();
  });

  it('draws nothing on a series without anatomy, and nothing on one whose images are not on the grid (and says so)', async () => {
    const store = await loadedStore();
    registerImages('2.25.4242', 'b');
    const other = viewport('vp1', 'b');
    const overlay = createAnatomyOverlay({ store, services: null, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element: other.element });
    rendered(other.element);
    runFrames();
    expect(puts).toHaveLength(0);
    overlay.destroy();

    cs.meta.clear();
    registerImages(SERIES, 'c', 1); // shifted half a voxel
    const shifted = viewport('vp2', 'c');
    const overlay2 = createAnatomyOverlay({ store, services: null, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element: shifted.element });
    rendered(shifted.element);
    runFrames();
    expect(puts).toHaveLength(0);
    expect(store.getSnapshot().notes.join(' ')).toMatch(
      /Not drawn on one series: an image's pixels sit between/
    );
    overlay2.destroy();
  });

  it('clears the canvas when the layers are turned off, and draws them again when they are on', async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    const { element } = viewport('vp1', 'a');
    const overlay = createAnatomyOverlay({ store, services: null, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element });
    rendered(element);
    runFrames();
    expect(puts).toHaveLength(1);
    store.setEnabled(false);
    runFrames();
    expect(clears).toBe(1);
    store.setEnabled(true);
    runFrames();
    expect(puts).toHaveLength(2);
    // Hiding the liver draws the slice again without it.
    store.setStructureVisible('0/total/1', false);
    runFrames();
    expect(alphaAt(last(), 1, 1)).toBe(0);
    expect(alphaAt(last(), 6, 4)).toBeGreaterThan(0);
    overlay.destroy();
  });

  it('names the visible structures under the cursor, and nothing elsewhere', async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    const { element, inner } = viewport('vp1', 'a');
    const overlay = createAnatomyOverlay({ store, services: null, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element });
    rendered(element);
    runFrames();
    const tip = inner.querySelector('[data-pacsai-anatomy-tip]') as HTMLElement;
    element.dispatchEvent(new MouseEvent('mousemove', { clientX: 1.5, clientY: 1.5 }));
    runFrames();
    expect(tip.style.display).toBe('block');
    expect(tip.textContent).toBe('Liver');
    store.setTaskVisible(0, 'trunk_cavities', true);
    runFrames();
    element.dispatchEvent(new MouseEvent('mousemove', { clientX: 1.5, clientY: 1.6 }));
    runFrames();
    expect(tip.textContent).toBe('Liver · Abdominal cavity');
    element.dispatchEvent(new MouseEvent('mousemove', { clientX: 4.5, clientY: 0.5 }));
    runFrames();
    expect(tip.textContent).toBe('Abdominal cavity');
    element.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.style.display).toBe('none');
    overlay.destroy();
  });

  it("brings a selected structure's largest slice into the active viewport, or the one that shows its series", async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    registerImages('2.25.4242', 'b');
    const shows = viewport('vp-shows', 'a', 4);
    const other = viewport('vp-other', 'b', 0);
    const services: OverlayServices = {
      viewportGridService: { getState: () => ({ activeViewportId: 'vp-other' }) },
    };
    const overlay = createAnatomyOverlay({ store, services, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element: shows.element });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element: other.element });
    store.select('0/total/1');
    expect(other.vp.setImageIdIndex).not.toHaveBeenCalled();
    // A stack goes to the image of the series nearest the point (cornerstone's own
    // jumpToWorld takes a stack image only within EPSILON of its plane).
    expect(shows.vp.setImageIdIndex).toHaveBeenCalledWith(1);
    expect(shows.vp.jumpToWorld).not.toHaveBeenCalled();
    expect(shows.state.slice).toBe(1);
    expect(store.harnessState()).toMatchObject({ counts: { jumps: 1, jumpMisses: 0 } });
    overlay.destroy();
  });

  it("moves a volume viewport's camera to the structure (jumpToWorld), having no stack index to set", async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    const volume = viewport('vp-mpr', 'a', 0);
    volume.vp.setImageIdIndex = undefined;
    const overlay = createAnatomyOverlay({ store, services: null, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element: volume.element });
    store.select('0/total/1');
    expect(volume.vp.jumpToWorld).toHaveBeenCalledWith([-6, -4, 13]);
    expect(volume.state.slice).toBe(1);
    overlay.destroy();
  });

  it('hangs the series in the active viewport when no viewport shows it, and jumps once it draws', async () => {
    const store = await loadedStore();
    registerImages('2.25.4242', 'b');
    registerImages(SERIES, 'a');
    const only = viewport('vp1', 'b', 0);
    const setDisplaySetsForViewports = jest.fn();
    const getViewportsRequireUpdate = jest.fn(() => [
      { viewportId: 'vp1', displaySetInstanceUIDs: ['ds-ct'] },
    ]);
    const services: OverlayServices = {
      viewportGridService: {
        getState: () => ({ activeViewportId: 'vp1' }),
        setDisplaySetsForViewports,
      },
      hangingProtocolService: { getViewportsRequireUpdate },
      displaySetService: {
        getActiveDisplaySets: () => [
          {
            displaySetInstanceUID: 'ds-allinone',
            SeriesInstanceUID: SERIES,
            isAllInOne: true,
            images: [1, 2, 3, 4, 5, 6],
          },
          { displaySetInstanceUID: 'ds-ct', SeriesInstanceUID: SERIES, images: [1, 2, 3, 4, 5] },
        ],
      },
    };
    const overlay = createAnatomyOverlay({ store, services, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element: only.element });
    store.select('0/total/2');
    expect(getViewportsRequireUpdate).toHaveBeenCalledWith('vp1', 'ds-ct');
    expect(setDisplaySetsForViewports).toHaveBeenCalledWith([
      { viewportId: 'vp1', displaySetInstanceUIDs: ['ds-ct'] },
    ]);
    // The viewport now shows the series: its next render jumps to the spleen's slice.
    only.vp.getImageIds = () => Array.from({ length: GRID.nz }, (_, k) => `a${k}`);
    only.vp.getCurrentImageId = () => `a${only.state.slice}`;
    rendered(only.element);
    runFrames();
    expect(only.vp.setImageIdIndex).toHaveBeenCalledWith(3);
    expect(only.state.slice).toBe(3);
    overlay.destroy();
  });

  it('moves every volume viewport showing the series (MPR’s three), each through the structure', async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    const views = ['vp-ax', 'vp-cor', 'vp-sag'].map(id => {
      const v = viewport(id, 'a', 0);
      v.vp.setImageIdIndex = undefined;
      return v;
    });
    const overlay = createAnatomyOverlay({ store, services: null, cornerstone, win });
    views.forEach(v => fire('CORNERSTONE_ELEMENT_ENABLED', { element: v.element }));
    store.select('0/total/1');
    views.forEach(v => expect(v.vp.jumpToWorld).toHaveBeenCalledWith([-6, -4, 13]));
    expect(overlay.harnessState()).toMatchObject({ counts: { jumps: 3 } });
    overlay.destroy();
  });

  it('lets go of a viewport cornerstone disables, and of everything when destroyed', async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    const { element, inner } = viewport('vp1', 'a');
    const overlay = createAnatomyOverlay({ store, services: null, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element });
    expect(inner.querySelector('[data-pacsai-anatomy-layer]')).not.toBeNull();
    fire('CORNERSTONE_ELEMENT_DISABLED', { element });
    expect(inner.querySelector('[data-pacsai-anatomy-layer]')).toBeNull();
    expect(inner.querySelector('[data-pacsai-anatomy-tip]')).toBeNull();
    overlay.destroy();
    expect(cs.listeners.get('CORNERSTONE_ELEMENT_ENABLED')?.size ?? 0).toBe(0);
    // A selection after the overlay went navigates nowhere.
    store.select('0/total/1');
    expect(store.harnessState()).toMatchObject({ counts: { jumps: 0 } });
  });
});

describe('the anatomy layers on other series of the same acquisition (RS-36)', () => {
  it.each([
    ['with WebGL', false],
    ['on the CPU path', true],
  ])(
    'draws the labelmap, resampled, on a coronal reformat of the acquisition %s, and names what is under the cursor there',
    async (_how, cpu) => {
      const store = await loadedStore();
      registerImages(SERIES, 'a');
      registerCoronal(COR, 'r', CORONAL_YS);
      const services: OverlayServices = {
        displaySetService: {
          getActiveDisplaySets: () => [
            nativeSet(),
            displaySet('ds-cor', COR, idsOf('r', CORONAL_YS), REFORMAT),
          ],
        },
      };
      const cor = coronalViewport('vp-cor', 'r', CORONAL_YS, 4, cpu); // y = -4: the liver's row 1
      const overlay = createAnatomyOverlay({ store, services, cornerstone, win });
      // The store hears of it as soon as the overlay reads the display sets.
      expect(store.getSnapshot().series[0].related).toBe(1);
      fire('CORNERSTONE_ELEMENT_ENABLED', { element: cor.element });
      rendered(cor.element);
      runFrames();
      const img = last();
      expect([img.width, img.height]).toEqual([8, 9]);
      // The liver fills slices 1-3 (3 mm apart): rows 2-7 of 1.5 mm, two rows a slice; columns 0-2.
      const column1 = Array.from({ length: 9 }, (_, y) => alphaAt(img, 1, y) > 0);
      expect(column1).toEqual([false, false, true, true, true, true, true, true, false]);
      expect(alphaAt(img, 3, 4)).toBe(0);
      expect(overlay.harnessState()).toMatchObject({
        viewports: [{ drawn: 18, resampled: true, anatomy: true }],
        related: 1,
      });
      const tip = cor.inner.querySelector('[data-pacsai-anatomy-tip]') as HTMLElement;
      cor.element.dispatchEvent(new MouseEvent('mousemove', { clientX: 1.5, clientY: 4.5 }));
      runFrames();
      expect(tip.textContent).toBe('Liver');
      cor.element.dispatchEvent(new MouseEvent('mousemove', { clientX: 1.5, clientY: 1 }));
      runFrames();
      expect(tip.style.display).toBe('none');
      overlay.destroy();
    }
  );

  it('leaves alone another phase, a localizer and another frame of reference, and counts why', async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    registerCoronal(COR, 'r', CORONAL_YS);
    const services: OverlayServices = {
      displaySetService: {
        getActiveDisplaySets: () => [
          nativeSet(),
          // The venous phase, a minute later: the same patient coordinates, not the same moment.
          displaySet('ds-cor', COR, idsOf('r', CORONAL_YS), {
            ...REFORMAT,
            AcquisitionTime: '101600',
          }),
          displaySet('ds-scout', '2.25.1011', ['l0'], {
            ImageType: ['ORIGINAL', 'PRIMARY', 'LOCALIZER'],
          }),
          displaySet('ds-prior', '2.25.1012', ['p0'], { FrameOfReferenceUID: '2.25.1099' }),
          // The composite of every series is nobody's acquisition.
          {
            ...nativeSet(),
            displaySetInstanceUID: 'ds-all',
            SeriesInstanceUID: '2.25.1013',
            isAllInOne: true,
          },
        ],
      },
    };
    const cor = coronalViewport('vp-cor', 'r', CORONAL_YS, 4);
    const overlay = createAnatomyOverlay({ store, services, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element: cor.element });
    rendered(cor.element);
    runFrames();
    expect(puts).toHaveLength(0);
    expect(overlay.harnessState()).toMatchObject({
      viewports: [{ drawn: 0, resampled: false, anatomy: false }],
      related: 0,
      notRelated: {
        'acquired at another time': 1,
        'a localizer or projection': 1,
        'another frame of reference': 1,
      },
    });
    expect(store.getSnapshot().series[0].related).toBe(0);
    overlay.destroy();
  });

  it("draws nothing resampled while the labelmap's own series is off its grid, and says so", async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'c', 1); // shifted half a voxel
    registerCoronal(COR, 'r', CORONAL_YS);
    const services: OverlayServices = {
      displaySetService: {
        getActiveDisplaySets: () => [
          nativeSet('c'),
          displaySet('ds-cor', COR, idsOf('r', CORONAL_YS), REFORMAT),
        ],
      },
    };
    const cor = coronalViewport('vp-cor', 'r', CORONAL_YS, 4);
    const overlay = createAnatomyOverlay({ store, services, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element: cor.element });
    rendered(cor.element);
    runFrames();
    expect(puts).toHaveLength(0);
    expect(store.getSnapshot().notes.join(' ')).toMatch(
      /Not drawn on one series: an image's pixels sit between/
    );
    expect(store.getSnapshot().series[0].related).toBe(0);
    overlay.destroy();
  });

  it('a click brings each view of the acquisition to the structure, and leaves a reformat that does not reach it', async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    registerCoronal(COR, 'r', CORONAL_YS);
    registerCoronal('2.25.1020', 'f', [20, 22, 24]); // behind the liver
    registerCoronal('2.25.1021', 's', [-4, -2], 60); // its plane, but rows from z 60 down to 48
    const setDisplaySetsForViewports = jest.fn();
    const services: OverlayServices = {
      viewportGridService: {
        getState: () => ({ activeViewportId: 'vp-cor' }),
        setDisplaySetsForViewports,
      },
      hangingProtocolService: { getViewportsRequireUpdate: jest.fn(() => []) },
      displaySetService: {
        getActiveDisplaySets: () => [
          nativeSet(),
          displaySet('ds-cor', COR, idsOf('r', CORONAL_YS), REFORMAT),
          displaySet('ds-far', '2.25.1020', idsOf('f', [20, 22, 24]), REFORMAT),
          displaySet('ds-short', '2.25.1021', idsOf('s', [-4, -2]), REFORMAT),
        ],
      },
    };
    const axial = viewport('vp-ax', 'a', 4);
    const cor = coronalViewport('vp-cor', 'r', CORONAL_YS, 0);
    const far = coronalViewport('vp-far', 'f', [20, 22, 24], 0);
    const short = coronalViewport('vp-short', 's', [-4, -2], 1, false, 60);
    const overlay = createAnatomyOverlay({ store, services, cornerstone, win });
    [axial, cor, far, short].forEach(v =>
      fire('CORNERSTONE_ELEMENT_ENABLED', { element: v.element })
    );
    expect(store.getSnapshot().series[0].related).toBe(3);
    // The liver's largest slice: LPS (-6, -4, 13).
    store.select('0/total/1');
    expect(axial.vp.setImageIdIndex).toHaveBeenCalledWith(1);
    expect(cor.vp.setImageIdIndex).toHaveBeenCalledWith(4);
    expect(far.vp.setImageIdIndex).not.toHaveBeenCalled();
    expect(short.vp.setImageIdIndex).not.toHaveBeenCalled();
    expect(setDisplaySetsForViewports).not.toHaveBeenCalled();
    expect(overlay.harnessState()).toMatchObject({ counts: { jumps: 2 } });
    overlay.destroy();
  });

  it('with only a reformat on the screen, a click moves it and hangs nothing', async () => {
    const store = await loadedStore();
    registerImages(SERIES, 'a');
    registerCoronal(COR, 'r', CORONAL_YS);
    const setDisplaySetsForViewports = jest.fn();
    const services: OverlayServices = {
      viewportGridService: {
        getState: () => ({ activeViewportId: 'vp-cor' }),
        setDisplaySetsForViewports,
      },
      hangingProtocolService: { getViewportsRequireUpdate: jest.fn(() => []) },
      displaySetService: {
        getActiveDisplaySets: () => [
          nativeSet(),
          displaySet('ds-cor', COR, idsOf('r', CORONAL_YS), REFORMAT),
        ],
      },
    };
    const cor = coronalViewport('vp-cor', 'r', CORONAL_YS, 0);
    const overlay = createAnatomyOverlay({ store, services, cornerstone, win });
    fire('CORNERSTONE_ELEMENT_ENABLED', { element: cor.element });
    store.select('0/total/1');
    expect(cor.vp.setImageIdIndex).toHaveBeenCalledWith(4);
    expect(setDisplaySetsForViewports).not.toHaveBeenCalled();
    expect(store.harnessState()).toMatchObject({ counts: { jumps: 1, jumpMisses: 0 } });
    overlay.destroy();
  });
});
