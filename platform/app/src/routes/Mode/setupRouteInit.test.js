/**
 * Route init scoped to the run (Rev 11 milestone 6 part 2, the in-page case
 * switch). An in-document switch re-runs Mode.tsx's route-init effect while the
 * previous case's metadata can still be in flight. Over a fake archive whose
 * answers the test releases after the cleanup:
 *  - the INSTANCES_ADDED unsubscribe is called synchronously by the cleanup;
 *  - a superseded run calls neither hangingProtocolService.run, nor a remaining
 *    series' start(), nor onSetupRouteComplete;
 *  - an instance outside the run's case set makes no display set;
 *  - what the run itself asks the data source for still hangs: a selectPrior
 *    pick (the real one), a non-qualifying prior, rail expansion.
 * The real setupRouteInit, defaultRouteInit and requestDisplaySetCreationForStudy.
 */
jest.mock(
  '@ohif/core',
  () => {
    const listeners = new Set();
    const DicomMetadataStore = {
      EVENTS: { INSTANCES_ADDED: 'event::dicomMetadataStore:instancesAdded' },
      subscribe: jest.fn((event, callback) => {
        const entry = { event, callback };
        listeners.add(entry);
        return { unsubscribe: jest.fn(() => listeners.delete(entry)) };
      }),
      getSeries: (StudyInstanceUID, SeriesInstanceUID) => ({
        instances: [{ StudyInstanceUID, SeriesInstanceUID }],
      }),
      getStudy: StudyInstanceUID => ({ StudyInstanceUID }),
      /** The test's: instances of a series arrived, and the store says so. */
      mockAddInstances: (StudyInstanceUID, SeriesInstanceUID) =>
        [...listeners]
          .filter(l => l.event === DicomMetadataStore.EVENTS.INSTANCES_ADDED)
          .forEach(l => l.callback({ StudyInstanceUID, SeriesInstanceUID })),
      mockSubscribers: () => listeners.size,
    };
    const { getSplitParam } = jest.requireActual('../../../../core/src/utils/splitComma');
    return {
      DicomMetadataStore,
      log: { time: () => undefined, timeEnd: () => undefined },
      utils: { getSplitParam, attempt: { snapshot: () => ({ generation: 1 }) } },
      Enums: { TimingEnum: {} },
      classes: { ImageSet: class {} },
    };
  },
  { virtual: true }
);
jest.mock(
  '@ohif/extension-default',
  () => ({
    requestDisplaySetCreationForStudy: jest.requireActual(
      '../../../../../extensions/default/src/Panels/requestDisplaySetCreationForStudy'
    ).default,
  }),
  { virtual: true }
);

import { DicomMetadataStore } from '@ohif/core';
import { setupRouteInit, beginRouteRun } from './setupRouteInit';
import requestDisplaySetCreationForStudy from '../../../../../extensions/default/src/Panels/requestDisplaySetCreationForStudy';
import selectPrior from '../../../../../extensions/pacsai-hp/src/priors/selectPrior';
import {
  setComparisonRoles,
  clearComparisonRoles,
} from '../../../../../extensions/pacsai-hp/src/priors/roleRegistry';

const A = '1.2.840.99.1'; // the case the document opened with
const B = '1.2.840.99.2'; // the case switched to (another patient)
const PA = '1.2.840.99.10'; // A's prior, whose metadata was in flight at the switch
const PB = '1.2.840.99.20'; // B's prior, the loader's pick
const PICK = '1.2.840.99.21'; // a prior the reader picks on B (qualifying or not)
const RAIL = '1.2.840.99.22'; // a study the reader expands in the rail
const X = '1.2.840.99.99'; // a study nobody in B's run asked for

/** Let the route init's promise chains run (no timers involved). */
async function settle() {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * The archive behind the active data source. Each study answers its series list
 * when the test says, then each series' metadata when the test says; a series
 * that answers adds its instances to the store (INSTANCES_ADDED), as
 * storeInstances does.
 */
function fakeArchive({ seriesPerStudy = 2 } = {}) {
  const studies = new Map();
  const study = StudyInstanceUID => {
    if (!studies.has(StudyInstanceUID)) {
      const list = deferred();
      const series = Array.from({ length: seriesPerStudy }, (_, i) => {
        const answer = deferred();
        const SeriesInstanceUID = `${StudyInstanceUID}.${i + 1}`;
        return {
          SeriesInstanceUID,
          start: jest.fn(() => answer.promise),
          answer: () => {
            DicomMetadataStore.mockAddInstances(StudyInstanceUID, SeriesInstanceUID);
            answer.resolve();
          },
          /** Instances arrive, but the request has not settled yet. */
          arrive: () => DicomMetadataStore.mockAddInstances(StudyInstanceUID, SeriesInstanceUID),
          settle: () => answer.resolve(),
        };
      });
      studies.set(StudyInstanceUID, { list, series, answerList: () => list.resolve(series) });
    }
    return studies.get(StudyInstanceUID);
  };
  const metadata = jest.fn(function ({ StudyInstanceUID, returnPromises = false }) {
    const { list } = study(StudyInstanceUID);
    if (returnPromises) {
      return list.promise;
    }
    return list.promise.then(series => Promise.all(series.map(s => s.start())));
  });
  const dataSource = { retrieve: { series: { metadata } } };
  /** Answer a study entirely: its list, then every series. */
  const load = async StudyInstanceUID => {
    study(StudyInstanceUID).answerList();
    await settle();
    study(StudyInstanceUID).series.forEach(s => s.answer());
    await settle();
  };
  return { dataSource, metadata, study, load };
}

/** The viewer's services and managers as the route init reads them. */
function fakeViewer(archive) {
  const state = { active: undefined };
  const displaySets = [];
  const displaySetService = {
    init: jest.fn(),
    activeDisplaySets: displaySets,
    getActiveDisplaySets: () => displaySets,
    getDisplaySetByUID: uid => displaySets.find(ds => ds.displaySetInstanceUID === uid),
    makeDisplaySets: jest.fn(instances => {
      const [{ StudyInstanceUID, SeriesInstanceUID }] = instances;
      const ds = {
        displaySetInstanceUID: `ds-${SeriesInstanceUID}`,
        StudyInstanceUID,
        SeriesInstanceUID,
        numImageFrames: 40,
      };
      displaySets.push(ds);
      return [ds];
    }),
  };
  const hangingProtocolService = {
    getProtocolById: () => undefined,
    getStageIndex: () => 0,
    setActiveProtocolIds: jest.fn(),
    getState: () => ({ activeStudyUID: state.active }),
    // The first series is the protocol's required one; the rest load after the hang.
    filterSeriesRequiredForRun: (_id, seriesPromises) => ({
      requiredSeries: seriesPromises.slice(0, 1),
      remaining: seriesPromises.slice(1),
    }),
    run: jest.fn(({ activeStudy }) => {
      state.active = activeStudy?.StudyInstanceUID;
    }),
  };
  const services = {
    displaySetService,
    hangingProtocolService,
    uiNotificationService: { show: jest.fn(() => 'notice'), hide: jest.fn() },
    customizationService: { getCustomization: () => undefined },
    viewportGridService: { getState: () => ({ viewports: new Map() }) },
  };
  const servicesManager = { services };
  const extensionManager = {
    onModeEnter: jest.fn(),
    onModeExit: jest.fn(),
    getActiveDataSource: () => [archive.dataSource],
  };
  const mode = {
    onModeEnter: jest.fn(),
    onModeExit: jest.fn(),
    onSetupRouteComplete: jest.fn(),
  };
  /** One mode entry for the route's studies (Mode.tsx's effect); returns its cleanup. */
  const enter = (studyInstanceUIDs, route = {}) =>
    setupRouteInit({
      mode,
      route,
      servicesManager,
      extensionManager,
      commandsManager: {},
      hotkeysManager: {},
      appConfig: {},
      dataSource: archive.dataSource,
      studyInstanceUIDs,
      query: new URLSearchParams(`StudyInstanceUIDs=${studyInstanceUIDs.join(',')}`),
      sopClassHandlers: [],
      hangingProtocol: '@pacsai/compareCT',
      runTimeHangingProtocolId: null,
      runTimeStageId: null,
    });
  const madeFor = uid =>
    displaySetService.makeDisplaySets.mock.calls.filter(
      ([instances]) => instances[0].StudyInstanceUID === uid
    ).length;
  return {
    state,
    displaySets,
    displaySetService,
    hangingProtocolService,
    extensionManager,
    servicesManager,
    mode,
    enter,
    madeFor,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  DicomMetadataStore.subscribe.mockClear();
  clearComparisonRoles();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('setupRouteInit: a run that stays current (the control)', () => {
  it('hangs its study, starts its remaining series, makes its display sets and completes', async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    viewer.enter([A]);
    await archive.load(A);

    expect(viewer.madeFor(A)).toBe(2);
    expect(viewer.hangingProtocolService.run).toHaveBeenCalled();
    expect(viewer.hangingProtocolService.run.mock.calls[0][0].activeStudy).toEqual({
      StudyInstanceUID: A,
    });
    expect(archive.study(A).series[1].start).toHaveBeenCalled();
    expect(viewer.mode.onSetupRouteComplete).toHaveBeenCalledTimes(1);
  });

  it("hands the mode's onModeEnter the route's studyInstanceUIDs", () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    viewer.enter([B]);
    expect(viewer.mode.onModeEnter).toHaveBeenCalledWith(
      expect.objectContaining({ studyInstanceUIDs: [B] })
    );
  });
});

describe('setupRouteInit: the cleanup', () => {
  it('calls the INSTANCES_ADDED unsubscribe synchronously, while the route init still awaits its metadata', () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    const before = DicomMetadataStore.mockSubscribers();
    const cleanup = viewer.enter([A]);
    const [{ value: subscription }] = DicomMetadataStore.subscribe.mock.results;
    expect(DicomMetadataStore.mockSubscribers()).toBe(before + 1);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();

    cleanup(); // nothing of A's metadata has answered yet

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(DicomMetadataStore.mockSubscribers()).toBe(before);
    expect(viewer.mode.onModeExit).toHaveBeenCalledTimes(1);
    expect(viewer.extensionManager.onModeExit).toHaveBeenCalledTimes(1);
  });

  it("A's instances arriving after the cleanup make no display set", async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    const cleanup = viewer.enter([A]);
    cleanup();
    await archive.load(A);
    expect(viewer.madeFor(A)).toBe(0);
  });
});

describe('setupRouteInit: a superseded run', () => {
  it('superseded while its series list loads: starts no series, runs no protocol, does not complete', async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    const cleanup = viewer.enter([A]);
    cleanup();

    archive.study(A).answerList();
    await settle();

    archive.study(A).series.forEach(s => expect(s.start).not.toHaveBeenCalled());
    expect(viewer.hangingProtocolService.run).not.toHaveBeenCalled();
    expect(viewer.mode.onSetupRouteComplete).not.toHaveBeenCalled();
  });

  it('superseded while its required series load: runs no protocol, starts no remaining series, does not complete', async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    const cleanup = viewer.enter([A]);
    archive.study(A).answerList();
    await settle();
    const [required, remaining] = archive.study(A).series;
    expect(required.start).toHaveBeenCalled();
    required.arrive(); // A has a display set: a hang would have something to run on
    expect(viewer.madeFor(A)).toBe(1);

    cleanup(); // the switch to B
    required.settle();
    await settle();

    expect(viewer.hangingProtocolService.run).not.toHaveBeenCalled();
    expect(remaining.start).not.toHaveBeenCalled();
    expect(viewer.mode.onSetupRouteComplete).not.toHaveBeenCalled();
  });

  it("superseded while the mode's route.init runs: never reaches the default route init", async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    const routeInit = deferred();
    const cleanup = viewer.enter([A], { init: jest.fn(() => routeInit.promise) });
    cleanup();
    routeInit.resolve([]);
    await settle();
    expect(archive.metadata).not.toHaveBeenCalled();
    expect(DicomMetadataStore.subscribe).not.toHaveBeenCalled();
    expect(viewer.mode.onSetupRouteComplete).not.toHaveBeenCalled();
  });

  it("A → B: A's late metadata neither hangs A nor completes A, and B's run hangs B", async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    const cleanupA = viewer.enter([A]);
    archive.study(A).answerList();
    await settle();

    cleanupA();
    viewer.enter([B]);
    await archive.load(B);
    // A's in-flight series answer inside B's run.
    archive.study(A).series.forEach(s => s.answer());
    await settle();

    expect(viewer.madeFor(A)).toBe(0);
    const activeStudies = viewer.hangingProtocolService.run.mock.calls.map(
      ([{ activeStudy }]) => activeStudy?.StudyInstanceUID
    );
    expect(activeStudies.length).toBeGreaterThan(0);
    expect(new Set(activeStudies)).toEqual(new Set([B]));
    expect(viewer.mode.onSetupRouteComplete).toHaveBeenCalledTimes(1); // B's only
  });
});

describe("setupRouteInit: the run's case set", () => {
  it("an instance of a study outside the run's case set makes no display set", async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    viewer.enter([B]);
    await archive.load(B);
    DicomMetadataStore.mockAddInstances(X, `${X}.1`);
    expect(viewer.madeFor(X)).toBe(0);
    expect(viewer.madeFor(B)).toBe(2);
  });

  it("A's prior, in flight from A's run, makes no display set in B's run (another patient)", async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    const cleanupA = viewer.enter([A]);
    await archive.load(A);
    // A's priors load asked for PA; its metadata is still out at the switch.
    requestDisplaySetCreationForStudy(archive.dataSource, viewer.displaySetService, PA, false);
    cleanupA();
    viewer.enter([B]);
    await archive.load(B);
    await archive.load(PA);
    expect(viewer.madeFor(PA)).toBe(0);
  });

  it("the loader's prior, asked for while the run is current, hangs", async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    viewer.enter([B]);
    await archive.load(B);
    // As loadRelevantPriors asks: the shared active data source, madeInClient false.
    const [dataSource] = viewer.extensionManager.getActiveDataSource();
    requestDisplaySetCreationForStudy(dataSource, viewer.displaySetService, PB, false);
    await archive.load(PB);
    expect(viewer.madeFor(PB)).toBe(2);
  });

  it.each([
    ["a selectPrior pick of a qualifying prior beyond the loader's maxPriors"],
    ['a selectPrior pick of a non-qualifying prior'],
  ])('%s hangs (the real selectPrior)', async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    viewer.enter([B]);
    await archive.load(B);
    expect(viewer.state.active).toBe(B);
    setComparisonRoles({ priors: [PB], siblings: [] }); // the loader hung PB, not PICK

    const pick = selectPrior({
      servicesManager: viewer.servicesManager,
      extensionManager: viewer.extensionManager,
      studyInstanceUID: PICK,
      replaceUID: PB,
    });
    await archive.load(PICK);
    await pick;

    expect(viewer.madeFor(PICK)).toBe(2);
    const lastRun = viewer.hangingProtocolService.run.mock.calls.at(-1)[0];
    expect(lastRun.displaySets.map(ds => ds.StudyInstanceUID)).toContain(PICK);
  });

  it('rail expansion of a study no loader asked for shows its display sets', async () => {
    const archive = fakeArchive();
    const viewer = fakeViewer(archive);
    viewer.enter([B]);
    await archive.load(B);
    // As the study browser's expand asks: madeInClient true.
    requestDisplaySetCreationForStudy(archive.dataSource, viewer.displaySetService, RAIL, true);
    await archive.load(RAIL);
    expect(viewer.madeFor(RAIL)).toBe(2);
  });
});

describe('beginRouteRun: the retrieve wrapper', () => {
  it('restores the data source on end, and passes the call through with its arguments and this', () => {
    const archive = fakeArchive();
    const original = archive.dataSource.retrieve.series.metadata;
    const run = beginRouteRun({ dataSource: archive.dataSource, studyInstanceUIDs: [B] });
    expect(archive.dataSource.retrieve.series.metadata).not.toBe(original);
    archive.dataSource.retrieve.series.metadata({ StudyInstanceUID: PB, returnPromises: true });
    expect(original).toHaveBeenCalledWith({ StudyInstanceUID: PB, returnPromises: true });
    expect(original.mock.contexts[0]).toBe(archive.dataSource.retrieve.series);
    expect(run.inCaseSet(PB)).toBe(true);
    run.end();
    expect(archive.dataSource.retrieve.series.metadata).toBe(original);
  });

  it("one run's end leaves a later run's wrapper installed (StrictMode, overlapping entries), and nothing stacks", () => {
    const archive = fakeArchive();
    const original = archive.dataSource.retrieve.series.metadata;
    const first = beginRouteRun({ dataSource: archive.dataSource, studyInstanceUIDs: [A] });
    const second = beginRouteRun({ dataSource: archive.dataSource, studyInstanceUIDs: [B] });
    first.end();
    archive.dataSource.retrieve.series.metadata({ StudyInstanceUID: PB });
    expect(second.inCaseSet(PB)).toBe(true);
    expect(first.inCaseSet(PB)).toBe(false); // the second wraps the source, not the first
    second.end();
    expect(archive.dataSource.retrieve.series.metadata).toBe(original);
  });

  it('an unsubscribe added after the run ended is called at once', () => {
    const run = beginRouteRun({ dataSource: fakeArchive().dataSource, studyInstanceUIDs: [A] });
    run.end();
    const unsubscribe = jest.fn();
    run.addUnsubscribe(unsubscribe);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
