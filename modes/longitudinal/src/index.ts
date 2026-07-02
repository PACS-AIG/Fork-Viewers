import { hotkeys } from '@ohif/core';
import i18n from 'i18next';
import {
  studyRoleOverlayItem,
  seriesTypeOverlayItem,
  studyDescriptionOverlayItem,
  patientInfoOverlayItems,
  clinicalContextOverlayItem,
  getStudyRole,
} from '@ohif/extension-pacsai-hp';
import { id } from './id';
import initToolGroups from './initToolGroups';
import toolbarButtons from './toolbarButtons';
import moreTools from './moreTools';
import ctWindowLevelPresets from './ctWindowLevelPresets';

// Allow this mode by excluding non-imaging modalities such as SR, SEG
// Also, SM is not a simple imaging modalities, so exclude it.
const NON_IMAGE_MODALITIES = ['ECG', 'SEG', 'RTSTRUCT', 'RTPLAN', 'PR'];

const ohif = {
  layout: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
  sopClassHandler: '@ohif/extension-default.sopClassHandlerModule.stack',
  thumbnailList: '@ohif/extension-default.panelModule.seriesList',
  wsiSopClassHandler:
    '@ohif/extension-cornerstone.sopClassHandlerModule.DicomMicroscopySopClassHandler',
};

const cornerstone = {
  measurements: '@ohif/extension-cornerstone.panelModule.panelMeasurement',
  segmentation: '@ohif/extension-cornerstone.panelModule.panelSegmentation',
};

const tracked = {
  measurements: '@ohif/extension-measurement-tracking.panelModule.trackedMeasurements',
  thumbnailList: '@ohif/extension-measurement-tracking.panelModule.seriesList',
  viewport: '@ohif/extension-measurement-tracking.viewportModule.cornerstone-tracked',
};

const dicomsr = {
  sopClassHandler: '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr',
  sopClassHandler3D: '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr-3d',
  viewport: '@ohif/extension-cornerstone-dicom-sr.viewportModule.dicom-sr',
};

const dicomvideo = {
  sopClassHandler: '@ohif/extension-dicom-video.sopClassHandlerModule.dicom-video',
  viewport: '@ohif/extension-dicom-video.viewportModule.dicom-video',
};

const dicompdf = {
  sopClassHandler: '@ohif/extension-dicom-pdf.sopClassHandlerModule.dicom-pdf',
  viewport: '@ohif/extension-dicom-pdf.viewportModule.dicom-pdf',
};

const dicomSeg = {
  sopClassHandler: '@ohif/extension-cornerstone-dicom-seg.sopClassHandlerModule.dicom-seg',
  viewport: '@ohif/extension-cornerstone-dicom-seg.viewportModule.dicom-seg',
};

const dicomPmap = {
  sopClassHandler: '@ohif/extension-cornerstone-dicom-pmap.sopClassHandlerModule.dicom-pmap',
  viewport: '@ohif/extension-cornerstone-dicom-pmap.viewportModule.dicom-pmap',
};

const dicomRT = {
  viewport: '@ohif/extension-cornerstone-dicom-rt.viewportModule.dicom-rt',
  sopClassHandler: '@ohif/extension-cornerstone-dicom-rt.sopClassHandlerModule.dicom-rt',
};

const extensionDependencies = {
  // Can derive the versions at least process.env.from npm_package_version
  '@ohif/extension-default': '^3.0.0',
  '@ohif/extension-cornerstone': '^3.0.0',
  '@ohif/extension-measurement-tracking': '^3.0.0',
  '@ohif/extension-cornerstone-dicom-sr': '^3.0.0',
  '@ohif/extension-cornerstone-dicom-seg': '^3.0.0',
  '@ohif/extension-cornerstone-dicom-pmap': '^3.0.0',
  '@ohif/extension-cornerstone-dicom-rt': '^3.0.0',
  '@ohif/extension-dicom-pdf': '^3.0.1',
  '@ohif/extension-dicom-video': '^3.0.1',
  '@ohif/extension-pacsai-hp': '^3.0.0',
};

// Segmentation is not part of the default diagnostic read, so its panel is kept
// out of the layout unless segmentation data is actually present (or the site
// forces it on via `window.PACSAI_FLAGS.enableSegmentationPanel`). Loading and
// viewing SEG/RTSTRUCT series stays fully supported — only the panel is lazy.
const SEG_PANEL_MODALITIES = new Set(['SEG', 'RTSTRUCT']);
const isSegPanelForced = () =>
  (window as any)?.PACSAI_FLAGS?.enableSegmentationPanel === true;

// Hotkeys: OHIF binds the MODE's `hotkeys` array (Mode.tsx setDefaultHotKeys) —
// `hotkeys` in the app config (config.js) is never consumed in this version, so
// customizations must live here. Keys 1-9 apply the first nine CT W/L presets
// from the same table that feeds the viewport window-level menu (single source
// of truth), replacing OHIF's five stock W/L bindings. NOTE: user-saved hotkeys
// (localStorage 'hotkey-definitions', written by the User Preferences dialog)
// still override these at runtime — reset preferences to pick up changes.
const ctWlPresetHotkeys = ctWindowLevelPresets.slice(0, 9).map((preset, index) => ({
  // setCtWindowLevel (pacsai-hp), NOT the raw setWindowLevel: these are CT
  // HU windows, so the command no-ops on non-CT viewports (on CR/DX they
  // wash the image out to white).
  commandName: 'setCtWindowLevel',
  commandOptions: { window: preset.window, level: preset.level },
  label: `W/L: ${preset.description}`,
  keys: [`${index + 1}`],
  isEditable: true,
}));

const modeHotkeys = [
  ...hotkeys.defaults.hotkeyBindings.filter(binding => binding.commandName !== 'setWindowLevel'),
  ...ctWlPresetHotkeys,
  {
    commandName: 'toggleClinicalContextOverlay',
    label: 'Toggle Clinical Context Overlay',
    keys: ['d'],
    isEditable: true,
  },
];

function modeFactory({ modeConfiguration }) {
  let _activatePanelTriggersSubscriptions = [];
  let _segPanelSubscription = null;
  let _segPanelAdded = false;
  return {
    // TODO: We're using this as a route segment
    // We should not be.
    id,
    routeName: 'viewer',
    displayName: i18n.t('Modes:Basic Viewer'),
    /**
     * Lifecycle hooks
     */
    onModeEnter: function ({ servicesManager, extensionManager, commandsManager }: withAppTypes) {
      const {
        measurementService,
        toolbarService,
        toolGroupService,
        customizationService,
        hangingProtocolService,
        displaySetService,
        panelService,
      } = servicesManager.services;

      measurementService.clearMeasurements();

      // Segmentation panel is excluded from the default layout; re-add it the
      // moment a SEG/RTSTRUCT displaySet exists in the session so real
      // segmentation data is never orphaned from its UI.
      const addSegPanelIfNeeded = (displaySets = []) => {
        if (_segPanelAdded) {
          return;
        }
        if (displaySets.some(ds => SEG_PANEL_MODALITIES.has(ds?.Modality))) {
          _segPanelAdded = true;
          panelService.addPanel(panelService.PanelPosition.Right, cornerstone.segmentation);
        }
      };
      _segPanelAdded = isSegPanelForced(); // already in the static layout — never double-add
      _segPanelSubscription = displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SETS_ADDED,
        ({ displaySetsAdded = [] } = {}) => addSegPanelIfNeeded(displaySetsAdded)
      );

      // Study-browser left rail: resolve each study's comparison role
      // (current / prior / sibling) from the pacsai-hp role registry, so each row
      // shows a green (current/report target) or amber (prior) status dot and the
      // report-target row is highlighted. activeStudyUID is read live per call so
      // the resolver stays correct across re-hangs and session-study switches.
      customizationService.setCustomizations({
        'studyBrowser.studyRoleResolver': {
          $set: (studyInstanceUID: string) =>
            getStudyRole(studyInstanceUID, hangingProtocolService.getState?.()?.activeStudyUID),
        },
      });

      // Radiologist-tuned CT window/level presets for the per-viewport
      // window-level action menu. Merged over the stock table so the other
      // modalities' presets (PT) are preserved.
      const stockWlPresets =
        customizationService.getCustomization('cornerstone.windowLevelPresets') || {};
      customizationService.setCustomizations({
        'cornerstone.windowLevelPresets': {
          $set: { ...stockWlPresets, CT: ctWindowLevelPresets },
        },
      });

      // Add the top-right viewport overlay badges: a green "CURRENT" / amber
      // "PRIOR · date · interval" study-role tag and a cyan series-type tag
      // (AXIAL/CORONAL/SAGITTAL · SOFT/BONE). Idempotent so re-entering the mode
      // doesn't duplicate them.
      const topRight = customizationService.getCustomization('viewportOverlay.topRight') || [];
      const existingIds = new Set(topRight.map((item: { id?: string }) => item?.id));
      const toAdd = [studyRoleOverlayItem, seriesTypeOverlayItem].filter(
        item => !existingIds.has(item.id)
      );
      if (toAdd.length) {
        customizationService.setCustomizations({
          'viewportOverlay.topRight': { $set: [...topRight, ...toAdd] },
        });
      }

      // Top-left overlay: (1) make the stock SeriesDescription reflect the CURRENT
      // image as you scroll — it reads `referenceInstance` (the displaySet's fixed
      // first instance), which is wrong for the all-in-one composite whose images span
      // many source series; prefer the current image's instance, falling back to
      // referenceInstance (identical for a normal single-series viewport, and the
      // fallback covers volume/multi-frame where instances[imageIndex] may be absent).
      // (2) Append a StudyDescription line beneath it (so each whole-spine pane names
      // its region). Idempotent.
      const topLeft = customizationService.getCustomization('viewportOverlay.topLeft') || [];
      const topLeftPatched = topLeft.map((item: any) =>
        item?.id === 'SeriesDescription'
          ? {
              ...item,
              condition: ({ instance, referenceInstance }: Record<string, any>) =>
                (instance ?? referenceInstance)?.SeriesDescription,
              contentF: ({ instance, referenceInstance }: Record<string, any>) =>
                (instance ?? referenceInstance)?.SeriesDescription,
            }
          : item
      );
      let topLeftItems = topLeftPatched.some(
        (item: { id?: string }) => item?.id === studyDescriptionOverlayItem.id
      )
        ? topLeftPatched
        : [...topLeftPatched, studyDescriptionOverlayItem];
      // (3) Clinical context (age · sex · indication) leads the top-left column —
      // the read-shaping facts stay in view on the image. Idempotent.
      if (!topLeftItems.some((item: { id?: string }) => item?.id === clinicalContextOverlayItem.id)) {
        topLeftItems = [clinicalContextOverlayItem, ...topLeftItems];
      }
      customizationService.setCustomizations({
        'viewportOverlay.topLeft': { $set: topLeftItems },
      });

      // Add patient identification (name, then MRN · sex · DOB) to the bottom-left
      // overlay, ahead of the window-level / zoom readouts. Idempotent.
      const bottomLeft = customizationService.getCustomization('viewportOverlay.bottomLeft') || [];
      const patientIds = new Set(patientInfoOverlayItems.map(item => item.id));
      if (!bottomLeft.some((item: { id?: string }) => item?.id && patientIds.has(item.id))) {
        customizationService.setCustomizations({
          'viewportOverlay.bottomLeft': { $set: [...patientInfoOverlayItems, ...bottomLeft] },
        });
      }

      // Init Default and SR ToolGroups
      initToolGroups(extensionManager, toolGroupService, commandsManager, this.labelConfig);

      toolbarService.addButtons([...toolbarButtons, ...moreTools]);
      toolbarService.createButtonSection('primary', [
        'SessionStudies',
        'MeasurementTools',
        'Zoom',
        'Pan',
        'TrackballRotate',
        'WindowLevel',
        'Capture',
        'Layout',
        'PreviousStage',
        'NextStage',
        'Crosshairs',
        'MoreTools',
        // Browsing-mode dropdown last, at the right end of the (center-justified)
        // toolbar row — kept away from the SessionStudies dropdown on the left so the
        // two selectors don't crowd together.
        'BrowsingMode',
      ]);

      // // ActivatePanel event trigger for when a segmentation or measurement is added.
      // // Do not force activation so as to respect the state the user may have left the UI in.
      // _activatePanelTriggersSubscriptions = [
      //   ...panelService.addActivatePanelTriggers(
      //     cornerstone.segmentation,
      //     [
      //       {
      //         sourcePubSubService: segmentationService,
      //         sourceEvents: [segmentationService.EVENTS.SEGMENTATION_ADDED],
      //       },
      //     ],
      //     true
      //   ),
      //   ...panelService.addActivatePanelTriggers(
      //     tracked.measurements,
      //     [
      //       {
      //         sourcePubSubService: measurementService,
      //         sourceEvents: [
      //           measurementService.EVENTS.MEASUREMENT_ADDED,
      //           measurementService.EVENTS.RAW_MEASUREMENT_ADDED,
      //         ],
      //       },
      //     ],
      //     true
      //   ),
      //   true,
      // ];
    },
    onSetupRouteComplete: ({ commandsManager }: withAppTypes) => {
      // Runs after the initial hanging protocol has been matched/applied. If the
      // active protocol is a comparison protocol, this fetches the relevant
      // prior(s) and re-hangs current-vs-prior side by side. No-op otherwise.
      commandsManager.run('loadRelevantPriors');
    },
    onModeExit: ({ servicesManager }: withAppTypes) => {
      const {
        toolGroupService,
        syncGroupService,
        segmentationService,
        cornerstoneViewportService,
        uiDialogService,
        uiModalService,
      } = servicesManager.services;

      _activatePanelTriggersSubscriptions.forEach(sub => sub.unsubscribe());
      _activatePanelTriggersSubscriptions = [];

      _segPanelSubscription?.unsubscribe();
      _segPanelSubscription = null;
      _segPanelAdded = false;

      uiDialogService.dismissAll();
      uiModalService.hide();
      toolGroupService.destroy();
      syncGroupService.destroy();
      segmentationService.destroy();
      cornerstoneViewportService.destroy();
    },
    validationTags: {
      study: [],
      series: [],
    },

    isValidMode: function ({ modalities }) {
      const modalities_list = modalities.split('\\');

      // Exclude non-image modalities
      return {
        valid: !!modalities_list.filter(modality => NON_IMAGE_MODALITIES.indexOf(modality) === -1)
          .length,
        description:
          'The mode does not support studies that ONLY include the following modalities: SM, ECG, SEG, RTSTRUCT',
      };
    },
    routes: [
      {
        path: 'longitudinal',
        /*init: ({ servicesManager, extensionManager }) => {
          //defaultViewerRouteInit
        },*/
        layoutTemplate: () => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [tracked.thumbnailList],
              leftPanelResizable: true,
              rightPanels: isSegPanelForced()
                ? [cornerstone.segmentation, tracked.measurements]
                : [tracked.measurements],
              rightPanelClosed: true,
              rightPanelResizable: true,
              viewports: [
                {
                  namespace: tracked.viewport,
                  displaySetsToDisplay: [
                    ohif.sopClassHandler,
                    dicomvideo.sopClassHandler,
                    dicomsr.sopClassHandler3D,
                    ohif.wsiSopClassHandler,
                  ],
                },
                {
                  namespace: dicomsr.viewport,
                  displaySetsToDisplay: [dicomsr.sopClassHandler],
                },
                {
                  namespace: dicompdf.viewport,
                  displaySetsToDisplay: [dicompdf.sopClassHandler],
                },
                {
                  namespace: dicomSeg.viewport,
                  displaySetsToDisplay: [dicomSeg.sopClassHandler],
                },
                {
                  namespace: dicomPmap.viewport,
                  displaySetsToDisplay: [dicomPmap.sopClassHandler],
                },
                {
                  namespace: dicomRT.viewport,
                  displaySetsToDisplay: [dicomRT.sopClassHandler],
                },
              ],
            },
          };
        },
      },
    ],
    extensions: extensionDependencies,
    // Modality-aware comparison protocols are listed first so the hanging
    // protocol service auto-matches by the current study's modality; `default`
    // is the fallback when none match. onSetupRouteComplete then auto-loads the
    // relevant prior(s) and re-hangs current-vs-prior side by side.
    hangingProtocol: [
      // Exam-specific (higher weight; win when the exam matches)
      '@pacsai/compareCTSpine',
      '@pacsai/compareMRSpine',
      '@pacsai/compareCTChest',
      '@pacsai/compareCTAChest',
      '@pacsai/compareCTARunoff',
      '@pacsai/compareCTAAbdPelvis',
      '@pacsai/compareCTPerfusion',
      '@pacsai/compareCTA',
      '@pacsai/compareCTHead',
      '@pacsai/compareCTNeck',
      '@pacsai/compareCTSkullBase',
      '@pacsai/compareMRBrain',
      '@pacsai/compareMRAbdomen',
      // Generic per-modality fallbacks
      '@pacsai/compareCT',
      '@pacsai/compareMR',
      '@pacsai/compareCR',
      // All-in-one only (browsing Mode 2): never auto-matched; forced by the toolbar.
      '@pacsai/allInOne',
      'default',
    ],
    // Order is important in sop class handlers when two handlers both use
    // the same sop class under different situations.  In that case, the more
    // general handler needs to come last.  For this case, the dicomvideo must
    // come first to remove video transfer syntax before ohif uses images
    sopClassHandlers: [
      dicomvideo.sopClassHandler,
      dicomSeg.sopClassHandler,
      dicomPmap.sopClassHandler,
      ohif.sopClassHandler,
      ohif.wsiSopClassHandler,
      dicompdf.sopClassHandler,
      dicomsr.sopClassHandler3D,
      dicomsr.sopClassHandler,
      dicomRT.sopClassHandler,
    ],
    hotkeys: modeHotkeys,
    ...modeConfiguration,
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
export { initToolGroups, moreTools, toolbarButtons };
