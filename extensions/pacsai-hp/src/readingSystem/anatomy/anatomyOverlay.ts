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
 *   - Another series of the same acquisition (the scanner's coronal and
 *     sagittal reformats: anatomyRelated) is drawn too, resampled from the
 *     labelmap, once the labelmap's own series (from its display set) fits
 *     the grid. The study's display sets say which series those are; the
 *     store hears how many, for the tab.
 *   - Hovering the image names the visible structures under the cursor
 *     (FINAL_SPEC §2.16: "hover names the structure").
 *   - The store's navigator: bring a selected structure's largest slice into
 *     every viewport showing its series (MPR's three views move their
 *     cameras through it), and every viewport drawing it resampled to its
 *     image through the same point (only when the point lies on one of its
 *     images); with none of them on the screen, hang the series in the
 *     active viewport first.
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
import { relatedVerdict, seriesFacts, type RelatedVerdict } from './anatomyRelated';
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
  /** The series whose labelmap the last draw drew: the shown one's, or the one it was resampled from. */
  anatomyUID: string | null;
  /** Whether the last draw was resampled onto another series of the acquisition. */
  resampled: boolean;
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
  // A labelmap series' own images, from its display sets: `<series>|<image count>` -> their verdict.
  const nativeFits = new Map<string, GridFit>();
  // From the study's display sets: `<labelmap series>|<other series>` -> whether it is one acquisition.
  const verdicts = new Map<string, RelatedVerdict>();
  // Each series' instances, as the last scan of the display sets found them.
  let instances = new Map<string, Array<Record<string, unknown>>>();
  let scanned = '';
  let pendingJump: AnatomyTarget | null = null;
  const counts = { draws: 0, clears: 0, hovers: 0, jumps: 0, hangs: 0, scans: 0 };

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
    a.anatomyUID = null;
    a.resampled = false;
  }

  /** An image's plane: its first pixel's position, row and column directions, normal, size and spacings. */
  function planeOf(imageId: string | undefined): {
    o: number[];
    r: number[];
    c: number[];
    n: Vec3;
    rows: number | null;
    columns: number | null;
    rowSpacing: number | null;
    columnSpacing: number | null;
  } | null {
    if (!imageId) {
      return null;
    }
    const p = metaData.get('imagePlaneModule', imageId) as
      | {
          imagePositionPatient?: number[];
          rowCosines?: number[];
          columnCosines?: number[];
          rows?: number;
          columns?: number;
          rowPixelSpacing?: number;
          columnPixelSpacing?: number;
        }
      | undefined;
    const o = p?.imagePositionPatient;
    const r = p?.rowCosines;
    const c = p?.columnCosines;
    if (!o || !r || !c) {
      return null;
    }
    const positive = (x: unknown) => (typeof x === 'number' && x > 0 ? x : null);
    return {
      o,
      r,
      c,
      n: [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]],
      rows: positive(p.rows),
      columns: positive(p.columns),
      rowSpacing: positive(p.rowPixelSpacing),
      columnSpacing: positive(p.columnPixelSpacing),
    };
  }

  const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const from = (p: ArrayLike<number>, o: ArrayLike<number>): Vec3 => [
    p[0] - o[0],
    p[1] - o[1],
    p[2] - o[2],
  ];

  /** Whether a world point lies on this image's plane (within half a millimetre). */
  function onImagePlane(world: ArrayLike<number>, imageId: string | undefined): boolean {
    const p = planeOf(imageId);
    return Boolean(p) && Math.abs(dot(from(world, p!.o), p!.n)) <= 0.5;
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

  function displaySets(): Array<Record<string, unknown>> {
    try {
      return services?.displaySetService?.getActiveDisplaySets?.() ?? [];
    } catch (_) {
      return [];
    }
  }

  const instancesOf = (d: Record<string, unknown>): Array<Record<string, unknown>> =>
    Array.isArray(d.instances) ? (d.instances as Array<Record<string, unknown>>) : [];

  /**
   * Which of the study's series are one acquisition with each labelmap series,
   * from the display sets (read again whenever they or the labelmap series
   * change), and how many, for the store.
   */
  function scanRelated(): void {
    const anatomy = store.anatomySeries();
    const sets = displaySets().filter(
      d => !d.isAllInOne && typeof d.SeriesInstanceUID === 'string'
    );
    const signature = `${anatomy.join(',')}|${sets
      .map(d => `${String(d.displaySetInstanceUID)}:${instancesOf(d).length}`)
      .join(',')}`;
    if (signature === scanned) {
      return;
    }
    scanned = signature;
    counts.scans++;
    instances = new Map();
    for (const d of sets) {
      const uid = d.SeriesInstanceUID as string;
      instances.set(uid, [...(instances.get(uid) ?? []), ...instancesOf(d)]);
    }
    verdicts.clear();
    for (const own of anatomy) {
      const mine = instances.get(own);
      const facts = mine?.length ? seriesFacts(mine) : null;
      let related = 0;
      instances.forEach((list, uid) => {
        if (!facts || anatomy.includes(uid)) {
          return;
        }
        const verdict = relatedVerdict(facts, seriesFacts(list));
        verdicts.set(`${own}|${uid}`, verdict);
        related += verdict.related ? 1 : 0;
      });
      store.reportRelated(own, related);
    }
  }

  /**
   * The labelmap series' own images against its grid, from its display sets:
   * a series is resampled from a labelmap only once its own series fits it.
   */
  function nativeFit(own: string): GridFit | null {
    const list = instances.get(own) ?? [];
    const sig = `${own}|${list.length}`;
    const known = nativeFits.get(sig);
    if (known) {
      return known;
    }
    const rs = store.renderSetFor(own);
    const ids = list.map(i => i.imageId).filter((id): id is string => typeof id === 'string');
    const planes = rs && ids.length ? planesOf(metaData, ids, own) : null;
    if (!rs || !planes?.length) {
      return null;
    }
    const fit = gridFit(rs.indexFromLps, planes, rs.shape);
    nativeFits.set(sig, fit);
    store.reportFit(own, fit);
    return fit;
  }

  /** The labelmap series a shown series is drawn from, resampled (null: none). */
  function relatedSource(shownUID: string): string | null {
    scanRelated();
    for (const own of store.anatomySeries()) {
      if (verdicts.get(`${own}|${shownUID}`)?.related && nativeFit(own)?.fits) {
        return own;
      }
    }
    return null;
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
    const shownUID = seriesOf(current);
    if (!shownUID) {
      return clear(a);
    }
    // The shown series' own labelmap once its images fit the grid, else one of
    // another series of its acquisition, resampled.
    const anatomyUID =
      store.seriesOf(shownUID) !== null
        ? fitFor(vp, imageIds, shownUID)?.fits
          ? shownUID
          : null
        : relatedSource(shownUID);
    if (!anatomyUID) {
      return clear(a);
    }
    const resampled = anatomyUID !== shownUID;
    const rs = store.renderSetFor(anatomyUID);
    if (!rs || !rs.layers.length) {
      return clear(a);
    }
    if (!resampled && pendingJump && pendingJump.seriesUID === anatomyUID) {
      const target = pendingJump;
      pendingJump = null;
      if (bringTo(vp, target.point, anatomyUID, false)) {
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
    a.anatomyUID = anatomyUID;
    a.resampled = resampled;
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
    if (!at || !vp || !a.anatomyUID || !store.getSnapshot().settings.enabled) {
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
    const found = store.structuresAt(a.anatomyUID, sub([world[0], world[1], world[2]], a.shift));
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
      anatomyUID: null,
      resampled: false,
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
   * Whether a point lies on a stack's image `index`: within half the stack's
   * spacing there (to its neighbours of the same series) of its plane, give
   * or take half a millimetre, and inside its rows and columns.
   */
  function liesOn(ids: string[], index: number, point: Vec3, seriesUID: string): boolean {
    const p = planeOf(ids[index]);
    if (!p) {
      return false;
    }
    let spacing = Infinity;
    for (const k of [index - 1, index + 1]) {
      const q = k >= 0 && k < ids.length && seriesOf(ids[k]) === seriesUID ? planeOf(ids[k]) : null;
      if (q) {
        spacing = Math.min(spacing, Math.abs(dot(from(q.o, p.o), p.n)));
      }
    }
    const d = from(point, p.o);
    if (Math.abs(dot(d, p.n)) > (Number.isFinite(spacing) ? spacing / 2 : 0) + 0.5) {
      return false;
    }
    if (p.rows && p.columns && p.rowSpacing && p.columnSpacing) {
      const u = dot(d, p.r) / p.columnSpacing;
      const v = dot(d, p.c) / p.rowSpacing;
      return u >= -0.5 && u <= p.columns - 0.5 && v >= -0.5 && v <= p.rows - 0.5;
    }
    return true;
  }

  /**
   * Bring a world point into a viewport. A stack goes to its image of
   * `seriesUID` whose plane lies nearest the point: cornerstone's own
   * jumpToWorld takes a stack image only within EPSILON of its plane (its
   * stack image data's slice spacing), which a point from the labelmap's
   * affine can miss. With `onImage` (a series resampled from the labelmap,
   * which may not reach the point), only when the point lies on that image.
   * A volume viewport moves its camera (jumpToWorld).
   */
  function bringTo(vp: CsViewport, point: Vec3, seriesUID: string, onImage: boolean): boolean {
    try {
      if (typeof vp.setImageIdIndex === 'function') {
        const ids = vp.getImageIds?.() ?? [];
        let best = -1;
        let bestDistance = Infinity;
        ids.forEach((id, i) => {
          const p = seriesOf(id) === seriesUID ? planeOf(id) : null;
          const d = p ? Math.abs(dot(from(point, p.o), p.n)) : Infinity;
          if (d < bestDistance) {
            bestDistance = d;
            best = i;
          }
        });
        if (best < 0 || (onImage && !liesOn(ids, best, point, seriesUID))) {
          return false;
        }
        stopCine(vp);
        void Promise.resolve(vp.setImageIdIndex(best)).catch(() => {});
        return true;
      }
      stopCine(vp);
      return vp.jumpToWorld?.(point) === true;
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

  /**
   * The store's navigator: every viewport showing the structure's series goes
   * to its largest slice (a volume viewport, MPR's three included, moves its
   * camera through the point), and every viewport drawing it resampled on
   * another series of the acquisition to its image through that point.
   */
  function navigate(target: AnatomyTarget): boolean {
    const active = activeViewportId();
    const list = [...attached.values()]
      .map(a => ({ a, vp: viewportOf(a.element) }))
      .filter((x): x is { a: Attached; vp: CsViewport } => Boolean(x.vp))
      .sort((x, y) => Number(y.vp.id === active) - Number(x.vp.id === active));
    let moved = 0;
    for (const { vp } of list) {
      let ids: string[] = [];
      let shown: string | null = null;
      try {
        ids = vp.getImageIds?.() ?? [];
        shown = seriesOf(vp.getCurrentImageId?.() ?? ids[0]);
      } catch (_) {
        ids = [];
      }
      if (ids.some(id => seriesOf(id) === target.seriesUID)) {
        moved += bringTo(vp, target.point, target.seriesUID, false) ? 1 : 0;
      } else if (shown && relatedSource(shown) === target.seriesUID) {
        moved += bringTo(vp, target.point, shown, true) ? 1 : 0;
      }
    }
    if (moved > 0) {
      counts.jumps += moved;
      return true;
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
    // Labelmap series coming ready may have other series of their acquisition.
    scanRelated();
    const enabled = store.getSnapshot().settings.enabled;
    attached.forEach(a => {
      if (!enabled) {
        hideTip(a);
      }
      queue(a);
    });
  });
  store.setNavigator(navigate);
  scanRelated();

  return {
    destroy() {
      offStore();
      store.setNavigator(null);
      eventTarget.removeEventListener(Enums.Events.ELEMENT_ENABLED, onEnabled);
      eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, onDisabled);
      [...attached.keys()].forEach(detach);
      fitCache.clear();
      nativeFits.clear();
      verdicts.clear();
      instances = new Map();
      scanned = '';
      pendingJump = null;
    },
    harnessState() {
      // Counts only: which series is which stays out of the harness.
      const notRelated: Record<string, number> = {};
      let related = 0;
      verdicts.forEach(v => {
        if (v.related) {
          related++;
        } else {
          notRelated[v.reason] = (notRelated[v.reason] ?? 0) + 1;
        }
      });
      return {
        viewports: [...attached.values()].map(a => ({
          drawn: a.drawn,
          resampled: a.resampled,
          last: a.last
            ? {
                size: a.last.size,
                origin: a.last.origin.map(x => Math.round(x * 100) / 100),
                stepX: a.last.stepX.map(x => Math.round(x * 1000) / 1000),
                stepY: a.last.stepY.map(x => Math.round(x * 1000) / 1000),
              }
            : null,
          anatomy: a.anatomyUID !== null,
          tip: a.tip.style.display === 'block' ? a.tip.textContent : null,
        })),
        related,
        notRelated,
        counts: { ...counts },
      };
    },
  };
}
