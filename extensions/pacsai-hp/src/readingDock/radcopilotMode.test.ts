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
jest.mock('@ohif/extension-pacsai-hp', () => ({
  ...jest.requireActual('./session'),
  ...jest.requireActual('./islandLoader'),
  READING_MODES: jest.requireActual('./dockModel').READING_MODES,
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
  return {
    sections,
    buttons,
    servicesManager: {
      services: {
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

  it("with READING_DOCK on, narrows the images area and hides the study-list return; off, longitudinal's layout", () => {
    const m = radcopilot.modeFactory({});
    const off = m.routes[0].layoutTemplate({});
    expect(off).toEqual(mockBase.routes[0].layoutTemplate());
    (window as { PACSAI_READING_DOCK?: unknown }).PACSAI_READING_DOCK = '1';
    const on = m.routes[0].layoutTemplate({});
    expect(on.id).toBe(off.id);
    expect(on.props).toEqual({
      ...off.props,
      contentWidth: 'var(--pacsai-reading-images-width, 100%)',
      studyListReturn: false,
    });
  });

  it("enters as longitudinal does (the mode as `this`), then adds the reading controls when on", () => {
    const m = radcopilot.modeFactory({});
    const off = services();
    m.onModeEnter.call(m, { servicesManager: off.servicesManager });
    expect(mockCalls).toEqual(['base.enter this=@ohif/mode-radcopilot']);
    expect(off.sections.secondary).toBeUndefined();

    (window as { PACSAI_READING_DOCK?: unknown }).PACSAI_READING_DOCK = 'on';
    const on = services();
    m.onModeEnter.call(m, { servicesManager: on.servicesManager });
    expect(on.sections.secondary).toEqual(['ReadingModes', 'ReadingMic']);
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
