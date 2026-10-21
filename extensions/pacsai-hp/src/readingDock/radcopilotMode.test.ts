/**
 * The radcopilot mode (modes/radcopilot/src/index.ts) is longitudinal's own
 * factory plus the reading dock. Longitudinal is stood in by a fake made of
 * sentinels, so the test can say exactly what is longitudinal's (the same
 * objects) and what the mode adds.
 */
const mockCalls: string[] = [];
const mockBase = {
  id: '@ohif/mode-longitudinal',
  routeName: 'viewer',
  displayName: 'Basic Viewer',
  hangingProtocol: ['@pacsai/compareCT', 'default'],
  sopClassHandlers: ['handler-a', 'handler-b'],
  extensions: { '@ohif/extension-default': '^3.0.0' },
  isValidMode: () => ({ valid: true }),
  hotkeys: [{ commandName: 'setCtWindowLevel', keys: ['1'] }],
  routes: [
    {
      path: 'longitudinal',
      layoutTemplate: () => ({
        id: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
        props: { leftPanels: ['tracked-series'], rightPanels: ['study-info'], rightPanelClosed: true },
      }),
    },
  ],
  onModeEnter: jest.fn(function (this: unknown) {
    mockCalls.push(`base.enter this=${(this as { id?: string })?.id}`);
  }),
  onModeExit: jest.fn(() => {
    mockCalls.push('base.exit');
  }),
};

jest.mock('@ohif/mode-longitudinal', () => ({
  __esModule: true,
  default: {
    modeFactory: jest.fn(() => mockBase),
    extensionDependencies: { '@ohif/extension-default': '^3.0.0', '@ohif/extension-pacsai-hp': '^3.0.0' },
  },
}));
// The mode turns measurement-tracking's prompts off through this customization (trackingPrompts.ts).
jest.mock('@ohif/extension-measurement-tracking', () => ({
  TRACKING_PROMPTS_CUSTOMIZATION: jest.requireActual(
    '../../../measurement-tracking/src/contexts/TrackedMeasurementsContext/trackingPrompts'
  ).TRACKING_PROMPTS_CUSTOMIZATION,
}));
jest.mock('@ohif/extension-pacsai-hp', () => ({
  ...jest.requireActual('./session'),
  ...jest.requireActual('./islandLoader'),
  READING_MODES: jest.requireActual('./dockModel').READING_MODES,
  READING_MIC_KEY: jest.requireActual('./dockModel').READING_MIC_KEY,
  railLayoutProps: jest.requireActual('./seriesRail').railLayoutProps,
  IMAGES_WIDTH_VAR: jest.requireActual('./readingDock').IMAGES_WIDTH_VAR,
  READING_MODES_UITYPE: 'pacsai.readingModes',
  READING_MIC_UITYPE: 'pacsai.readingMic',
}));

import longitudinal from '@ohif/mode-longitudinal';
import radcopilot, { RADCOPILOT_HOTKEYS_NAME } from '../../../../modes/radcopilot/src/index';
import { currentReadingDock } from './session';

const services = () => {
  const sections: Record<string, string[]> = {};
  const buttons: unknown[] = [];
  const customizations: unknown[] = [];
  return {
    sections,
    buttons,
    customizations,
    servicesManager: {
      services: {
        customizationService: {
          setCustomizations: (c: unknown, scope?: unknown) => customizations.push({ c, scope }),
        },
        toolbarService: {
          addButtons: (b: unknown[]) => buttons.push(...b),
          createButtonSection: (name: string, ids: string[]) => {
            sections[name] = ids;
          },
        },
      },
    },
  };
};

const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(async () => {
  delete (window as { PACSAI_READING_DOCK?: unknown }).PACSAI_READING_DOCK;
  await currentReadingDock()?.destroy();
  mockCalls.length = 0;
});

describe('the radcopilot mode', () => {
  it("is longitudinal's own factory: the same protocols, handlers, extensions and validity", () => {
    const m = radcopilot.modeFactory({ modeConfiguration: {} });
    expect((longitudinal as { modeFactory: jest.Mock }).modeFactory).toHaveBeenCalledWith({ modeConfiguration: {} });
    expect(m.hangingProtocol).toBe(mockBase.hangingProtocol);
    expect(m.sopClassHandlers).toBe(mockBase.sopClassHandlers);
    expect(m.extensions).toBe(mockBase.extensions);
    expect(m.isValidMode).toBe(mockBase.isValidMode);
    expect(radcopilot.extensionDependencies).toBe(
      (longitudinal as { extensionDependencies: unknown }).extensionDependencies
    );
  });

  it('has its own route and id, and no display name (out of the study list)', () => {
    const m = radcopilot.modeFactory({});
    expect(m.id).toBe('@ohif/mode-radcopilot');
    expect(m.routeName).toBe('radcopilot');
    expect(m.routes[0].path).toBe('radcopilot');
    expect(m.displayName).toBeFalsy();
    expect(mockBase.displayName).toBe('Basic Viewer');
  });

  it("keeps its hotkeys under their own name: longitudinal's, plus Alt+1/2/3", () => {
    const m = radcopilot.modeFactory({});
    expect(m.hotkeys.name).toBe(RADCOPILOT_HOTKEYS_NAME);
    expect(m.hotkeys.name).not.toBe('hotkey-definitions');
    expect(m.hotkeys.hotkeys.slice(0, mockBase.hotkeys.length)).toEqual(mockBase.hotkeys);
    expect(
      m.hotkeys.hotkeys
        .filter((h: { commandName: string }) => h.commandName === 'setReadingMode')
        .map((h: { keys: string[]; commandOptions: { mode: string } }) => `${h.keys[0]}=${h.commandOptions.mode}`)
    ).toEqual(['alt+1=images', 'alt+2=both', 'alt+3=report']);
  });

  it('lists F4, the microphone key, for the shortcut sheet, not for remapping (the dock owns it)', () => {
    const m = radcopilot.modeFactory({});
    const mic = m.hotkeys.hotkeys.filter(
      (h: { commandName: string }) => h.commandName === 'toggleReadingMic'
    );
    expect(mic).toEqual([
      {
        commandName: 'toggleReadingMic',
        label: 'Microphone on/off',
        keys: ['f4'],
        isEditable: false,
      },
    ]);
    const others = m.hotkeys.hotkeys.filter(
      (h: { commandName: string; keys: string[] }) =>
        h.commandName !== 'toggleReadingMic' && h.keys.includes('f4')
    );
    expect(others).toEqual([]);
  });

  it("with READING_DOCK on, narrows the images area and hides the study-list return; off, longitudinal's layout", () => {
    const m = radcopilot.modeFactory({});
    const off = m.routes[0].layoutTemplate({});
    expect(off).toEqual(mockBase.routes[0].layoutTemplate());
    (window as { PACSAI_READING_DOCK?: unknown }).PACSAI_READING_DOCK = '1';
    const on = m.routes[0].layoutTemplate({});
    expect(on.id).toBe(off.id);
    const {
      onLeftPanelClosedChange,
      headerMenuOptions,
      headerMenuSubscribe,
      headerWhiteLabeling,
      headerLogout,
      ...props
    } = on.props;
    expect(props).toEqual({
      ...off.props,
      contentWidth: 'var(--pacsai-reading-images-width, 100%)',
      studyListReturn: false,
      // PR 4: the series rail, fixed at 112 px, open unless the reader closed it.
      leftPanels: ['@ohif/extension-measurement-tracking.panelModule.seriesRail'],
      leftPanelResizable: false,
      leftPanelWidth: 112,
      leftPanelClosed: false,
    });
    expect(typeof onLeftPanelClosedChange).toBe('function');
    // 18 Oct: the dock's items for the viewer's gear menu, and their subscription
    // (stable functions; no dock here, so no items and a no-op unsubscribe).
    expect(headerMenuOptions()).toEqual([]);
    expect(typeof headerMenuSubscribe(() => {})).toBe('function');
    expect(m.routes[0].layoutTemplate({}).props.headerMenuOptions).toBe(headerMenuOptions);
    expect(off.props.headerMenuOptions).toBeUndefined();
    // 19 Oct: the header's mark is RadCopilot™ (the report's name), not the config's.
    const h = (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => ({
      type,
      props,
      children,
    });
    type Node = { type: string; props: Record<string, unknown> | null; children: unknown[] };
    const text = (n: unknown): string =>
      typeof n === 'string' ? n : (n as Node).children.map(text).join('');
    const mark = headerWhiteLabeling.createLogoComponentFn({ createElement: h }) as Node;
    expect(mark.props?.['aria-label']).toBe('RadCopilot');
    expect(text(mark)).toBe('RADCOPILOTTM');
    expect((mark.children[2] as Node).type).toBe('sup');
    expect(off.props.headerWhiteLabeling).toBeUndefined();
    // 21 Oct: the gear's Logout is the dock's (the app's sign-out when the viewer
    // holds the app's sign-in): a stable function; no dock here, so OHIF's own.
    expect(headerLogout()).toBe(false);
    expect(m.routes[0].layoutTemplate({}).props.headerLogout).toBe(headerLogout);
    expect(off.props.headerLogout).toBeUndefined();
  });

  it('the series rail stays closed for a reader who closed it, and the layout remembers a close', () => {
    (window as { PACSAI_READING_DOCK?: unknown }).PACSAI_READING_DOCK = '1';
    const m = radcopilot.modeFactory({});
    window.localStorage.removeItem('pacsai.radcopilot.seriesRailClosed');
    const first = m.routes[0].layoutTemplate({}).props;
    expect(first.leftPanelClosed).toBe(false);
    first.onLeftPanelClosedChange(true);
    expect(m.routes[0].layoutTemplate({}).props.leftPanelClosed).toBe(true);
    first.onLeftPanelClosedChange(false);
    expect(m.routes[0].layoutTemplate({}).props.leftPanelClosed).toBe(false);
    window.localStorage.removeItem('pacsai.radcopilot.seriesRailClosed');
  });

  it("enters as longitudinal does (the mode as `this`), then adds the reading controls when on", () => {
    const m = radcopilot.modeFactory({});
    const off = services();
    m.onModeEnter.call(m, { servicesManager: off.servicesManager });
    expect(mockCalls).toEqual(['base.enter this=@ohif/mode-radcopilot']);
    expect(off.sections.secondary).toBeUndefined();
    expect(off.customizations).toEqual([]);

    (window as { PACSAI_READING_DOCK?: unknown }).PACSAI_READING_DOCK = 'on';
    const on = services();
    m.onModeEnter.call(m, { servicesManager: on.servicesManager });
    expect(on.sections.secondary).toEqual(['ReadingModes', 'ReadingMic']);
  });

  it("with READING_DOCK on, turns OHIF's own report prompts off for this mode only (a mode customization)", () => {
    const m = radcopilot.modeFactory({});
    (window as { PACSAI_READING_DOCK?: unknown }).PACSAI_READING_DOCK = '1';
    const on = services();
    m.onModeEnter.call(m, { servicesManager: on.servicesManager });
    // The default scope (mode): cleared when the next mode enters.
    expect(on.customizations).toEqual([{ c: { 'measurementTracking.prompts': { $set: false } }, scope: undefined }]);
  });

  it("mounts the dock at the route's first render (onModeInit), whether or not images load, and only when on", async () => {
    window.history.replaceState(null, '', '/viewer/viewer/radcopilot?StudyInstanceUIDs=1.2.3&gatewayAET=X');
    const m = radcopilot.modeFactory({});
    m.onModeInit({});
    await flushMicrotasks();
    expect(currentReadingDock()).toBeNull();
    (window as { PACSAI_READING_DOCK?: unknown }).PACSAI_READING_DOCK = 'yes';
    m.onModeInit({});
    await flushMicrotasks();
    expect(currentReadingDock()).not.toBeNull();
    expect(document.querySelector('[data-pacsai-reading-column]')).not.toBeNull();
  });

  it("tells the dock the run ended before longitudinal's own exit", async () => {
    (window as { PACSAI_READING_DOCK?: unknown }).PACSAI_READING_DOCK = '1';
    window.history.replaceState(null, '', '/viewer/viewer/radcopilot?StudyInstanceUIDs=1.2.3');
    const m = radcopilot.modeFactory({});
    m.onModeInit({});
    await flushMicrotasks();
    const dock = currentReadingDock();
    const routeLeft = jest.spyOn(dock as NonNullable<typeof dock>, 'routeLeft');
    m.onModeExit.call(m, {});
    expect(routeLeft).toHaveBeenCalledTimes(1);
    expect(routeLeft.mock.invocationCallOrder[0]).toBeLessThan(mockBase.onModeExit.mock.invocationCallOrder.at(-1) as number);
  });
});
