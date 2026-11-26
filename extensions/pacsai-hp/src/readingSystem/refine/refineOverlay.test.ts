import { applyPoint, indexFromLps, type Mat4, type Vec3 } from '../anatomy/anatomyGeometry';
import type { CornerstoneApi } from '../anatomy/anatomyOverlay';
import { readSegmentAnswer, type SegmentAnswer } from './refineContract';
import { createRefineOverlay } from './refineOverlay';
import { CURRENT_RGB, PREVIEW_RGB, createRefineStore } from './refineStore';
import {
  FOR,
  SERIES,
  SHAPE,
  disc,
  gridAffine,
  makeTarget,
  makeTargets,
  segmentOk,
  worldAt,
} from './refineTestData';

const affine = gridAffine();
const toIndex = indexFromLps(affine) as Mat4;
const W = 30;
const H = 24;
const SLICE = 2;

// What the overlay uses of @cornerstonejs/core: one stack viewport, a pixel per voxel on slice 2.
const listeners = new Map<string, Set<(e: unknown) => void>>();
const element = document.createElement('div');
const host = document.createElement('div');
host.className = 'viewport-element';
const csCanvas = document.createElement('canvas');
csCanvas.className = 'cornerstone-canvas';
host.appendChild(csCanvas);
element.appendChild(host);
Object.defineProperty(host, 'clientWidth', { value: W });
Object.defineProperty(host, 'clientHeight', { value: H });
let viewport: Record<string, unknown> = {};
const stackViewport = () => ({
  id: 'vp-1',
  element,
  canvasToWorld: ([x, y]: [number, number]) => worldAt(affine, x - 0.5, y - 0.5, SLICE),
  worldToCanvas: (w: Vec3) => {
    const i = applyPoint(toIndex, w);
    return [i[0] + 0.5, i[1] + 0.5];
  },
  getImageIds: () => ['img-0', 'img-1', 'img-2'],
  getCurrentImageId: () => `img-${SLICE}`,
  setImageIdIndex: () => undefined,
});
const origin = worldAt(affine, 0, 0, SLICE);
const meta = new Map<string, unknown>([
  [`generalSeriesModule|img-${SLICE}`, { seriesInstanceUID: SERIES }],
  [
    `imagePlaneModule|img-${SLICE}`,
    {
      frameOfReferenceUID: FOR,
      imagePositionPatient: origin,
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
      rowPixelSpacing: 0.8,
      columnPixelSpacing: 0.8,
    },
  ],
]);
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
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(fn as (e: unknown) => void);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn as (e: unknown) => void),
  },
  getEnabledElement: el => (el === element ? { viewport } : undefined),
  getRenderingEngines: () => [{ getViewports: () => [{ element }] }],
  metaData: { get: (type, id) => meta.get(`${type}|${id}`) },
};

// A 2D context that keeps what was put and stroked on it.
interface Put {
  data: Uint8ClampedArray;
}
let puts: Put[] = [];
let strokes: string[] = [];
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      createImageData: (w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: (img: Put) => puts.push({ data: img.data.slice() }),
      clearRect: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      setLineDash: () => undefined,
      strokeRect: () => strokes.push('rect'),
      beginPath: () => undefined,
      arc: () => strokes.push('arc'),
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
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
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};

const pixel = (put: Put, x: number, y: number) =>
  Array.from(put.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
const coloured = (put: Put, rgb: [number, number, number]) => {
  let n = 0;
  for (let p = 0; p < put.data.length; p += 4) {
    if (
      put.data[p + 3] > 0 &&
      put.data[p] === rgb[0] &&
      put.data[p + 1] === rgb[1] &&
      put.data[p + 2] === rgb[2]
    ) {
      n++;
    }
  }
  return n;
};

async function setup() {
  viewport = stackViewport();
  puts = [];
  strokes = [];
  const store = createRefineStore({
    client: {
      refineTargets: async () => makeTargets([makeTarget({}, disc([10, 12], 2.2, [SLICE]))]),
      segment: async () =>
        readSegmentAnswer(200, segmentOk(disc([10, 14], 3, [SLICE])), SHAPE) as SegmentAnswer,
    },
    reader: () => ({ id: 'r', role: 'radiologist' }),
    keep: async () => null,
    now: () => 0,
    setTimer: () => null,
    clearTimer: () => undefined,
    studyRef: () => 'ref',
  });
  const overlay = createRefineOverlay({ store, cornerstone, win });
  store.enter('study');
  await flush();
  runFrames();
  return { store, overlay };
}

describe('refine overlay', () => {
  it('sits over the image, after cornerstone’s canvas, taking no pointer events', async () => {
    const { overlay } = await setup();
    const layer = host.querySelector('canvas[data-pacsai-refine-layer]') as HTMLCanvasElement;
    expect(layer.previousElementSibling).toBe(csCanvas);
    expect(layer.style.pointerEvents).toBe('none');
    expect(overlay.elementOf('vp-1')).toBe(host);
    expect(overlay.elementOf('vp-9')).toBeNull();
    overlay.destroy();
    expect(host.querySelector('canvas[data-pacsai-refine-layer]')).toBeNull();
  });

  it('draws nothing until the tool is active, then each lesion’s outline where its voxels are', async () => {
    const { store, overlay } = await setup();
    expect(puts).toHaveLength(0);
    store.setArmed(true);
    runFrames();
    const put = puts.at(-1) as Put;
    // The disc's edge: its leftmost voxel on row 10 is column 10.
    expect(pixel(put, 10, 10).slice(0, 3)).toEqual(CURRENT_RGB);
    expect(pixel(put, 12, 10)[3]).toBe(0); // inside: outline only
    expect(pixel(put, 3, 3)[3]).toBe(0);
    expect(overlay.harnessState()).toMatchObject({ viewports: [{ outlines: 1, preview: false }] });
    overlay.destroy();
  });

  it('shows SAM2CT’s outline beside the current one, and the mark that was sent', async () => {
    const { store, overlay } = await setup();
    store.setArmed(true);
    store.beginMark('vp-1', worldAt(affine, 8, 6, SLICE));
    store.moveMark(worldAt(affine, 18, 14, SLICE), 30);
    runFrames();
    expect(strokes).toContain('rect');
    store.endMark({ seriesUID: SERIES, frameOfReferenceUID: FOR });
    await flush();
    runFrames();
    const put = puts.at(-1) as Put;
    expect(coloured(put, PREVIEW_RGB)).toBeGreaterThan(0);
    expect(coloured(put, CURRENT_RGB)).toBeGreaterThan(0);
    expect(overlay.harnessState()).toMatchObject({
      viewports: [{ outlines: 1, preview: true, mark: 'box' }],
    });
    overlay.destroy();
  });

  it('draws no lesion on another series, or on an image off its grid', async () => {
    const { store, overlay } = await setup();
    meta.set(`generalSeriesModule|img-${SLICE}`, { seriesInstanceUID: '2.25.other' });
    store.setArmed(true);
    runFrames();
    expect(overlay.harnessState()).toMatchObject({ viewports: [{ outlines: 0 }] });
    meta.set(`generalSeriesModule|img-${SLICE}`, { seriesInstanceUID: SERIES });
    const plane = meta.get(`imagePlaneModule|img-${SLICE}`) as Record<string, unknown>;
    meta.set(`imagePlaneModule|img-${SLICE}`, {
      ...plane,
      imagePositionPatient: [origin[0] + 0.4, origin[1], origin[2]],
    });
    store.setArmed(false);
    store.setArmed(true);
    runFrames();
    expect(overlay.harnessState()).toMatchObject({ viewports: [{ outlines: 0 }] });
    meta.set(`imagePlaneModule|img-${SLICE}`, plane);
    overlay.destroy();
  });

  it('draws nothing on a volume viewport (a reformat)', async () => {
    const { store, overlay } = await setup();
    viewport = { ...stackViewport(), setImageIdIndex: undefined };
    store.setArmed(true);
    runFrames();
    expect(overlay.harnessState()).toMatchObject({
      viewports: [{ outlines: 0, preview: false, mark: null }],
    });
    overlay.destroy();
  });
});
