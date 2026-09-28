/**
 * B01 observers for the viewer attempt trace (Rev 11 milestone 2).
 *
 * The stages that depend on what the viewer actually shows are derived here
 * from events the app already emits, so no core file has to know about the
 * requested study:
 *
 *   metadata_loaded               a display set of the requested study exists
 *   first_pixels                  any viewport rendered anything
 *   image_rendered_matching_study a viewport showing the requested study rendered
 *   tools_ready                   that viewport has a tool group attached
 *
 * Every grid render also goes into the harness's render log
 * (`window.__pacsaiRenderLog`, renderLog.ts): the generation at that moment
 * and the refs of the studies the viewport shows, which the trace alone cannot
 * say once a study switch has moved its generation on.
 *
 * Services are looked up lazily: this runs from the extension's
 * preRegistration, and extension-cornerstone may register its services later.
 */
import { utils } from '@ohif/core';
import { Enums } from '@cornerstonejs/core';
import { createRenderLog, installRenderLogHook } from './renderLog';

type Services = Record<string, any>;

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
    if (!viewportId || !services().cornerstoneViewportService?.getViewportInfo?.(viewportId)) {
      return;
    }
    let shown: string[] = [];
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
      });
    } catch (_) {
      /* the log must never break the viewer */
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
