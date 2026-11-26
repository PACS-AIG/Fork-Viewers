import { Types } from '@ohif/core';

import { id } from './id';
import getHangingProtocolModule from './getHangingProtocolModule';
import getCommandsModule from './getCommandsModule';
import getToolbarModule from './getToolbarModule';
import getPanelModule from './getPanelModule';
import {
  studyRoleOverlayItem,
  STUDY_ROLE_OVERLAY_ITEM_ID,
} from './overlays/studyRoleOverlayItem';
import {
  seriesTypeOverlayItem,
  SERIES_TYPE_OVERLAY_ITEM_ID,
} from './overlays/seriesTypeOverlayItem';
import {
  studyDescriptionOverlayItem,
  STUDY_DESCRIPTION_OVERLAY_ITEM_ID,
} from './overlays/studyDescriptionOverlayItem';
import { patientInfoOverlayItems } from './overlays/patientInfoOverlayItems';
import { formatStudyDateTime, formatDicomTimeHM } from './overlays/formatStudyDateTime';
import OverlayTextLine, { overlayTextLine } from './overlays/OverlayTextLine';
import {
  clinicalContextOverlayItem,
  CLINICAL_CONTEXT_OVERLAY_ITEM_ID,
} from './overlays/clinicalContextOverlayItem';
import createScrollSyncSynchronizer from './sync/createScrollSyncSynchronizer';
import createAllInOneScrollSynchronizer from './sync/createAllInOneScrollSynchronizer';
import installRgbStackViewportFix from './utils/installRgbStackViewportFix';
import { getSessionStudies, getStudyRole, subscribeSessionStudies } from './priors/roleRegistry';
import { configurePriorSwitching } from './priors/selectPrior';
import initAttemptObservers from './attempt/initAttemptObservers';
import installImagePoolHold from './startup/installImagePoolHold';
import { installParkedSuspend } from './startup/installParkedSuspend';
import { getEmbedBridge } from './embed/browser';
import { onParkedChange, IMAGES_WIDTH_VAR, IMAGES_BOTTOM_VAR } from './readingDock/readingDock';
import {
  currentReadingDock,
  ensureReadingDock,
  readingDockEnabled,
  setReadingViewerUser,
  setReadingViewerServices,
} from './readingDock/session';
import { launchFromQuery, routeStudyOf } from './readingDock/islandLoader';
import { READING_MIC_KEY, READING_MODES } from './readingDock/dockModel';
import { railLayoutProps } from './readingDock/seriesRail';
import {
  enterReadingSystem,
  setReadingSystemUser,
  setReadingSystemServices,
  setReadingSystemCornerstone,
  currentReadingSystem,
  currentAnatomy,
  onReadingSystemSelection,
  readingSystemEnabled,
  readingSystemMenuOptions,
} from './readingSystem/session';
import { Anatomy3DViewport } from './readingSystem/anatomy/Anatomy3DViewport';
import {
  ANATOMY3D_SOP_CLASS_HANDLER_ID,
  ANATOMY3D_VIEWPORT_NAMESPACE,
} from './readingSystem/anatomy/anatomy3dCell';
import { REFINE_TOOL_NAME, registerRefineTool } from './readingSystem/refine/PacsaiRefineTool';
import type { CornerstoneApi } from './readingSystem/anatomy/anatomyOverlay';
import {
  Enums as CsEnums,
  eventTarget as csEventTarget,
  getEnabledElement as csGetEnabledElement,
  getRenderingEngines as csGetRenderingEngines,
  metaData as csMetaData,
} from '@cornerstonejs/core';
import { ToolGroupManager as CsToolGroupManager } from '@cornerstonejs/tools';
import { READING_MODES_UITYPE, REFINE_AVAILABLE_EVALUATOR } from './getToolbarModule';
import initAllInOneAutoRefresh from './allinone/initAllInOneAutoRefresh';
import initScrollSyncBinding from './sync/initScrollSyncBinding';
import initMomentumScroll from './momentum/initMomentumScroll';
import initPerfusion4DProvider from './perfusion/initPerfusion4DProvider';
import registerHangingAttributes from './protocols/hangingAttributes';
import { endCaseBrowsingMode } from './allinone/browsingMode';
import {
  arrangeCaseChanged,
  hangingCaseEntered,
  hangingCaseLeft,
  openArrangeFromMenu,
} from './arrange/arrangeHost';

/** Sync type registered for cross-study (current vs prior) relative scroll sync. */
export const SCROLL_SYNC_TYPE = 'pacsaiscroll';

/** Sync type for the all-in-one compare: plane-grouped scroll (sagittal↔sagittal, …). */
export const ALL_IN_ONE_SCROLL_SYNC_TYPE = 'pacsaiallinonescroll';

// Rev 11 milestone 7: the custom hanging-protocol attribute ids (and their
// registration) live in protocols/hangingAttributes.ts.
export {
  PLANE_ATTRIBUTE,
  KERNEL_ATTRIBUTE,
  ROLE_ATTRIBUTE,
  COLOR_ATTRIBUTE,
  BVALUE_ATTRIBUTE,
  ALL_IN_ONE_ATTRIBUTE,
  IMAGE_ATTRIBUTE,
  DYNAMIC_ATTRIBUTE,
  REGION_TIMEPOINT_ATTRIBUTE,
} from './protocols/hangingAttributes';

/**
 * PACS-AI hanging protocols extension.
 *
 * Provides modality-aware current-vs-prior comparison protocols (CT / MR / CR-DX)
 * and a `loadRelevantPriors` command that auto-fetches the most relevant prior
 * study/studies and re-hangs them side by side with the current study.
 */
const pacsaiHpExtension: Types.Extensions.Extension = {
  id,

  preRegistration: ({ servicesManager, extensionManager }: Types.Extensions.ExtensionParams) => {
    const { syncGroupService, hangingProtocolService, displaySetService } =
      servicesManager.services;

    // Let the on-image prior switcher reach the data source / display sets: overlay
    // items are handed `servicesManager` only, and a prior swap needs to create
    // display sets for the chosen study before re-hanging.
    configurePriorSwitching({ servicesManager, extensionManager });

    // RS-36: the CT analysis pane's anatomy layers draw on cornerstone's viewports; a click
    // on them picks a structure only under a left-button tool that does nothing with a click.
    setReadingSystemCornerstone({
      Enums: CsEnums,
      eventTarget: csEventTarget,
      getEnabledElement: csGetEnabledElement,
      getRenderingEngines: csGetRenderingEngines,
      metaData: csMetaData,
      primaryTool: (element: HTMLElement) => {
        const enabled = csGetEnabledElement(element as HTMLDivElement);
        if (!enabled) {
          return undefined;
        }
        const group = CsToolGroupManager.getToolGroupForViewport(
          enabled.viewportId,
          enabled.renderingEngineId
        );
        return group ? (group.getActivePrimaryMouseButtonTool() ?? null) : undefined;
      },
    } as unknown as CornerstoneApi);

    // B01 (Rev 11 milestone 2): derive the display-set, first-pixels, matching-
    // render and tools-ready stages of the viewer attempt trace.
    initAttemptObservers({ servicesManager });

    // Rev 11 milestone 6 part 2: while the report window parks this frame (its
    // Report mode), the thumbnail pool waits on the image-pool governor, no
    // render is drawn and clips are paused; the prefetch pool (which also
    // streams volumes) and the interaction pool stay open, so a return to
    // Images draws at once. Once per document — the bridge is installed by
    // index.js before the boot, and a park that arrived before this ran is
    // replayed to the listener.
    const embedBridge = getEmbedBridge();
    if (embedBridge) {
      installParkedSuspend(embedBridge.onVisibilityChange, servicesManager.services);
    } else if (readingDockEnabled()) {
      // Rev 11 milestone 6, approach C: a top-level viewer with the reading
      // dock. The dock's Report mode covers the images, and the same suspend
      // keeps them quiet under it (readingDock.ts onParkedChange).
      installParkedSuspend(onParkedChange, servicesManager.services);
    }

    // Cross-study relative scroll synchronizer used by the protocols.
    syncGroupService?.addSynchronizerType?.(SCROLL_SYNC_TYPE, createScrollSyncSynchronizer);
    // Plane-grouped scroll sync for the all-in-one compare (sagittal↔sagittal, etc.).
    syncGroupService?.addSynchronizerType?.(
      ALL_IN_ONE_SCROLL_SYNC_TYPE,
      createAllInOneScrollSynchronizer
    );

    // Fix cornerstone3D's RGB StackViewport crash (size-vs-components RangeError)
    // so color series — RAPID perfusion/angio maps, 3D-spin, iMAR — render and
    // thumbnail without breaking the viewport. Idempotent.
    installRgbStackViewportFix((...args) => console.warn('[pacsai-hp]', ...args));

    // The custom attributes the compare protocols match on: plane, kernel, color,
    // 4D, b-value, all-in-one marker, image or not, comparison role and spine
    // region + timepoint (protocols/hangingAttributes.ts; milestone 7 moved them
    // there unchanged, for the protocols' regression fixtures).
    registerHangingAttributes({ hangingProtocolService, displaySetService });

    // Keep the all-in-one composites in sync with late-streaming series (covers the
    // single-study path, which builds once with no poll). Debounced; re-hangs only
    // when a composite is first created. One app-lifetime subscription (the
    // displaySetService singleton persists across mode enter/exit).
    initAllInOneAutoRefresh({ servicesManager, extensionManager });

    // Re-assert the all-in-one compare scroll-sync binding after each layout settles.
    // The stage's syncGroups are applied at ELEMENT_ENABLED, but the late-built
    // re-hangs mean synced stages are often reached by transitioning from a no-sync
    // stage while the grid keeps a viewport's element — so that pane never re-binds
    // and the sync silently dies (intermittent). This rebinds any unbound pane for
    // BOTH pacsai sync types (compare/multi-WL `pacsaiscroll` + all-in-one).
    initScrollSyncBinding({ servicesManager });

    // Flick-and-coast wheel scrolling for stack viewports (kill switch:
    // PACSAI_FLAGS.disableMomentumScroll; debug: PACSAI_DEBUG_MOMENTUM).
    initMomentumScroll();

    // Synthetic TemporalPositionIdentifier (from AcquisitionNumber) for perfusion
    // series lacking standard temporal tags → cs3d 4D detection + dynamic volume +
    // auto-cine light up natively. Strict series shape check; see the module doc.
    initPerfusion4DProvider();
  },

  getHangingProtocolModule,
  getCommandsModule,
  getToolbarModule,
  getPanelModule,
  // RS-36: the 3D anatomy cell in the viewer's grid (anatomy3dCell): its viewport, and the
  // handler its display set names (it makes no display sets: the cell's is built by the viewer).
  getViewportModule: () => [{ name: 'anatomy3d', component: Anatomy3DViewport }],
  getSopClassHandlerModule: () => [
    { name: 'anatomy3d', sopClassUids: [], getDisplaySetsFromSeries: () => [] },
  ],
};

export default pacsaiHpExtension;
export {
  studyRoleOverlayItem,
  STUDY_ROLE_OVERLAY_ITEM_ID,
  seriesTypeOverlayItem,
  SERIES_TYPE_OVERLAY_ITEM_ID,
  studyDescriptionOverlayItem,
  STUDY_DESCRIPTION_OVERLAY_ITEM_ID,
  patientInfoOverlayItems,
  clinicalContextOverlayItem,
  CLINICAL_CONTEXT_OVERLAY_ITEM_ID,
  getStudyRole,
  formatStudyDateTime,
  formatDicomTimeHM,
  OverlayTextLine,
  overlayTextLine,
  installImagePoolHold,
  // Rev 11 milestone 6, approach C: the reading dock, for the radcopilot mode.
  currentReadingDock,
  // 30 Oct: the session's studies, for radcopilot's gear menu in a narrow window.
  getSessionStudies,
  subscribeSessionStudies,
  ensureReadingDock,
  setReadingViewerUser,
  setReadingViewerServices,
  readingDockEnabled,
  routeStudyOf,
  launchFromQuery,
  READING_MODES,
  READING_MIC_KEY,
  railLayoutProps,
  IMAGES_WIDTH_VAR,
  IMAGES_BOTTOM_VAR,
  READING_MODES_UITYPE,
  // Rev 11 milestone 7: Arrange's case boundaries, for the radcopilot mode.
  endCaseBrowsingMode,
  arrangeCaseChanged,
  openArrangeFromMenu,
  // PR 2: the reader's hanging presets, read at the reading window's case entry.
  hangingCaseEntered,
  hangingCaseLeft,
  // RS-36: the CT reading system's pane in the report column (and its anatomy layers).
  enterReadingSystem,
  setReadingSystemUser,
  setReadingSystemServices,
  currentReadingSystem,
  currentAnatomy,
  onReadingSystemSelection,
  readingSystemEnabled,
  readingSystemMenuOptions,
  ANATOMY3D_SOP_CLASS_HANDLER_ID,
  ANATOMY3D_VIEWPORT_NAMESPACE,
  // RS-38: the refine tool (radcopilot puts it in the main toolbar).
  REFINE_TOOL_NAME,
  REFINE_AVAILABLE_EVALUATOR,
  registerRefineTool,
};
