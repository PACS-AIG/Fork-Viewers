/**
 * RS-36: the anatomy layers on the viewports.
 *
 * Each cornerstone viewport gets a canvas of its own, between cornerstone's
 * canvas and the annotation layer (so measurements stay on top), that never
 * takes a pointer event. After each render of a viewport showing a series with
 * anatomy, the canvas is drawn again for the viewport's current plane
 * (anatomyRender): the native slices, a reformat or an oblique view alike,
 * since every canvas pixel is mapped through the viewport's own camera to the
 * labelmap's voxels. Nothing goes through OHIF's segmentation state, so the
 * layers are never in the segmentation panel and never in a SEG.
 *
 *   - A series is drawn only after its images are checked against the
 *     labelmap's grid (gridFit); one that does not fit is reported and left
 *     alone.
 *   - Hovering the image names the visible structures under the cursor
 *     (FINAL_SPEC §2.16: "hover names the structure").
 *   - The store's navigator: bring a selected structure's largest slice into
 *     the active viewport (or the first that shows its series; failing both,
 *     hang the series in the active viewport first).
 *
 * Cornerstone comes in as an argument (the extension hands it over at its
 * registration), so the pane's modules load without it.
 */
import {
  applyPoint,
  gridFit,
  type GridFit,
  type ImageGeometry,
  type Vec3,
} from './anatomyGeometry';
import { renderLabels } from './anatomyRender';
import { displayName, type AnatomyStore, type AnatomyTarget } from './anatomyStore';

/** What the overlay uses of OHIF's services (all optional: it does less without them). */
export interface OverlayServices {
  viewportGridService?: {
    getState?: () => { activeViewportId?: string | null } | undefined;
    setDisplaySetsForViewports?: (updates: unknown) => unknown;
  };
  cornerstoneViewportService?: {
    getCornerstoneViewport?: (viewportId: string) => { element?: HTMLElement } | null | undefined;
  };
  displaySetService?: {
    getActiveDisplaySets?: () => Array<Record<string, unknown>>;
  };
  hangingProtocolService?: {
    getViewportsRequireUpdate?: (viewportId: string, displaySetInstanceUID: string) => unknown;
  };
  cineService?: {
    getState?: () => { isCineEnabled?: boolean } | undefined;
    stopClip?: (element: HTMLElement, options: { viewportId: string }) => void;
    setCine?: (options: { id: string; isPlaying: boolean }) => void;
  };
}

/** What the overlay uses of @cornerstonejs/core. */
export interface CornerstoneApi {
  Enums: { Events: { IMAGE_RENDERED: string; ELEMENT_ENABLED: string; ELEMENT_DISABLED: string } };
  eventTarget: {
    addEventListener(type: string, listener: (e: Event) => void): void;
    removeEventListener(type: string, listener: (e: Event) => void): void;
  };
  getEnabledElement(element: HTMLDivElement): { viewport?: unknown } | undefined;
  getRenderingEngines(): Array<{ getViewports(): Array<{ element: HTMLElement }> }> | undefined;
  metaData: { get(type: string, imageId: string): unknown };
}

export interface AnatomyOverlay {
  destroy(): void;
  harnessState(): Record<string, unknown>;
}

interface CsViewport {
  id: string;
  element: HTMLElement;
  canvasToWorld: (pos: [number, number]) => ArrayLike<number> | undefined;
  getImageIds?: () => string[];
  getCurrentImageId?: () => string | undefined;
  jumpToWorld?: (world: Vec3) => boolean;
  /** A stack viewport drawn without WebGL (cornerstone's CPU path). */
  useCPURendering?: boolean;
  /** A stack viewport's: show the image at this index. */
  setImageIdIndex?: (index: number) => unknown;
}

interface Attached {
  element: HTMLElement;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  tip: HTMLDivElement;
  ctx: CanvasRenderingContext2D | null;
  image: ImageData | null;
  scratch: Uint32Array | undefined;
  key: string;
  queued: boolean;
  hoverAt: [number, number] | null;
  hoverQueued: boolean;
  seriesUID: string | null;
  /** The last draw's cpuPixelShift, for the hover. */
  shift: Vec3;
  /** The last draw's mapping (canvas size, index of pixel (0, 0), steps), for the harness. */
  last: { size: [number, number]; origin: Vec3; stepX: Vec3; stepY: Vec3 } | null;
  drawn: number;
  off: () => void;
}

const LAYER_ATTR = 'data-pacsai-anatomy-layer';
const TIP_ATTR = 'data-pacsai-anatomy-tip';

const fixed = (v: Vec3, digits: number) => v.map(x => x.toFixed(digits)).join(',');
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const isPoint = (p: ArrayLike<number> | undefined): p is ArrayLike<number> =>
  Boolean(p) && [0, 1, 2].every(i => Number.isFinite((p as ArrayLike<number>)[i]));
const NO_SHIFT: Vec3 = [0, 0, 0];

/**
 * Where cornerstone's world sits from the image it draws, in mm. With WebGL
 * (vtk.js) a pixel is drawn centred on its DICOM position, so nothing. On
 * cornerstone's CPU path (no WebGL) a stack image is drawn with its first
 * pixel's corner at ImagePositionPatient: its world reads half a pixel along
 * the rows and columns past DICOM's (measured in the end-to-end test). The
 * layers are drawn where the image is, so that half pixel is taken off.
 */
export function cpuPixelShift(
  metaData: CornerstoneApi['metaData'],
  useCPURendering: boolean | undefined,
  imageId: string | undefined
): Vec3 {
  if (!useCPURendering || !imageId) {
    return NO_SHIFT;
  }
  const p = metaData.get('imagePlaneModule', imageId) as
    | {
        rowCosines?: number[];
        columnCosines?: number[];
        rowPixelSpacing?: number;
        columnPixelSpacing?: number;
      }
    | undefined;
  const r = p?.rowCosines;
  const c = p?.columnCosines;
  if (!r || !c || !p?.rowPixelSpacing || !p?.columnPixelSpacing) {
    return NO_SHIFT;
  }
  const du = 0.5 * p.columnPixelSpacing;
  const dv = 0.5 * p.rowPixelSpacing;
  return [du * r[0] + dv * c[0], du * r[1] + dv * c[1], du * r[2] + dv * c[2]];
}

function seriesOfImage(
  metaData: CornerstoneApi['metaData'],
  imageId: string | undefined
): string | null {
  if (!imageId) {
    return null;
  }
  try {
    const m = metaData.get('generalSeriesModule', imageId) as
      | { seriesInstanceUID?: string }
      | undefined;
    return typeof m?.seriesInstanceUID === 'string' ? m.seriesInstanceUID : null;
  } catch (_) {
    return null;
  }
}

/** The image planes of a series among these images, or null while any is not known yet. */
function planesOf(
  metaData: CornerstoneApi['metaData'],
  imageIds: string[],
  seriesUID: string
): ImageGeometry[] | null {
  const planes: ImageGeometry[] = [];
  for (const id of imageIds) {
    if (seriesOfImage(metaData, id) !== seriesUID) {
      continue;
    }
    const p = metaData.get('imagePlaneModule', id) as
      | {
          imagePositionPatient?: number[];
          rowCosines?: number[];
          columnCosines?: number[];
          rowPixelSpacing?: number;
          columnPixelSpacing?: number;
        }
      | undefined;
    if (
      !p?.imagePositionPatient ||
      !p.rowCosines ||
      !p.columnCosines ||
      !p.rowPixelSpacing ||
      !p.columnPixelSpacing
    ) {
      return null;
    }
    planes.push({
      position: p.imagePositionPatient,
      rowCosines: p.rowCosines,
      columnCosines: p.columnCosines,
      rowSpacing: p.rowPixelSpacing,
      columnSpacing: p.columnPixelSpacing,
    });
  }
  return planes;
}

export function createAnatomyOverlay({
  store,
  services,
  cornerstone,
  win = window,
}: {
  store: AnatomyStore;
  services: OverlayServices | null;
  cornerstone: CornerstoneApi;
  win?: Window;
}): AnatomyOverlay {
  const { Enums, eventTarget, getEnabledElement, getRenderingEngines, metaData } = cornerstone;
  const seriesOf = (imageId: string | undefined) => seriesOfImage(metaData, imageId);
  const doc = win.document;
  const attached = new Map<HTMLElement, Attached>();
  // `<viewport>|<series>|<image count>|<first>|<last>` -> its verdict.
  const fitCache = new Map<string, GridFit>();
  let pendingJump: AnatomyTarget | null = null;
  const counts = { draws: 0, clears: 0, hovers: 0, jumps: 0, hangs: 0 };

  const viewportOf = (element: HTMLElement): CsViewport | null => {
    try {
      return (
        (getEnabledElement(element as HTMLDivElement)?.viewport as unknown as CsViewport) ?? null
      );
    } catch (_) {
      return null;
    }
  };

  function clear(a: Attached) {
    if (a.drawn > 0 || a.key) {
      a.ctx?.clearRect(0, 0, a.canvas.width, a.canvas.height);
      counts.clears++;
    }
    a.drawn = 0;
    a.key = '';
    a.seriesUID = null;
  }

  /** Whether a world point lies on this image's plane (within half a millimetre). */
  function onImagePlane(world: ArrayLike<number>, imageId: string | undefined): boolean {
    if (!imageId) {
      return false;
    }
    const p = metaData.get('imagePlaneModule', imageId) as
      | { imagePositionPatient?: number[]; rowCosines?: number[]; columnCosines?: number[] }
      | undefined;
    const o = p?.imagePositionPatient;
    const r = p?.rowCosines;
    const c = p?.columnCosines;
    if (!o || !r || !c) {
      return false;
    }
    const n = [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
    return (
      Math.abs((world[0] - o[0]) * n[0] + (world[1] - o[1]) * n[1] + (world[2] - o[2]) * n[2]) <=
      0.5
    );
  }

  function fitFor(vp: CsViewport, imageIds: string[], seriesUID: string): GridFit | null {
    const sig = `${vp.id}|${seriesUID}|${imageIds.length}|${imageIds[0]}|${imageIds[imageIds.length - 1]}`;
    const known = fitCache.get(sig);
    if (known) {
      return known;
    }
    const rs = store.renderSetFor(seriesUID);
    if (!rs) {
      return null;
    }
    const planes = planesOf(metaData, imageIds, seriesUID);
    if (!planes) {
      return null;
    }
    const fit = gridFit(rs.indexFromLps, planes, rs.shape);
    fitCache.set(sig, fit);
    store.reportFit(seriesUID, fit);
    return fit;
  }

  function draw(a: Attached) {
    a.queued = false;
    const W = Math.round(a.host.clientWidth);
    const H = Math.round(a.host.clientHeight);
    if (a.canvas.width !== W || a.canvas.height !== H) {
      a.canvas.width = W;
      a.canvas.height = H;
      a.image = null;
      a.key = '';
    }
    const vp = viewportOf(a.element);
    if (!vp || W < 2 || H < 2 || !store.getSnapshot().settings.enabled) {
      return clear(a);
    }
    let imageIds: string[] = [];
    let current: string | undefined;
    try {
      imageIds = vp.getImageIds?.() ?? [];
      current = vp.getCurrentImageId?.() ?? imageIds[0];
    } catch (_) {
      return clear(a);
    }
    const seriesUID = seriesOf(current);
    if (!seriesUID || store.seriesOf(seriesUID) === null) {
      return clear(a);
    }
    const fit = fitFor(vp, imageIds, seriesUID);
    if (!fit?.fits) {
      return clear(a);
    }
    const rs = store.renderSetFor(seriesUID);
    if (!rs || !rs.layers.length) {
      return clear(a);
    }
    if (pendingJump && pendingJump.seriesUID === seriesUID) {
      const target = pendingJump;
      pendingJump = null;
      if (bringTo(vp, target)) {
        return; // the jump renders again, and that render draws
      }
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
    // A stack's canvas must map onto the image it shows: before its first image
    // is drawn, cornerstone's camera is its default one, and nothing is drawn.
    if (typeof vp.setImageIdIndex === 'function' && !onImagePlane(p00, current)) {
      return clear(a);
    }
    const shift = cpuPixelShift(metaData, vp.useCPURendering, current);
    const o = applyPoint(rs.indexFromLps, sub([p00[0], p00[1], p00[2]], shift));
    const sx = sub(applyPoint(rs.indexFromLps, sub([p10[0], p10[1], p10[2]], shift)), o);
    const sy = sub(applyPoint(rs.indexFromLps, sub([p01[0], p01[1], p01[2]], shift)), o);
    const key = `${W}x${H}|${rs.revision}|${fixed(o, 4)}|${fixed(sx, 6)}|${fixed(sy, 6)}`;
    if (key === a.key) {
      return;
    }
    if (!a.ctx) {
      return;
    }
    if (!a.image) {
      a.image = a.ctx.createImageData(W, H);
    }
    const out = renderLabels(
      {
        width: W,
        height: H,
        origin: o,
        stepX: sx,
        stepY: sy,
        layers: rs.layers,
        fillAlpha: rs.fillAlpha,
        edgeAlpha: rs.edgeAlpha,
        highlight: rs.highlight,
      },
      a.scratch,
      a.image.data
    );
    a.scratch = out.scratch;
    a.ctx.putImageData(a.image, 0, 0);
    a.key = key;
    a.drawn = out.drawn;
    a.seriesUID = seriesUID;
    a.shift = shift;
    a.last = { size: [W, H], origin: o, stepX: sx, stepY: sy };
    counts.draws++;
  }

  const queue = (a: Attached) => {
    if (!a.queued) {
      a.queued = true;
      win.requestAnimationFrame(() => draw(a));
    }
  };

  function hideTip(a: Attached) {
    if (a.tip.style.display !== 'none') {
      a.tip.style.display = 'none';
    }
  }

  function hover(a: Attached) {
    a.hoverQueued = false;
    const at = a.hoverAt;
    const vp = viewportOf(a.element);
    if (!at || !vp || !a.seriesUID || !store.getSnapshot().settings.enabled) {
      return hideTip(a);
    }
    let world: ArrayLike<number> | undefined;
    try {
      world = vp.canvasToWorld(at);
    } catch (_) {
      world = undefined;
    }
    if (!isPoint(world)) {
      return hideTip(a);
    }
    const found = store.structuresAt(a.seriesUID, sub([world[0], world[1], world[2]], a.shift));
    if (!found.length) {
      return hideTip(a);
    }
    counts.hovers++;
    a.tip.textContent = found.map(s => displayName(s.name)).join(' · ');
    a.tip.style.display = 'block';
    const W = a.host.clientWidth;
    const H = a.host.clientHeight;
    const tw = a.tip.offsetWidth;
    const th = a.tip.offsetHeight;
    const left = Math.max(4, Math.min(at[0] + 14, W - tw - 4));
    const top = at[1] + 18 + th > H ? Math.max(4, at[1] - th - 10) : at[1] + 18;
    a.tip.style.left = `${left}px`;
    a.tip.style.top = `${top}px`;
  }

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
      imageRendering: 'pixelated',
    });
    const cs = host.querySelector('canvas.cornerstone-canvas');
    if (cs && cs.parentElement === host) {
      cs.after(canvas);
    } else {
      host.prepend(canvas);
    }
    const tip = doc.createElement('div');
    tip.setAttribute(TIP_ATTR, '');
    tip.setAttribute('role', 'tooltip');
    Object.assign(tip.style, {
      position: 'absolute',
      display: 'none',
      zIndex: '3',
      pointerEvents: 'none',
      maxWidth: '60%',
      padding: '2px 8px',
      borderRadius: '4px',
      background: 'rgba(10, 17, 27, 0.88)',
      border: '1px solid #2B3A4D',
      color: '#E8EEF5',
      font: '12px/18px system-ui, -apple-system, "Segoe UI", sans-serif',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    host.appendChild(tip);

    const a: Attached = {
      element,
      host,
      canvas,
      tip,
      ctx: canvas.getContext('2d'),
      image: null,
      scratch: undefined,
      key: '',
      queued: false,
      hoverAt: null,
      hoverQueued: false,
      seriesUID: null,
      shift: NO_SHIFT,
      last: null,
      drawn: 0,
      off: () => {},
    };
    const onRendered = () => queue(a);
    const onMove = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      a.hoverAt = [e.clientX - r.left, e.clientY - r.top];
      if (!a.hoverQueued) {
        a.hoverQueued = true;
        win.requestAnimationFrame(() => hover(a));
      }
    };
    const onLeave = () => {
      a.hoverAt = null;
      hideTip(a);
    };
    element.addEventListener(Enums.Events.IMAGE_RENDERED, onRendered as EventListener);
    element.addEventListener('mousemove', onMove, { passive: true });
    element.addEventListener('mouseleave', onLeave, { passive: true });
    a.off = () => {
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, onRendered as EventListener);
      element.removeEventListener('mousemove', onMove);
      element.removeEventListener('mouseleave', onLeave);
      canvas.remove();
      tip.remove();
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

  function stopCine(vp: CsViewport) {
    const cine = services?.cineService;
    try {
      if (cine?.getState?.()?.isCineEnabled) {
        cine.stopClip?.(vp.element, { viewportId: vp.id });
        cine.setCine?.({ id: vp.id, isPlaying: false });
      }
    } catch (_) {
      /* no cine */
    }
  }

  /**
   * Bring a target into a viewport showing its series. A stack goes to the
   * image of that series whose plane lies nearest the point: cornerstone's own
   * jumpToWorld takes a stack image only within EPSILON of its plane (its
   * stack image data's slice spacing), which a point from the labelmap's
   * affine can miss. A volume viewport moves its camera (jumpToWorld).
   */
  function bringTo(vp: CsViewport, target: AnatomyTarget): boolean {
    stopCine(vp);
    try {
      if (typeof vp.setImageIdIndex === 'function') {
        const ids = vp.getImageIds?.() ?? [];
        let best = -1;
        let bestDistance = Infinity;
        ids.forEach((id, i) => {
          if (seriesOf(id) !== target.seriesUID) {
            return;
          }
          const p = metaData.get('imagePlaneModule', id) as
            | { imagePositionPatient?: number[]; rowCosines?: number[]; columnCosines?: number[] }
            | undefined;
          const o = p?.imagePositionPatient;
          const r = p?.rowCosines;
          const c = p?.columnCosines;
          if (!o || !r || !c) {
            return;
          }
          const n: Vec3 = [
            r[1] * c[2] - r[2] * c[1],
            r[2] * c[0] - r[0] * c[2],
            r[0] * c[1] - r[1] * c[0],
          ];
          const d = Math.abs(
            (target.point[0] - o[0]) * n[0] +
              (target.point[1] - o[1]) * n[1] +
              (target.point[2] - o[2]) * n[2]
          );
          if (d < bestDistance) {
            bestDistance = d;
            best = i;
          }
        });
        if (best < 0) {
          return false;
        }
        void Promise.resolve(vp.setImageIdIndex(best)).catch(() => {});
        return true;
      }
      return vp.jumpToWorld?.(target.point) === true;
    } catch (_) {
      return false;
    }
  }

  function activeViewportId(): string | null {
    try {
      return services?.viewportGridService?.getState?.()?.activeViewportId ?? null;
    } catch (_) {
      return null;
    }
  }

  /** The store's navigator. */
  function navigate(target: AnatomyTarget): boolean {
    const active = activeViewportId();
    const list = [...attached.values()]
      .map(a => ({ a, vp: viewportOf(a.element) }))
      .filter((x): x is { a: Attached; vp: CsViewport } => Boolean(x.vp))
      .sort((x, y) => Number(y.vp.id === active) - Number(x.vp.id === active));
    for (const { vp } of list) {
      let ids: string[] = [];
      try {
        ids = vp.getImageIds?.() ?? [];
      } catch (_) {
        ids = [];
      }
      if (!ids.some(id => seriesOf(id) === target.seriesUID)) {
        continue;
      }
      if (bringTo(vp, target)) {
        counts.jumps++;
        return true;
      }
    }
    // No viewport shows the series: hang it in the active viewport, and jump once it draws.
    const grid = services?.viewportGridService;
    const hp = services?.hangingProtocolService;
    const sets = services?.displaySetService?.getActiveDisplaySets?.() ?? [];
    const ds = sets
      .filter(d => d.SeriesInstanceUID === target.seriesUID && !d.isAllInOne)
      .sort((x, y) => imageCount(y) - imageCount(x))[0];
    if (!active || !ds || !grid?.setDisplaySetsForViewports || !hp?.getViewportsRequireUpdate) {
      return false;
    }
    try {
      pendingJump = target;
      grid.setDisplaySetsForViewports(
        hp.getViewportsRequireUpdate(active, String(ds.displaySetInstanceUID))
      );
      counts.hangs++;
      return true;
    } catch (_) {
      pendingJump = null;
      return false;
    }
  }

  const imageCount = (d: Record<string, unknown>): number =>
    Array.isArray(d.images) ? d.images.length : Array.isArray(d.imageIds) ? d.imageIds.length : 0;

  const onEnabled = (e: Event) => {
    const detail = (e as CustomEvent<{ element?: HTMLElement }>).detail;
    attach(detail?.element);
  };
  const onDisabled = (e: Event) => {
    const detail = (e as CustomEvent<{ element?: HTMLElement }>).detail;
    detach(detail?.element);
  };
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

  const offStore = store.subscribe(() => {
    const enabled = store.getSnapshot().settings.enabled;
    attached.forEach(a => {
      if (!enabled) {
        hideTip(a);
      }
      queue(a);
    });
  });
  store.setNavigator(navigate);

  return {
    destroy() {
      offStore();
      store.setNavigator(null);
      eventTarget.removeEventListener(Enums.Events.ELEMENT_ENABLED, onEnabled);
      eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, onDisabled);
      [...attached.keys()].forEach(detach);
      fitCache.clear();
      pendingJump = null;
    },
    harnessState() {
      return {
        viewports: [...attached.values()].map(a => ({
          drawn: a.drawn,
          last: a.last
            ? {
                size: a.last.size,
                origin: a.last.origin.map(x => Math.round(x * 100) / 100),
                stepX: a.last.stepX.map(x => Math.round(x * 1000) / 1000),
                stepY: a.last.stepY.map(x => Math.round(x * 1000) / 1000),
              }
            : null,
          anatomy: a.seriesUID !== null,
          tip: a.tip.style.display === 'block' ? a.tip.textContent : null,
        })),
        counts: { ...counts },
      };
    },
  };
}
