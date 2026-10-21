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
 *     fixed-width column, readingDock/seriesRail.ts); and the header's mark is
 *     the report's product, RadCopilot™, in place of the config's PACS AI,
 *     and its patient line gives way where the row is too narrow for it.
 * With READING_DOCK off it is the longitudinal viewer under another route.
 * The longitudinal mode's own files are not changed.
 */
import longitudinal from '@ohif/mode-longitudinal';
import { TRACKING_PROMPTS_CUSTOMIZATION } from '@ohif/extension-measurement-tracking';
import {
  IMAGES_WIDTH_VAR,
  READING_MIC_KEY,
  READING_MODES,
  READING_MODES_UITYPE,
  currentReadingDock,
  ensureReadingDock,
  launchFromQuery,
  railLayoutProps,
  readingDockEnabled,
  routeStudyOf,
  setReadingViewerUser,
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

// One item (22 Oct): the layout's buttons and, in Images, the report's
// microphone beside them; as two, the microphone stacked under the buttons.
const readingButtons = [{ id: 'ReadingModes', uiType: READING_MODES_UITYPE, props: {} }];

/** The route's study for the dock, outside React's render (the dock writes the DOM). */
function enterReadingRoute(servicesManager?: unknown): void {
  if (!readingDockEnabled()) {
    return;
  }
  // Phase 2 (PR 4): the viewer's own sign-in, for the report's identity gate.
  const auth = (servicesManager as { services?: Record<string, unknown> } | undefined)?.services
    ?.userAuthenticationService as { getUser?: () => unknown } | undefined;
  if (auth && typeof auth.getUser === 'function') {
    setReadingViewerUser(() => auth.getUser?.());
  }
  const search = window.location.search;
  const study = routeStudyOf(search);
  const launch = launchFromQuery(search);
  queueMicrotask(() => ensureReadingDock().enter(study, launch));
}

// 18 Oct: the dock's items for the viewer's gear menu (stable functions, so the
// header subscribes once): the report's settings and its quiet_workspace switch.
const readingMenuOptions = () => currentReadingDock()?.menuOptions() ?? [];
const readingMenuSubscribe = (listener: () => void) =>
  currentReadingDock()?.subscribe(listener) ?? (() => {});
// 21 Oct: the gear's Logout, the dock's when the viewer holds the app's sign-in.
const readingLogout = () => currentReadingDock()?.logout() ?? false;

type CreateElement = (
  type: string,
  props: Record<string, unknown> | null,
  ...children: unknown[]
) => unknown;

/**
 * 19 Oct (WeiWei): the reading window's mark is the report's product name, in
 * place of the config's PACS AI, now that the report's own header row (where
 * the name sat) folds away. The name as the report writes it (RADCOPILOT and a
 * superscript TM), in the style of the viewer's own mark (the deploy repo's
 * config.js whiteLabeling: 16 px, 0.08em, the light part then the cyan one).
 * Built with the header's React, as config.js's is.
 */
const WORDMARK_PART = { fontSize: '16px', letterSpacing: '0.08em' };
const RADCOPILOT_WHITE_LABELING = {
  createLogoComponentFn: ({ createElement }: { createElement: CreateElement }) =>
    createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'baseline',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        },
        'aria-label': 'RadCopilot',
        'data-cy': 'radcopilot-wordmark',
      },
      createElement(
        'span',
        { style: { ...WORDMARK_PART, color: '#EAF6FF', fontWeight: 600 } },
        'RAD'
      ),
      createElement(
        'span',
        { style: { ...WORDMARK_PART, color: '#31D7FF', fontWeight: 700 } },
        'COPILOT'
      ),
      createElement(
        'sup',
        {
          style: {
            color: '#EAF6FF',
            fontSize: '9px',
            fontWeight: 600,
            marginLeft: '2px',
            opacity: 0.7,
          },
        },
        'TM'
      )
    ),
};

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
      enterReadingRoute(args.servicesManager);
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
      enterReadingRoute(args.servicesManager);
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
              // 18 Oct: the report's settings and its quiet_workspace switch in
              // the viewer's gear menu (the report's own header row folds away).
              headerMenuOptions: readingMenuOptions,
              headerMenuSubscribe: readingMenuSubscribe,
              // 19 Oct: the header's mark is RadCopilot™.
              headerWhiteLabeling: RADCOPILOT_WHITE_LABELING,
              // 21 Oct: Logout signs out of the app when the viewer holds its sign-in.
              headerLogout: readingLogout,
              // 22 Oct: at 200 % zoom (960 CSS px) the mark, the reading controls
              // and the patient line were wider than the row, and the page
              // scrolled sideways (1 to 3 px, more as the line's image count
              // grew); the line gives way (cut, its whole text in its title).
              headerPatientInfoShrinks: true,
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
