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
 *   - The highlighted structure (selected, or pointed at in the table) is
 *     drawn in the spotlight (anatomyRender), and its name stands beside it
 *     on every view showing it, a leader to a point inside its largest piece
 *     (anatomyFocus). The name follows the structure as the reader scrolls
 *     and goes when the structure leaves the view. Where a click brought a
 *     view, a ring closes on the structure once it is drawn there (not with
 *     reduced motion). Esc clears the selection (not from a text field, and
 *     not when something else closes on it first).
 *     None of it is an annotation: nothing reaches the measurements, an SR
 *     or the report.
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
import type { Rgb } from './anatomyColors';
import { deepestPoint, placeCallout, type CalloutSide, type Rect } from './anatomyFocus';
import { relatedVerdict, seriesFacts, type RelatedVerdict } from './anatomyRelated';
import { renderLabels, type RenderOutput } from './anatomyRender';
import {
  displayName,
  type AnatomyRenderSet,
  type AnatomyStore,
  type AnatomyTarget,
} from './anatomyStore';

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
  /**
   * The left mouse button's active tool on a viewport's element (@cornerstonejs/tools'
   * tool group), null when none; without it a click on the images picks nothing.
   */
  primaryTool?: (element: HTMLElement) => string | null | undefined;
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
  /** A stack viewport's: show the image at this index, and the index it shows. */
  setImageIdIndex?: (index: number) => unknown;
  getCurrentImageIdIndex?: () => number;
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
  /** Over the labels, under the annotations: the name's leader, its dot, and the landing ring. */
  marks: SVGSVGElement;
  leader: SVGLineElement;
  dot: SVGCircleElement;
  ring: SVGCircleElement;
  /** The highlighted structure's name. */
  name: HTMLDivElement;
  /** The name as last placed (null: none shown). */
  callout: { key: string; side: CalloutSide; anchor: [number, number]; box: Rect } | null;
  /** A click's landing still to come here: its structure and the stack image it went to (null: a camera move). */
  landing: { key: string; index: number | null; until: number } | null;
  /** The landing ring's animation frame while it runs, and which run it is (a stopped run's frame does nothing). */
  pulse: number | null;
  pulseRun: number;
  off: () => void;
}

/** Where a click brought a view: how a stack goes there (its image) or a volume (its camera). */
interface Landing {
  index: number | null;
}

const LAYER_ATTR = 'data-pacsai-anatomy-layer';
const TIP_ATTR = 'data-pacsai-anatomy-tip';
const MARKS_ATTR = 'data-pacsai-anatomy-marks';
const NAME_ATTR = 'data-pacsai-anatomy-name';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** How long after a click a view may still land and show the ring, ms. */
export const LANDING_WAIT_MS = 15000;
/** The ring closing on a structure where a click brought a view, ms. */
export const PULSE_MS = 700;
/** The fewest pixels of the highlighted structure on a view that get its name. */
export const NAME_MIN_PIXELS = 6;
/** Past this many pixels, the highlighted structure's box on a view is read at a coarser step. */
const FOCUS_MAX_PIXELS = 160000;
/** A click on the images picks a structure when the mouse moved less than this between down and up, px. */
export const PICK_SLOP_PX = 4;
/** ... and was let go within this, ms. */
export const PICK_MS = 500;
/**
 * The left-button tools under which a click picks a structure: the ones that
 * do nothing with a click. A measurement or the refine tool keeps its clicks.
 */
export const PICK_TOOLS: ReadonlySet<string> = new Set([
  'WindowLevel',
  'Pan',
  'Zoom',
  'StackScroll',
]);
/** A label's colour, a third of the way to white, for its name and leader on the dark image. */
const lighten = (c: Rgb, alpha = 1): string => {
  const [r, g, b] = c.map(v => Math.round(v + (255 - v) * 0.35));
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

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
  const counts = {
    draws: 0,
    clears: 0,
    hovers: 0,
    picks: 0,
    jumps: 0,
    hangs: 0,
    scans: 0,
    pulses: 0,
  };
  const now = (): number => {
    try {
      return win.performance?.now?.() ?? Date.now();
    } catch (_) {
      return Date.now();
    }
  };
  const reducedMotion = (): boolean => {
    try {
      return Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    } catch (_) {
      return false;
    }
  };

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
    hideName(a);
  }

  function stopPulse(a: Attached) {
    a.pulseRun++;
    if (a.pulse !== null) {
      win.cancelAnimationFrame?.(a.pulse);
      a.pulse = null;
    }
    a.ring.style.display = 'none';
  }

  function hideName(a: Attached) {
    a.callout = null;
    a.marks.style.display = 'none';
    a.name.style.display = 'none';
    stopPulse(a);
  }

  /** Where the viewport's own text and buttons sit, on this view's canvas (CSS px). */
  function avoidOf(a: Attached, W: number, H: number): Rect[] {
    const out: Rect[] = [];
    try {
      const origin = a.host.getBoundingClientRect();
      const scope =
        (a.element.closest('.viewport-wrapper') as HTMLElement | null) ??
        a.element.parentElement ??
        a.element;
      scope.querySelectorAll('.overlay-item, .orientation-marker-value').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          out.push({
            left: r.left - origin.left - 4,
            top: r.top - origin.top - 4,
            right: r.right - origin.left + 4,
            bottom: r.bottom - origin.top + 4,
          });
        }
      });
    } catch (_) {
      /* no layout: the corners below */
    }
    // The top corners hold the viewport's buttons; without its text found, all four corners stay clear.
    const cw = Math.min(out.length ? 140 : 200, 0.3 * W);
    const ch = Math.min(out.length ? 36 : 80, 0.2 * H);
    out.push(
      { left: 0, top: 0, right: cw, bottom: ch },
      { left: W - cw, top: 0, right: W, bottom: ch }
    );
    if (out.length === 2) {
      out.push(
        { left: 0, top: H - ch, right: cw, bottom: H },
        { left: W - cw, top: H - ch, right: W, bottom: H }
      );
    }
    return out;
  }

  /**
   * The highlighted structure's name beside it on this view, its leader ending
   * on its largest piece's deepest pixel here; and the ring, when a click's
   * landing on this view is this draw.
   */
  function showName(
    a: Attached,
    W: number,
    H: number,
    found: RenderOutput['focus'],
    focus: AnatomyRenderSet['focus'],
    landed: { key: string } | null
  ) {
    const keys = a.scratch;
    if (!focus || !found || found.pixels < NAME_MIN_PIXELS || !keys) {
      return hideName(a);
    }
    // Its pixels over their box (a coarser step for a large one): their largest piece's deepest one.
    const bw = found.right - found.left;
    const bh = found.bottom - found.top;
    const step = Math.max(1, Math.ceil(Math.sqrt((bw * bh) / FOCUS_MAX_PIXELS)));
    const half = step >> 1;
    const w = Math.ceil(bw / step);
    const h = Math.ceil(bh / step);
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const py = Math.min(found.bottom - 1, found.top + y * step + half);
      for (let x = 0; x < w; x++) {
        const px = Math.min(found.right - 1, found.left + x * step + half);
        mask[y * w + x] = keys[py * W + px] === found.key ? 1 : 0;
      }
    }
    const deep = deepestPoint(mask, w, h);
    if (!deep) {
      return hideName(a);
    }
    const anchor: [number, number] = [
      found.left + deep.x * step + half + 0.5,
      found.top + deep.y * step + half + 0.5,
    ];
    const piece: Rect = {
      left: found.left + deep.box.left * step,
      top: found.top + deep.box.top * step,
      right: Math.min(found.right, found.left + deep.box.right * step),
      bottom: Math.min(found.bottom, found.top + deep.box.bottom * step),
    };
    if (a.name.textContent !== focus.name) {
      a.name.textContent = focus.name;
    }
    a.name.style.color = lighten(focus.color);
    a.name.style.borderColor = lighten(focus.color, 0.6);
    a.name.style.display = 'block';
    const lw = a.name.offsetWidth || Math.round(7 * focus.name.length + 16);
    const lh = a.name.offsetHeight || 20;
    const cover = (r: Rect) => {
      let n = 0;
      let anatomy = 0;
      let self = 0;
      const y1 = Math.min(H, r.bottom);
      const x1 = Math.min(W, r.right);
      for (let y = Math.max(0, Math.floor(r.top)); y < y1; y += 3) {
        for (let x = Math.max(0, Math.floor(r.left)); x < x1; x += 3) {
          const k = keys[y * W + x];
          n++;
          if (k !== 0) {
            anatomy++;
            self += k === found.key ? 1 : 0;
          }
        }
      }
      return n ? { anatomy: anatomy / n, self: self / n } : { anatomy: 0, self: 0 };
    };
    const placed = placeCallout({
      width: W,
      height: H,
      anchor,
      piece,
      label: [lw, lh],
      cover,
      avoid: avoidOf(a, W, H),
      last: a.callout?.key === focus.key ? a.callout.side : null,
    });
    if (!placed) {
      return hideName(a);
    }
    a.name.style.left = `${Math.round(placed.box.left)}px`;
    a.name.style.top = `${Math.round(placed.box.top)}px`;
    const color = lighten(focus.color);
    a.leader.setAttribute('x1', placed.from[0].toFixed(1));
    a.leader.setAttribute('y1', placed.from[1].toFixed(1));
    a.leader.setAttribute('x2', anchor[0].toFixed(1));
    a.leader.setAttribute('y2', anchor[1].toFixed(1));
    a.leader.setAttribute('stroke', color);
    a.dot.setAttribute('cx', anchor[0].toFixed(1));
    a.dot.setAttribute('cy', anchor[1].toFixed(1));
    a.dot.setAttribute('fill', color);
    a.marks.style.display = 'block';
    a.callout = { key: focus.key, side: placed.side, anchor, box: placed.box };
    if (landed && landed.key === focus.key) {
      startPulse(a, piece, color);
    }
  }

  /** A ring closing on the structure's largest piece and fading, once. */
  function startPulse(a: Attached, piece: Rect, color: string) {
    stopPulse(a);
    if (reducedMotion()) {
      return;
    }
    counts.pulses++;
    const cx = (piece.left + piece.right) / 2;
    const cy = (piece.top + piece.bottom) / 2;
    const r1 = Math.max(10, Math.hypot(piece.right - piece.left, piece.bottom - piece.top) / 2 + 4);
    const r0 = r1 + 60;
    a.ring.setAttribute('cx', cx.toFixed(1));
    a.ring.setAttribute('cy', cy.toFixed(1));
    a.ring.setAttribute('stroke', color);
    a.ring.setAttribute('r', r0.toFixed(1));
    a.ring.setAttribute('stroke-opacity', '0.95');
    a.ring.style.display = '';
    const start = now();
    const run = a.pulseRun;
    const frame = () => {
      if (run !== a.pulseRun) {
        return;
      }
      const t = Math.min(1, Math.max(0, (now() - start) / PULSE_MS));
      const e = 1 - Math.pow(1 - t, 3);
      a.ring.setAttribute('r', (r0 + (r1 - r0) * e).toFixed(1));
      a.ring.setAttribute('stroke-opacity', (0.95 * (1 - t)).toFixed(3));
      if (t < 1) {
        a.pulse = win.requestAnimationFrame(frame);
      } else {
        a.pulse = null;
        a.ring.style.display = 'none';
      }
    };
    a.pulse = win.requestAnimationFrame(frame);
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
      const landing = bringTo(vp, target.point, anatomyUID, false);
      if (landing) {
        a.landing = { key: target.key, index: landing.index, until: now() + LANDING_WAIT_MS };
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
        dim: rs.dim,
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
    // A click's landing here: the stack shows the image it went to, or the camera has moved.
    let landed: { key: string } | null = null;
    if (a.landing) {
      let index: number | undefined;
      try {
        index = vp.getCurrentImageIdIndex?.();
      } catch (_) {
        index = undefined;
      }
      if (a.landing.index === null || a.landing.index === index) {
        landed = a.landing;
        a.landing = null;
      } else if (now() > a.landing.until) {
        a.landing = null;
      }
    }
    showName(a, W, H, out.focus, rs.focus, landed);
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

  /** The structures the labelmap holds under a canvas point of this view (for the harness). */
  function namesAt(a: Attached, at: [number, number]): string[] {
    const vp = viewportOf(a.element);
    if (!vp || !a.anatomyUID) {
      return [];
    }
    try {
      const world = vp.canvasToWorld(at);
      if (!isPoint(world)) {
        return [];
      }
      return store
        .structuresAt(a.anatomyUID, sub([world[0], world[1], world[2]], a.shift))
        .map(s => displayName(s.name));
    } catch (_) {
      return [];
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

  /**
   * A click on the images (no drag): the topmost structure under it is picked,
   * selected without moving any view, so the tab can show its row. Only under
   * a left-button tool that does nothing with a click (PICK_TOOLS, or none).
   */
  function pickAt(a: Attached, clientX: number, clientY: number) {
    const vp = viewportOf(a.element);
    if (!vp || !a.anatomyUID || !store.getSnapshot().settings.enabled) {
      return;
    }
    let tool: string | null | undefined;
    try {
      tool = cornerstone.primaryTool?.(a.element);
    } catch (_) {
      tool = undefined;
    }
    if (tool === undefined || (tool !== null && !PICK_TOOLS.has(tool))) {
      return;
    }
    const r = a.host.getBoundingClientRect();
    let world: ArrayLike<number> | undefined;
    try {
      world = vp.canvasToWorld([clientX - r.left, clientY - r.top]);
    } catch (_) {
      world = undefined;
    }
    if (!isPoint(world)) {
      return;
    }
    const found = store.structuresAt(a.anatomyUID, sub([world[0], world[1], world[2]], a.shift));
    if (!found.length) {
      return;
    }
    counts.picks++;
    store.pick(found[0].key);
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
    const marks = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    marks.setAttribute(MARKS_ATTR, '');
    marks.setAttribute('aria-hidden', 'true');
    Object.assign(marks.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      display: 'none',
      overflow: 'visible',
      pointerEvents: 'none',
    });
    const leader = doc.createElementNS(SVG_NS, 'line') as SVGLineElement;
    leader.setAttribute('stroke-width', '1.5');
    leader.setAttribute('stroke-linecap', 'round');
    const dot = doc.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    dot.setAttribute('r', '3');
    dot.setAttribute('stroke', 'rgba(0, 0, 0, 0.7)');
    dot.setAttribute('stroke-width', '1');
    const ring = doc.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke-width', '2.5');
    ring.style.display = 'none';
    marks.append(leader, dot, ring);
    canvas.after(marks);
    const name = doc.createElement('div');
    name.setAttribute(NAME_ATTR, '');
    Object.assign(name.style, {
      position: 'absolute',
      display: 'none',
      pointerEvents: 'none',
      padding: '1px 7px',
      borderRadius: '4px',
      background: 'rgba(10, 17, 27, 0.88)',
      border: '1px solid #2B3A4D',
      font: '12px/18px system-ui, -apple-system, "Segoe UI", sans-serif',
      whiteSpace: 'nowrap',
    });
    marks.after(name);

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
      marks,
      leader,
      dot,
      ring,
      name,
      callout: null,
      landing: null,
      pulse: null,
      pulseRun: 0,
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
    // A click (the left button, no modifier, let go near where it went down and soon): a pick.
    // Captured, so it is seen before cornerstone's own handlers on the element; it stops nothing.
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: MouseEvent) => {
      down =
        e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
          ? { x: e.clientX, y: e.clientY, t: now() }
          : null;
    };
    const onUp = (e: MouseEvent) => {
      const d = down;
      down = null;
      if (
        d &&
        e.button === 0 &&
        Math.hypot(e.clientX - d.x, e.clientY - d.y) < PICK_SLOP_PX &&
        now() - d.t <= PICK_MS
      ) {
        pickAt(a, e.clientX, e.clientY);
      }
    };
    element.addEventListener(Enums.Events.IMAGE_RENDERED, onRendered as EventListener);
    element.addEventListener('mousemove', onMove, { passive: true });
    element.addEventListener('mouseleave', onLeave, { passive: true });
    element.addEventListener('mousedown', onDown, { passive: true, capture: true });
    element.addEventListener('mouseup', onUp, { passive: true, capture: true });
    a.off = () => {
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, onRendered as EventListener);
      element.removeEventListener('mousemove', onMove);
      element.removeEventListener('mouseleave', onLeave);
      element.removeEventListener('mousedown', onDown, { capture: true });
      element.removeEventListener('mouseup', onUp, { capture: true });
      stopPulse(a);
      canvas.remove();
      tip.remove();
      marks.remove();
      name.remove();
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
   * A volume viewport moves its camera (jumpToWorld). Answers where it went
   * (null: nowhere).
   */
  function bringTo(
    vp: CsViewport,
    point: Vec3,
    seriesUID: string,
    onImage: boolean
  ): Landing | null {
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
          return null;
        }
        stopCine(vp);
        void Promise.resolve(vp.setImageIdIndex(best)).catch(() => {});
        return { index: best };
      }
      stopCine(vp);
      return vp.jumpToWorld?.(point) === true ? { index: null } : null;
    } catch (_) {
      return null;
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
    for (const { a, vp } of list) {
      let ids: string[] = [];
      let shown: string | null = null;
      try {
        ids = vp.getImageIds?.() ?? [];
        shown = seriesOf(vp.getCurrentImageId?.() ?? ids[0]);
      } catch (_) {
        ids = [];
      }
      let landing: Landing | null = null;
      if (ids.some(id => seriesOf(id) === target.seriesUID)) {
        landing = bringTo(vp, target.point, target.seriesUID, false);
      } else if (shown && relatedSource(shown) === target.seriesUID) {
        landing = bringTo(vp, target.point, shown, true);
      }
      if (landing) {
        moved++;
        a.landing = { key: target.key, index: landing.index, until: now() + LANDING_WAIT_MS };
        queue(a);
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

  // Esc clears the selection, unless typed into a field (the report's editor, a search box). On
  // the document, as it bubbles: OHIF's own Esc (cancel a measurement) is bound there too, and
  // marks it handled and stops it, so neither a window listener nor `defaultPrevented` would
  // do; what closes on Esc first (the Copilot card, the arrange panel, the prior switcher) stops
  // it before it gets here, and the selection stays.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.repeat) {
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
      return;
    }
    const t = e.target as Element | null;
    if (
      t &&
      typeof t.closest === 'function' &&
      t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    ) {
      return;
    }
    if (store.getSnapshot().selected !== null) {
      store.select(null);
    }
  };
  doc.addEventListener('keydown', onKey);

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
      doc.removeEventListener('keydown', onKey);
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
          name: a.callout
            ? {
                text: a.name.textContent,
                side: a.callout.side,
                // What the labelmap holds under the leader's end (names only).
                under: namesAt(a, a.callout.anchor),
                box: [
                  a.callout.box.left,
                  a.callout.box.top,
                  a.callout.box.right,
                  a.callout.box.bottom,
                ].map(Math.round),
                anchor: a.callout.anchor.map(x => Math.round(x * 10) / 10),
              }
            : null,
          pulsing: a.pulse !== null,
        })),
        related,
        notRelated,
        counts: { ...counts },
      };
    },
  };
}
