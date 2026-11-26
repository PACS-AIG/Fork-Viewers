/**
 * RS-38, the refine tool on the viewports.
 *
 * While the tool is active, each lesion's current outline on the image shown
 * (faint, the one in hand full); SAM2CT's outline beside it once it is back;
 * and the mark being drawn or sent. One canvas per viewport, after the
 * anatomy layers and under the annotations, taking no pointer events.
 *
 * A lesion is drawn only on its own series' stack images that lie on its grid
 * (the anatomy layers' grid fit, anatomyGeometry.gridFit), so an outline is
 * never shown shifted, flipped or on another series. The outlines go through
 * the anatomy renderer (nearest voxel, edges only), one layer at a time, so
 * where SAM2CT's outline crosses the current one both stay visible.
 */
import { applyPoint, gridFit, type ImageGeometry, type Vec3 } from '../anatomy/anatomyGeometry';
import type { CornerstoneApi } from '../anatomy/anatomyOverlay';
import { renderLabels, type RenderLayer } from '../anatomy/anatomyRender';
import type { PreparedTarget } from './refineHit';
import { maskLayer } from './refineMask';
import { CURRENT_RGB, MARK_RGB, PREVIEW_RGB, type RefineStore } from './refineStore';
import {
  canvasOf,
  imageWorld,
  isStackViewport,
  shownImageOf,
  type RefineViewport,
} from './refineViewport';

const LAYER_ATTR = 'data-pacsai-refine-layer';
/** A lesion's outline while the tool is active and none is in hand. */
export const IDLE_ALPHA = 0.8;
/** Another lesion's, while one is in hand: faint. */
export const OTHERS_ALPHA = 0.45;

export interface RefineOverlay {
  destroy(): void;
  /** The element of the viewport with this id (where the bar goes), or null. */
  elementOf(viewportId: string): HTMLElement | null;
  harnessState(): Record<string, unknown>;
}

interface Attached {
  element: HTMLElement;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  queued: boolean;
  key: string;
  /** What the last draw drew, for the harness. */
  outlines: number;
  preview: boolean;
  mark: string | null;
  pixels: number;
  off: () => void;
}

interface Piece {
  layer: RenderLayer;
  prepared: PreparedTarget;
  alpha: number;
  /** Two pixels wide (the lesion in hand, SAM2CT's outline). */
  strong: boolean;
}

const fixed = (v: ArrayLike<number>, digits: number) =>
  Array.from({ length: 3 }, (_, i) => v[i].toFixed(digits)).join(',');
const isPoint = (p: ArrayLike<number> | undefined): p is ArrayLike<number> =>
  !!p && p.length >= 3 && [0, 1, 2].every(i => Number.isFinite(p[i]));

export function createRefineOverlay({
  store,
  cornerstone,
  win,
}: {
  store: RefineStore;
  cornerstone: CornerstoneApi;
  win: Window;
}): RefineOverlay {
  const doc = win.document;
  const { Enums, eventTarget, getEnabledElement, getRenderingEngines, metaData } = cornerstone;
  const attached = new Map<HTMLElement, Attached>();
  /** Whether an image lies on a target's grid, by (observation, grid revision, image). */
  const fits = new Map<string, boolean>();
  const counts = { draws: 0 };

  const viewportOf = (element: HTMLElement): RefineViewport | null => {
    try {
      const vp = getEnabledElement(element as HTMLDivElement)?.viewport as
        | RefineViewport
        | undefined;
      return vp && typeof vp.canvasToWorld === 'function' ? vp : null;
    } catch (_) {
      return null;
    }
  };

  function planeOf(imageId: string): ImageGeometry | null {
    try {
      const p = metaData.get('imagePlaneModule', imageId) as
        | {
            imagePositionPatient?: number[];
            rowCosines?: number[];
            columnCosines?: number[];
            rowPixelSpacing?: number;
            columnPixelSpacing?: number;
          }
        | undefined;
      if (!p?.imagePositionPatient || !p.rowCosines || !p.columnCosines) {
        return null;
      }
      return {
        position: p.imagePositionPatient,
        rowCosines: p.rowCosines,
        columnCosines: p.columnCosines,
        rowSpacing: Number(p.rowPixelSpacing),
        columnSpacing: Number(p.columnPixelSpacing),
      };
    } catch (_) {
      return null;
    }
  }

  function fitsImage(p: PreparedTarget, imageId: string): boolean {
    const key = `${p.target.observationId}|${p.target.seriesRevision}|${imageId}`;
    const known = fits.get(key);
    if (known !== undefined) {
      return known;
    }
    const plane = planeOf(imageId);
    const ok = !!plane && gridFit(p.toIndex, [plane], p.target.grid.shape).fits;
    fits.set(key, ok);
    return ok;
  }

  function clear(a: Attached) {
    if (a.key !== 'clear') {
      a.ctx?.clearRect(0, 0, a.canvas.width, a.canvas.height);
      a.key = 'clear';
    }
    a.outlines = 0;
    a.preview = false;
    a.mark = null;
    a.pixels = 0;
  }

  /** Copies drawn pixels of `src` over `out` (and, strong, one pixel right and down too). */
  function composite(
    out: Uint8ClampedArray,
    src: Uint8ClampedArray,
    W: number,
    H: number,
    alpha: number,
    strong: boolean
  ): number {
    let n = 0;
    const a = Math.round(alpha * 255);
    const put = (q: number, p: number) => {
      out[q] = src[p];
      out[q + 1] = src[p + 1];
      out[q + 2] = src[p + 2];
      out[q + 3] = a;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        if (src[p + 3] === 0) {
          continue;
        }
        n++;
        put(p, p);
        if (strong) {
          if (x + 1 < W && src[p + 7] === 0) {
            put(p + 4, p);
          }
          if (y + 1 < H && src[p + W * 4 + 3] === 0) {
            put(p + W * 4, p);
          }
        }
      }
    }
    return n;
  }

  function drawMark(a: Attached, vp: RefineViewport): string | null {
    const view = store.getView();
    if (!view.mark || view.viewportId !== vp.id || !a.ctx) {
      return null;
    }
    if (
      view.phase !== 'drawing' &&
      view.phase !== 'sending' &&
      view.phase !== 'preview' &&
      view.phase !== 'answered' &&
      view.phase !== 'keeping'
    ) {
      return null;
    }
    const pts = view.mark.world.map(w => canvasOf(metaData, vp, w));
    if (pts.some(p => p === null)) {
      return null;
    }
    const ctx = a.ctx;
    ctx.save();
    ctx.strokeStyle = `rgb(${MARK_RGB.join(', ')})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(view.phase === 'drawing' ? [] : [4, 3]);
    if (view.mark.type === 'box') {
      const [p, q] = pts as Array<[number, number]>;
      ctx.strokeRect(
        Math.min(p[0], q[0]) + 0.5,
        Math.min(p[1], q[1]) + 0.5,
        Math.abs(q[0] - p[0]),
        Math.abs(q[1] - p[1])
      );
    } else {
      const [p] = pts as Array<[number, number]>;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
      ctx.moveTo(p[0] - 8, p[1]);
      ctx.lineTo(p[0] - 3, p[1]);
      ctx.moveTo(p[0] + 3, p[1]);
      ctx.lineTo(p[0] + 8, p[1]);
      ctx.moveTo(p[0], p[1] - 8);
      ctx.lineTo(p[0], p[1] - 3);
      ctx.moveTo(p[0], p[1] + 3);
      ctx.lineTo(p[0], p[1] + 8);
      ctx.stroke();
    }
    ctx.restore();
    return view.mark.type;
  }

  function draw(a: Attached) {
    a.queued = false;
    const W = Math.round(a.host.clientWidth);
    const H = Math.round(a.host.clientHeight);
    if (a.canvas.width !== W || a.canvas.height !== H) {
      a.canvas.width = W;
      a.canvas.height = H;
      a.key = '';
    }
    const view = store.getView();
    const vp = viewportOf(a.element);
    if (!vp || W < 2 || H < 2 || !isStackViewport(vp) || (!view.armed && view.phase === 'idle')) {
      return clear(a);
    }
    const shown = shownImageOf(metaData, vp);
    if (!shown) {
      return clear(a);
    }
    let p00, p10, p01;
    try {
      p00 = vp.canvasToWorld([0.5, 0.5]);
      p10 = vp.canvasToWorld([1.5, 0.5]);
      p01 = vp.canvasToWorld([0.5, 1.5]);
    } catch (_) {
      return clear(a);
    }
    if (!isPoint(p00) || !isPoint(p10) || !isPoint(p01)) {
      return clear(a);
    }
    const key = `${W}x${H}|${store.version()}|${shown.imageId}|${fixed(p00, 4)}|${fixed(p10, 5)}|${fixed(p01, 5)}`;
    if (key === a.key) {
      return;
    }
    a.key = key;
    const w00 = imageWorld(metaData, vp, p00);
    const w10 = imageWorld(metaData, vp, p10);
    const w01 = imageWorld(metaData, vp, p01);

    const inHand = view.target?.observationId ?? null;
    const pieces: Piece[] = [];
    let previewTarget: PreparedTarget | null = null;
    for (const p of view.targets) {
      if (p.target.seriesUID !== shown.seriesUID || !fitsImage(p, shown.imageId)) {
        continue;
      }
      const mine = p.target.observationId === inHand;
      if (mine) {
        previewTarget = p;
      }
      if (!p.mask || (!view.armed && !mine)) {
        continue;
      }
      pieces.push({
        layer: maskLayer(p.mask, CURRENT_RGB),
        prepared: p,
        alpha: mine ? 1 : inHand ? OTHERS_ALPHA : IDLE_ALPHA,
        strong: mine,
      });
    }
    const showPreview = !!(view.preview && previewTarget && view.phase !== 'kept');
    if (view.preview && previewTarget && showPreview) {
      pieces.push({
        layer: maskLayer(view.preview.unpacked, PREVIEW_RGB),
        prepared: previewTarget,
        alpha: 1,
        strong: true,
      });
    }
    if (!a.ctx) {
      return;
    }
    a.ctx.clearRect(0, 0, W, H);
    let pixels = 0;
    if (pieces.length) {
      const image = a.ctx.createImageData(W, H);
      let scratch: Uint32Array | undefined;
      let src: Uint8ClampedArray | undefined;
      for (const piece of pieces) {
        const t = piece.prepared.toIndex;
        const o = applyPoint(t, w00);
        const ox = applyPoint(t, w10);
        const oy = applyPoint(t, w01);
        const sx: Vec3 = [ox[0] - o[0], ox[1] - o[1], ox[2] - o[2]];
        const sy: Vec3 = [oy[0] - o[0], oy[1] - o[1], oy[2] - o[2]];
        const out = renderLabels(
          {
            width: W,
            height: H,
            origin: o,
            stepX: sx,
            stepY: sy,
            layers: [piece.layer],
            fillAlpha: 0,
            edgeAlpha: 1,
          },
          scratch,
          src
        );
        scratch = out.scratch;
        src = out.pixels;
        pixels += composite(image.data, out.pixels, W, H, piece.alpha, piece.strong);
      }
      a.ctx.putImageData(image, 0, 0);
    }
    a.outlines = pieces.length - (showPreview ? 1 : 0);
    a.preview = showPreview;
    a.pixels = pixels;
    a.mark = drawMark(a, vp);
    counts.draws++;
  }

  const queue = (a: Attached) => {
    if (!a.queued) {
      a.queued = true;
      win.requestAnimationFrame(() => draw(a));
    }
  };

  function attach(element: HTMLElement | null | undefined) {
    if (!element || attached.has(element)) {
      return;
    }
    const host = (element.querySelector('div.viewport-element') as HTMLElement | null) ?? element;
    const canvas = doc.createElement('canvas');
    canvas.setAttribute(LAYER_ATTR, '');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    // After the anatomy layers' canvas when there is one, else after cornerstone's.
    const below =
      host.querySelector('canvas[data-pacsai-anatomy-layer]') ??
      host.querySelector('canvas.cornerstone-canvas');
    if (below && below.parentElement === host) {
      below.after(canvas);
    } else {
      host.prepend(canvas);
    }
    const a: Attached = {
      element,
      host,
      canvas,
      ctx: canvas.getContext('2d'),
      queued: false,
      key: '',
      outlines: 0,
      preview: false,
      mark: null,
      pixels: 0,
      off: () => undefined,
    };
    const onRendered = () => queue(a);
    element.addEventListener(Enums.Events.IMAGE_RENDERED, onRendered);
    a.off = () => {
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, onRendered);
      canvas.remove();
    };
    attached.set(element, a);
    queue(a);
  }

  function detach(element: HTMLElement | null | undefined) {
    const a = element ? attached.get(element) : undefined;
    if (a) {
      a.off();
      attached.delete(a.element);
    }
  }

  const onEnabled = (e: Event) =>
    attach((e as CustomEvent<{ element?: HTMLElement }>).detail?.element);
  const onDisabled = (e: Event) =>
    detach((e as CustomEvent<{ element?: HTMLElement }>).detail?.element);
  eventTarget.addEventListener(Enums.Events.ELEMENT_ENABLED, onEnabled);
  eventTarget.addEventListener(Enums.Events.ELEMENT_DISABLED, onDisabled);
  try {
    for (const engine of getRenderingEngines() ?? []) {
      for (const vp of engine.getViewports()) {
        attach(vp.element);
      }
    }
  } catch (_) {
    /* no rendering engine yet: the viewports attach as they are enabled */
  }
  let targetsSeen: unknown = null;
  const offStore = store.subscribe(() => {
    const targets = store.getView().targets;
    if (targets !== targetsSeen) {
      targetsSeen = targets;
      fits.clear();
    }
    attached.forEach(queue);
  });

  return {
    destroy() {
      offStore();
      eventTarget.removeEventListener(Enums.Events.ELEMENT_ENABLED, onEnabled);
      eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, onDisabled);
      [...attached.keys()].forEach(detach);
      fits.clear();
    },
    elementOf(viewportId) {
      for (const a of attached.values()) {
        if (viewportOf(a.element)?.id === viewportId) {
          return a.host;
        }
      }
      return null;
    },
    harnessState: () => ({
      viewports: [...attached.values()].map(a => ({
        outlines: a.outlines,
        preview: a.preview,
        mark: a.mark,
        pixels: a.pixels,
      })),
      counts: { ...counts },
    }),
  };
}
