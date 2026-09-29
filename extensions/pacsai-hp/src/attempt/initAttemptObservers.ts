/**
 * B01 observers for the viewer attempt trace (Rev 11 milestone 2).
 *
 * The stages that depend on what the viewer actually shows are derived here
 * from events the app already emits, so no core file has to know about the
 * requested study:
 *
 *   metadata_loaded               a display set of the requested study exists
 *   first_pixels                  a grid viewport rendered with an image in it
 *   image_rendered_matching_study a viewport showing the requested study rendered one
 *   tools_ready                   that viewport has a tool group attached
 *
 * "With an image in it" (showsImage): Cornerstone renders a grid
 * viewport before anything is decoded. With the decode workers' script held
 * for 30 s, the first live run of the milestone 6 probe recorded first_pixels
 * and image_rendered_matching_study at 10.46 s from renders whose canvases
 * were 0.0 % lit, and the viewer reported itself ready over a black grid.
 *
 * Every grid render also goes into the harness's render log
 * (`window.__pacsaiRenderLog`, renderLog.ts): the generation at that moment,
 * the refs of the studies the viewport shows, which the trace alone cannot
 * say once a study switch has moved its generation on, and whether it showed
 * an image — the same predicate, so the harness can leave the empty ones out.
 *
 * Every grid render is also told to onGridRender's listeners, image or not,
 * with whether its viewport is a volume one: the image-pool hold
 * (installImagePoolHold.ts) releases at a volume viewport's first render, as
 * its frames stream through a pool the hold keeps at 0.
 *
 * Services are looked up lazily: this runs from the extension's
 * preRegistration, and extension-cornerstone may register its services later.
 */
import { utils } from '@ohif/core';
import { Enums, cache } from '@cornerstonejs/core';
import { createRenderLog, installRenderLogHook } from './renderLog';

type Services = Record<string, any>;

/** What the observers tell apart (Cornerstone 2.17.2: each method is on one kind only). */
function viewportKind(viewport: any): 'stack' | 'volume' | 'other' {
  if (typeof viewport?.getCornerstoneImage === 'function') {
    return 'stack'; // StackViewport
  }
  if (typeof viewport?.getAllVolumeIds === 'function') {
    return 'volume'; // BaseVolumeViewport: MPR (VolumeViewport) and 3D (VolumeViewport3D)
  }
  return 'other';
}

/** BaseStreamingImageVolume's counters (`private` in its typings; read here, never written). */
type StreamingCounters = { framesUpdated?: unknown };

/**
 * Does this Cornerstone viewport show decoded image data? (Cornerstone 2.17.2.)
 *
 *   stack   StackViewport sets `csImage` (getCornerstoneImage()) when it
 *           displays an image (renderImageObject → _setCSImage); until then
 *           it is undefined.
 *   volume  A volume actor's streaming volume has put a decoded frame into its
 *           texture: BaseStreamingImageVolume `framesUpdated` > 0. Not
 *           `framesProcessed`, which also counts frames that failed for good.
 *           A volume without those counters (a derived labelmap) is not image
 *           data on its own; every volume OHIF hangs is a streaming one.
 *   other   (video, whole slide, or a shape not known here) no: the question
 *           is whether the viewer may call itself ready, and a wrong yes is
 *           the defect. The render is still logged, with image: false.
 */
function showsImage(viewport: any): boolean {
  switch (viewportKind(viewport)) {
    case 'stack':
      return Boolean(viewport.getCornerstoneImage());
    case 'volume': {
      const actors: Array<{ uid?: string; referencedId?: string }> = viewport.getActors?.() ?? [];
      return actors.some(({ uid, referencedId }) => {
        const volume = cache.getVolume(referencedId || uid) as StreamingCounters | undefined;
        return typeof volume?.framesUpdated === 'number' && volume.framesUpdated > 0;
      });
    }
    default:
      return false;
  }
}

/** One grid viewport render (never a thumbnail's), as onGridRender's listeners hear it. */
export interface GridRender {
  viewportId: string;
  /** A volume viewport (MPR, 3D), whose frames stream through the PREFETCH request pool. */
  isVolume: boolean;
  /** It showed decoded image data (showsImage). */
  image: boolean;
}

const gridRenderListeners = new Set<(render: GridRender) => void>();

/**
 * Hear every grid render, image or not, from the observers of this document.
 * Returns the unsubscribe. A listener that throws never reaches the viewer.
 */
export function onGridRender(listener: (render: GridRender) => void): () => void {
  const entry = (render: GridRender) => listener(render);
  gridRenderListeners.add(entry);
  return () => {
    gridRenderListeners.delete(entry);
  };
}

export default function initAttemptObservers({ servicesManager }: { servicesManager: any }): void {
  const { attempt } = utils;
  const services = (): Services => servicesManager?.services ?? {};
  const renderLog = createRenderLog();
  if (typeof window !== 'undefined') {
    installRenderLogHook(window, renderLog);
  }

  const displaySetService = services().displaySetService;
  displaySetService?.subscribe?.(
    displaySetService.EVENTS.DISPLAY_SETS_ADDED,
    (payload: { displaySetsAdded?: Array<{ StudyInstanceUID?: string }> }) => {
      // needs(), not has(): has() spans the attempt's documents, so after an
      // F5 of a document that loaded, this one would never record its own.
      if (!attempt.needs('metadata_loaded')) {
        return;
      }
      const added = payload?.displaySetsAdded ?? [];
      if (added.some(ds => attempt.matchesRequested(ds?.StudyInstanceUID))) {
        attempt.mark('metadata_loaded');
      }
    }
  );

  const studyUidsShownIn = (viewportId: string): string[] => {
    const { cornerstoneViewportService, displaySetService: dss } = services();
    const info = cornerstoneViewportService?.getViewportInfo?.(viewportId);
    const data: Array<{ displaySetInstanceUID?: string }> = info?.getViewportData?.()?.data ?? [];
    return data
      .map(d => dss?.getDisplaySetByUID?.(d?.displaySetInstanceUID)?.StudyInstanceUID)
      .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0);
  };

  const onImageRendered = (evt: { detail?: { viewportId?: string } }) => {
    const viewportId = evt?.detail?.viewportId;
    // Thumbnails render through offscreen `renderGPUViewport-*` viewports the
    // viewport service has never heard of; they are not the reader's first
    // pixels. Only a grid viewport counts.
    const { cornerstoneViewportService } = services();
    if (!viewportId || !cornerstoneViewportService?.getViewportInfo?.(viewportId)) {
      return;
    }
    let shown: string[] = [];
    let image = false;
    let isVolume = false;
    try {
      const viewport = cornerstoneViewportService.getCornerstoneViewport?.(viewportId);
      isVolume = viewportKind(viewport) === 'volume';
      image = showsImage(viewport);
    } catch (_) {
      /* unreadable is not an image */
    }
    try {
      shown = studyUidsShownIn(viewportId);
      // Refs only, never UIDs: the log is read by the harness. The active
      // study tells a prior pane of the current case (A shown beside B after
      // a switch to B) from a stale view of the previous case.
      const active = services().hangingProtocolService?.getState?.()?.activeStudyUID;
      renderLog.record({
        tMs: performance.now(),
        generation: attempt.snapshot()?.generation ?? null,
        studyRefs: shown.map(uid => utils.studyRefFor(uid)),
        activeRef: typeof active === 'string' && active ? utils.studyRefFor(active) : null,
        image,
      });
    } catch (_) {
      /* the log must never break the viewer */
    }
    // Before the image test: a volume's first render releases the pool hold, image or not.
    for (const listener of [...gridRenderListeners]) {
      try {
        listener({ viewportId, isVolume, image });
      } catch (_) {
        /* nor must a listener */
      }
    }
    // An empty render (nothing decoded yet) is no stage at all.
    if (!image) {
      return;
    }
    attempt.mark('first_pixels');
    // needs(), not has(): after Retry viewer these stages are owed again.
    const wantsRender = attempt.needs('image_rendered_matching_study');
    const wantsTools = attempt.needs('tools_ready');
    if (!wantsRender && !wantsTools) {
      return;
    }
    if (!shown.some(uid => attempt.matchesRequested(uid))) {
      return;
    }
    if (wantsRender) {
      attempt.mark('image_rendered_matching_study');
    }
    if (wantsTools) {
      const { toolGroupService } = services();
      const toolGroup = toolGroupService?.getToolGroupForViewport?.(viewportId);
      if (toolGroup) {
        attempt.mark('tools_ready');
      }
    }
  };
  // Cornerstone dispatches IMAGE_RENDERED on the viewport ELEMENT (a
  // non-bubbling CustomEvent — RenderingEngine.js `triggerEvent(element, …)`),
  // not on its global eventTarget. A capture-phase listener on the document
  // still sees every one of them, whichever element they land on. The first
  // dev run of this trace recorded no render stage at all because it listened
  // on the global target; the images had rendered.
  if (typeof document !== 'undefined') {
    document.addEventListener(Enums.Events.IMAGE_RENDERED, onImageRendered as EventListener, true);
  }
}
