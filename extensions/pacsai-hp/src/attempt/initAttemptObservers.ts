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
 * Services are looked up lazily: this runs from the extension's
 * preRegistration, and extension-cornerstone may register its services later.
 */
import { utils } from '@ohif/core';
import { Enums } from '@cornerstonejs/core';

type Services = Record<string, any>;

export default function initAttemptObservers({ servicesManager }: { servicesManager: any }): void {
  const { attempt } = utils;
  const services = (): Services => servicesManager?.services ?? {};

  const displaySetService = services().displaySetService;
  displaySetService?.subscribe?.(
    displaySetService.EVENTS.DISPLAY_SETS_ADDED,
    (payload: { displaySetsAdded?: Array<{ StudyInstanceUID?: string }> }) => {
      if (attempt.has('metadata_loaded')) {
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
    attempt.mark('first_pixels');
    const wantsRender = !attempt.has('image_rendered_matching_study');
    const wantsTools = !attempt.has('tools_ready');
    if (!wantsRender && !wantsTools) {
      return;
    }
    if (!studyUidsShownIn(viewportId).some(uid => attempt.matchesRequested(uid))) {
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
