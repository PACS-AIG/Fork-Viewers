/**
 * Rev 11 milestone 6, approach C, phase 1: the `radcopilot` reading mode.
 *
 * The longitudinal mode as it is (its hanging protocols, SOP class handlers,
 * panels, viewports, tools, overlays and its mode enter and exit), made by
 * longitudinal's own factory, with the reading dock beside the images: the
 * app's v1 report editor, mounted as an island in a report column of this
 * page, outside OHIF's React tree (@ohif/extension-pacsai-hp readingDock/).
 *
 * What it adds to longitudinal, and nothing else:
 *   - its own route (`radcopilot`) and id, and no display name, so the study
 *     list never offers it (WorkList lists only modes that have one);
 *   - its own hotkey name, so a reader's saved OHIF hotkeys (the default
 *     `hotkey-definitions`) never replace its keys, and Alt+1/2/3 for
 *     Images / Both / Report;
 *   - with READING_DOCK on: the dock (mounted at the route's entry whether or
 *     not images load), the area below the header narrowed to the images'
 *     width, the header's reading controls, no return to the study list, and
 *     OHIF's own report (a DICOM SR) never asking anything: the tracking
 *     machine's prompts are off (measurement-tracking's trackingPrompts.ts),
 *     so there is no "track this series", no SR save and no SR hydrate prompt;
 *     and the series rail on the left (the study browser as one narrow,
 *     fixed-width column, readingDock/seriesRail.ts).
 * With READING_DOCK off it is the longitudinal viewer under another route.
 * The longitudinal mode's own files are not changed.
 */
import longitudinal from '@ohif/mode-longitudinal';
import { TRACKING_PROMPTS_CUSTOMIZATION } from '@ohif/extension-measurement-tracking';
import {
  IMAGES_WIDTH_VAR,
  READING_MIC_KEY,
  READING_MIC_UITYPE,
  READING_MODES,
  READING_MODES_UITYPE,
  currentReadingDock,
  ensureReadingDock,
  launchFromQuery,
  railLayoutProps,
  readingDockEnabled,
  routeStudyOf,
} from '@ohif/extension-pacsai-hp';
import { id } from './id';

/** The hotkey store's name: its own, so saved longitudinal hotkeys do not replace these. */
export const RADCOPILOT_HOTKEYS_NAME = 'radcopilot-hotkey-definitions';
export const RADCOPILOT_ROUTE = 'radcopilot';

const readingHotkeys = [
  ...READING_MODES.map(m => ({
    commandName: 'setReadingMode',
    commandOptions: { mode: m.value },
    label: `Reading layout: ${m.label}`,
    keys: m.keys,
    isEditable: true,
  })),
  // F4 (WeiWei, 17 Oct): listed for OHIF's shortcut sheet. The dock owns the key
  // on the whole page (readingDock.ts), so it is not offered for remapping here.
  {
    commandName: 'toggleReadingMic',
    label: READING_MIC_KEY.label,
    keys: [...READING_MIC_KEY.keys],
    isEditable: false,
  },
];

const readingButtons = [
  { id: 'ReadingModes', uiType: READING_MODES_UITYPE, props: {} },
  { id: 'ReadingMic', uiType: READING_MIC_UITYPE, props: {} },
];

/** The route's study for the dock, outside React's render (the dock writes the DOM). */
function enterReadingRoute(): void {
  if (!readingDockEnabled()) {
    return;
  }
  const search = window.location.search;
  const study = routeStudyOf(search);
  const launch = launchFromQuery(search);
  queueMicrotask(() => ensureReadingDock().enter(study, launch));
}

function modeFactory({ modeConfiguration }: { modeConfiguration?: Record<string, unknown> }) {
  const base = longitudinal.modeFactory({ modeConfiguration });
  const baseRoute = base.routes[0];
  const baseHotkeys = Array.isArray(base.hotkeys) ? base.hotkeys : (base.hotkeys?.hotkeys ?? []);

  return {
    ...base,
    id,
    routeName: RADCOPILOT_ROUTE,
    // No display name: the study list never offers this mode.
    displayName: '',
    /**
     * Every render of the mode's route, before its data source and layout:
     * the earliest point the route's study is known, so the report mounts
     * whether or not the images ever load. Idempotent.
     */
    onModeInit: function (args: Record<string, unknown>) {
      base.onModeInit?.call(this, args);
      enterReadingRoute();
    },
    onModeEnter: function (args: withAppTypes<{ studyInstanceUIDs?: string[] }>) {
      base.onModeEnter.call(this, args);
      if (readingDockEnabled()) {
        const { toolbarService, customizationService } = args.servicesManager.services;
        // The reader's report is the app's: OHIF's own (an SR) asks nothing here.
        // A mode customization, so the next mode entered starts without it.
        customizationService.setCustomizations({
          [TRACKING_PROMPTS_CUSTOMIZATION]: { $set: false },
        });
        toolbarService.addButtons(readingButtons);
        toolbarService.createButtonSection(
          'secondary',
          readingButtons.map(b => b.id)
        );
      }
      enterReadingRoute();
    },
    onModeExit: function (args: withAppTypes) {
      // A case switch, an error route or leaving the mode: the dock decides
      // once the router has moved (readingDock.ts routeLeft).
      currentReadingDock()?.routeLeft();
      base.onModeExit.call(this, args);
    },
    routes: [
      {
        ...baseRoute,
        path: RADCOPILOT_ROUTE,
        layoutTemplate: (args: Record<string, unknown>) => {
          const layout = baseRoute.layoutTemplate(args);
          if (!readingDockEnabled()) {
            return layout;
          }
          return {
            ...layout,
            props: {
              ...layout.props,
              // The images' width, which the dock keeps as the reader moves the divider.
              contentWidth: `var(${IMAGES_WIDTH_VAR}, 100%)`,
              studyListReturn: false,
              // The series rail (phase 1 PR 4): the study browser as one narrow,
              // fixed-width column, closed again if the reader closed it.
              ...railLayoutProps(),
            },
          };
        },
      },
    ],
    hotkeys: {
      name: RADCOPILOT_HOTKEYS_NAME,
      hotkeys: [...baseHotkeys, ...readingHotkeys],
    },
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies: longitudinal.extensionDependencies,
};

export default mode;
