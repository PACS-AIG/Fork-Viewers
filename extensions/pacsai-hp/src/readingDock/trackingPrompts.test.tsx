/**
 * Rev 11 milestone 6, approach C, phase 1 PR 2: OHIF's own report prompts off
 * in radcopilot. The gate is measurement-tracking's (trackingPrompts.ts, a
 * fork-core change); it lives in that extension's context, which every mode
 * shares, so these tests pin both halves: a mode that sets nothing (every
 * upstream mode, longitudinal included) gets each prompt as before, and a mode
 * that turns them off gets none, while the SR viewport's explicit LOAD stays.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';

const SR_HANDLER = '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr';

// The machine's services, as jest functions: a call means the machine
// entered that prompt's state. They never settle, so the state stays put.
const mockPrompts = {
  begin: jest.fn(() => new Promise(() => undefined)),
  newSeries: jest.fn(() => new Promise(() => undefined)),
  newStudy: jest.fn(() => new Promise(() => undefined)),
  hydratePrompt: jest.fn(() => new Promise(() => undefined)),
  hydrate: jest.fn(() => new Promise(() => undefined)),
  save: jest.fn(() => new Promise(() => undefined)),
  label: jest.fn(() => new Promise(() => undefined)),
};
jest.mock(
  '../../../measurement-tracking/src/contexts/TrackedMeasurementsContext/promptBeginTracking',
  () => ({
    __esModule: true,
    default: (...a: unknown[]) => mockPrompts.begin(...(a as [])),
  })
);
jest.mock(
  '../../../measurement-tracking/src/contexts/TrackedMeasurementsContext/promptTrackNewSeries',
  () => ({
    __esModule: true,
    default: (...a: unknown[]) => mockPrompts.newSeries(...(a as [])),
  })
);
jest.mock(
  '../../../measurement-tracking/src/contexts/TrackedMeasurementsContext/promptTrackNewStudy',
  () => ({
    __esModule: true,
    default: (...a: unknown[]) => mockPrompts.newStudy(...(a as [])),
  })
);
jest.mock(
  '../../../measurement-tracking/src/contexts/TrackedMeasurementsContext/promptHydrateStructuredReport',
  () => ({
    __esModule: true,
    default: (...a: unknown[]) => mockPrompts.hydratePrompt(...(a as [])),
  })
);
jest.mock(
  '../../../measurement-tracking/src/contexts/TrackedMeasurementsContext/hydrateStructuredReport',
  () => ({
    __esModule: true,
    default: (...a: unknown[]) => mockPrompts.hydrate(...(a as [])),
  })
);
jest.mock('@ohif/extension-default', () => ({
  promptSaveReport: (...a: unknown[]) => mockPrompts.save(...(a as [])),
  promptLabelAnnotation: (...a: unknown[]) => mockPrompts.label(...(a as [])),
}));
jest.mock('@state', () => ({ useAppConfig: () => [{}] }), { virtual: true });

// The viewport grid the context watches for an SR hung in the active viewport.
let mockGrid: {
  activeViewportId: string;
  viewports: Map<string, { displaySetInstanceUIDs: string[] }>;
};
const mockGridService = { setDisplaySetsForViewport: jest.fn() };
jest.mock('@ohif/ui-next', () => ({
  useViewportGrid: () => [mockGrid, mockGridService],
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Icons: { Download: () => null, Add: () => null, Delete: () => null },
}));

// The tracked measurements panel's own imports.
jest.mock('@ohif/core', () => ({
  DicomMetadataStore: {},
  utils: {
    MeasurementFilters: {
      filterAnd: () => () => true,
      filterPlanarMeasurement: () => true,
      filterMeasurementsBySeriesUID: () => () => true,
    },
  },
}));
jest.mock('@ohif/extension-cornerstone', () => ({
  StudySummaryFromMetadata: () => null,
  // The measurements list, with one measurement: the header renders as with a real one.
  PanelMeasurement: ({ customHeader }: { customHeader: (a: unknown) => React.ReactNode }) => (
    <div>{customHeader({ additionalFindings: [], measurements: [{ uid: 'm1' }] })}</div>
  ),
}));

import {
  PROMPTING_EVENTS,
  TRACKING_PROMPTS_CUSTOMIZATION,
  gateTrackingSend,
  trackingPromptsOff,
} from '../../../measurement-tracking/src/contexts/TrackedMeasurementsContext/trackingPrompts';
import {
  TrackedMeasurementsContextProvider,
  useTrackedMeasurements,
} from '../../../measurement-tracking/src/contexts/TrackedMeasurementsContext/TrackedMeasurementsContext';
import PanelMeasurementTableTracking from '../../../measurement-tracking/src/panels/PanelMeasurementTableTracking';

/** A customization service: `off` true is what radcopilot sets (false under the key). */
const customization = (state: { off: boolean }) => ({
  getCustomization: jest.fn((id: string) =>
    id === TRACKING_PROMPTS_CUSTOMIZATION && state.off ? false : undefined
  ),
});

const SR = {
  displaySetInstanceUID: 'sr-ds',
  SeriesInstanceUID: 'sr-series',
  SOPClassHandlerId: SR_HANDLER,
  isRehydratable: true,
  isLoaded: true,
};

function harness(state: { off: boolean }) {
  const customizationService = customization(state);
  const commands: Record<string, (p?: unknown) => unknown> = {};
  const deps = {
    servicesManager: {
      services: {
        measurementService: { getMeasurements: () => [], remove: jest.fn() },
        displaySetService: {
          getDisplaySetByUID: (uid: string) => (uid === SR.displaySetInstanceUID ? SR : undefined),
        },
        customizationService,
      },
    },
    commandsManager: {
      registerCommand: (
        _ctx: string,
        name: string,
        def: { commandFn: (p?: unknown) => unknown }
      ) => {
        commands[name] = def.commandFn;
      },
      runCommand: jest.fn(),
    },
    extensionManager: {},
  };
  const Provider = (
    TrackedMeasurementsContextProvider as unknown as (...a: unknown[]) => React.ReactElement
  ).bind(null, deps) as unknown as React.FC<{ children: React.ReactNode }>;
  let api: { state: () => string; send: (type: string, payload?: unknown) => unknown } | null =
    null;
  function Probe() {
    const [machine, send] = useTrackedMeasurements();
    api = { state: () => String(machine.value), send };
    return <span data-testid="state">{String(machine.value)}</span>;
  }
  return { deps, Provider, Probe, commands, api: () => api as NonNullable<typeof api> };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });

beforeEach(() => {
  Object.values(mockPrompts).forEach(m => m.mockClear());
  mockGrid = { activeViewportId: 'vp1', viewports: new Map() };
});

describe('the gate (trackingPrompts.ts)', () => {
  it('holds back exactly the prompting events, and only while the mode has the prompts off', () => {
    const state = { off: false };
    const send = jest.fn((e: unknown) => `state after ${String(e)}`);
    const gated = gateTrackingSend(send, customization(state));
    const all = [
      'TRACK_SERIES',
      'SAVE_REPORT',
      'PROMPT_HYDRATE_SR',
      'RESTORE_PROMPT_HYDRATE_SR',
      'HYDRATE_SR',
      'UNTRACK_SERIES',
      'SET_DIRTY',
      'UPDATE_ACTIVE_VIEWPORT_ID',
    ];
    all.forEach(e => {
      expect(gated(e, { x: 1 })).toBe(`state after ${e}`); // unset: the very same call and answer
    });
    expect(send).toHaveBeenCalledTimes(all.length);
    state.off = true;
    send.mockClear();
    all.forEach(e => {
      gated(e);
      gated({ type: e });
    });
    const passed = send.mock.calls.map(c =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { type: string }).type
    );
    expect([...new Set(passed)]).toEqual([
      'HYDRATE_SR',
      'UNTRACK_SERIES',
      'SET_DIRTY',
      'UPDATE_ACTIVE_VIEWPORT_ID',
    ]);
    expect([...PROMPTING_EVENTS].sort()).toEqual([
      'PROMPT_HYDRATE_SR',
      'RESTORE_PROMPT_HYDRATE_SR',
      'SAVE_REPORT',
      'TRACK_SERIES',
    ]);
  });

  it('reads the customization: only false turns the prompts off, and a throwing reader leaves them on', () => {
    expect(trackingPromptsOff(undefined)).toBe(false);
    expect(trackingPromptsOff({ getCustomization: () => undefined })).toBe(false);
    expect(trackingPromptsOff({ getCustomization: () => true })).toBe(false);
    expect(trackingPromptsOff({ getCustomization: () => 'off' })).toBe(false);
    expect(trackingPromptsOff({ getCustomization: () => false })).toBe(true);
    expect(
      trackingPromptsOff({
        getCustomization: () => {
          throw new Error('no');
        },
      })
    ).toBe(false);
  });
});

describe("measurement-tracking's context", () => {
  it('an SR hung in the active viewport: the hydrate prompt as before; with the prompts off, none', async () => {
    for (let i = 0; i < 2; i++) {
      const off = i === 1;
      mockPrompts.hydratePrompt.mockClear();
      mockGrid = {
        activeViewportId: 'vp1',
        viewports: new Map([['vp1', { displaySetInstanceUIDs: [SR.displaySetInstanceUID] }]]),
      };
      const h = harness({ off });
      const { unmount } = render(
        <h.Provider>
          <h.Probe />
        </h.Provider>
      );
      await flush();
      expect(mockPrompts.hydratePrompt).toHaveBeenCalledTimes(off ? 0 : 1);
      expect(screen.getByTestId('state').textContent).toBe(
        off ? 'idle' : 'promptHydrateStructuredReport'
      );
      unmount();
    }
  });

  it("a new measurement (TRACK_SERIES, through the context's send): the tracking prompt as before; off, none", async () => {
    for (let i = 0; i < 2; i++) {
      const off = i === 1;
      mockPrompts.begin.mockClear();
      const h = harness({ off });
      const { unmount } = render(
        <h.Provider>
          <h.Probe />
        </h.Provider>
      );
      await flush();
      act(() => {
        h.api().send('SET_DIRTY', { SeriesInstanceUID: 's1' });
        h.api().send('TRACK_SERIES', {
          viewportId: 'vp1',
          StudyInstanceUID: 'st1',
          SeriesInstanceUID: 's1',
        });
      });
      await flush();
      expect(mockPrompts.begin).toHaveBeenCalledTimes(off ? 0 : 1);
      expect(h.api().state()).toBe(off ? 'idle' : 'promptBeginTracking');
      unmount();
    }
  });

  it('the SR save (SAVE_REPORT) while tracking: the save prompt as before; off, none', async () => {
    for (let i = 0; i < 2; i++) {
      const off = i === 1;
      mockPrompts.save.mockClear();
      const state = { off: false };
      const h = harness(state);
      const { unmount } = render(
        <h.Provider>
          <h.Probe />
        </h.Provider>
      );
      await flush();
      act(() => {
        h.api().send('SET_TRACKED_SERIES', { StudyInstanceUID: 'st1', SeriesInstanceUIDs: ['s1'] });
      });
      await flush();
      expect(h.api().state()).toBe('tracking');
      state.off = off; // the mode's customization, read when the event is sent
      act(() => {
        h.api().send('SAVE_REPORT', { viewportId: 'vp1', isBackupSave: true });
      });
      await flush();
      expect(mockPrompts.save).toHaveBeenCalledTimes(off ? 0 : 1);
      expect(h.api().state()).toBe(off ? 'tracking' : 'promptSaveReport');
      unmount();
    }
  });

  it("an SR viewport's own LOAD (HYDRATE_SR) still loads it with the prompts off", async () => {
    const h = harness({ off: true });
    const { unmount } = render(
      <h.Provider>
        <h.Probe />
      </h.Provider>
    );
    await flush();
    act(() => {
      h.commands.loadTrackedSRMeasurements({ displaySetInstanceUID: SR.displaySetInstanceUID });
    });
    await flush();
    expect(mockPrompts.hydrate).toHaveBeenCalledTimes(1);
    expect(h.api().state()).toBe('hydrateStructuredReport');
    unmount();
  });
});

describe('the tracked measurements panel', () => {
  it('offers "Create SR" as before; with the prompts off, CSV and Delete All only', async () => {
    for (let i = 0; i < 2; i++) {
      const off = i === 1;
      const h = harness({ off });
      const Panel = PanelMeasurementTableTracking as unknown as React.FC<Record<string, unknown>>;
      const { unmount } = render(
        <h.Provider>
          <Panel
            servicesManager={h.deps.servicesManager}
            extensionManager={{}}
            commandsManager={h.deps.commandsManager}
          />
        </h.Provider>
      );
      await flush();
      expect(screen.queryByText('Create SR') !== null).toBe(!off);
      expect(screen.getByText('CSV')).toBeTruthy();
      expect(screen.getByText('Delete All')).toBeTruthy();
      unmount();
    }
  });
});
