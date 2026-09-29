/**
 * loadRelevantPriors over fake services and a fake data source: a load is for
 * one case and drops its result once the case has moved on (milestone 6, V04:
 * after an in-document switch A→B, A's late load re-hung A as the case with B
 * as its prior). The real pinGeneration and role registry; the attempt
 * generation and the active study are the test's to move.
 */
import {
  clearComparisonRoles,
  getAvailablePriors,
  getPriorUIDs,
  getSessionStudies,
} from './roleRegistry';

const A = '1.2.840.99.1';
const B = '1.2.840.99.2';
const P = '1.2.840.99.0'; // A's prior
const S = '1.2.840.99.3'; // A's same-session sibling (another region)

// The generation the fake attempt trace reports (null: no trace in this document).
const mockTrace: { generation: number | null } = { generation: 1 };
const mockStudies: Record<string, { StudyInstanceUID: string }> = {
  [A]: { StudyInstanceUID: A },
  [B]: { StudyInstanceUID: B },
  [P]: { StudyInstanceUID: P },
  [S]: { StudyInstanceUID: S },
};
const mockPatient = {
  query: jest.fn(),
  createDisplaySets: jest.fn(),
};

jest.mock('@ohif/core', () => ({
  DicomMetadataStore: { getStudy: (uid: string) => mockStudies[uid] },
  utils: {
    attempt: {
      snapshot: () => (mockTrace.generation === null ? null : { generation: mockTrace.generation }),
    },
  },
  classes: { ImageSet: class {} },
}));
// pinGeneration (@ohif/core/src/utils/attempt/attemptTrace) is the real one.
jest.mock('@ohif/extension-default', () => ({
  getStudiesForPatientByMRN: (...args: unknown[]) => mockPatient.query(...args),
  requestDisplaySetCreationForStudy: (...args: unknown[]) => mockPatient.createDisplaySets(...args),
}));

import loadRelevantPriors from './loadRelevantPriors';

const qido = (uid: string, date: string, time = '120000', description = 'CT HEAD WO CONTRAST') => ({
  studyInstanceUid: uid,
  date,
  time,
  description,
  modalities: 'CT',
  mrn: 'MRN-1',
});
const PATIENT = [qido(A, '20260901'), qido(P, '20250101'), qido(B, '20260915')];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The viewer's services as the loader reads them, with the case at `state.active`. */
function fakeViewer({ currentMatchable = true } = {}) {
  const state = { active: A as string | undefined };
  const displaySets = [
    {
      StudyInstanceUID: A,
      SeriesDescription: 'Axial',
      numImageFrames: currentMatchable ? 40 : 0,
      unsupported: !currentMatchable,
    },
  ];
  const run = jest.fn();
  const show = jest.fn(({ message }: { message: string }) => `notification:${message}`);
  const hide = jest.fn();
  const search = jest.fn(async () => [qido(A, '20260901')]);
  const services = {
    hangingProtocolService: {
      getActiveProtocol: () => ({ protocol: { id: '@pacsai/compareCT' } }),
      getState: () => ({ activeStudyUID: state.active }),
      getProtocolById: () => undefined,
      run,
    },
    displaySetService: { getActiveDisplaySets: () => displaySets },
    customizationService: { getCustomization: () => undefined },
    uiNotificationService: { show, hide },
  };
  const dataSource = { query: { studies: { search } } };
  const extensionManager = { getActiveDataSource: () => [dataSource] };
  const load = () => loadRelevantPriors({ servicesManager: { services }, extensionManager } as any);
  return { state, displaySets, run, show, hide, search, load };
}

const LOADING = 'notification:Setting up hanging protocol…';
const dropped = (where: string) =>
  expect(console.log).toHaveBeenCalledWith(
    '[pacsai-hp]',
    expect.stringContaining(`dropping the result (${where})`)
  );

beforeEach(() => {
  mockTrace.generation = 1;
  mockPatient.query.mockReset().mockResolvedValue(PATIENT);
  mockPatient.createDisplaySets.mockReset().mockResolvedValue(undefined);
  clearComparisonRoles();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('loadRelevantPriors: a load for the case', () => {
  it('re-hangs the current study with its prior beside it and clears its indicator', async () => {
    const viewer = fakeViewer();
    await viewer.load();
    expect(viewer.run).toHaveBeenCalledTimes(1);
    const [{ studies, activeStudy }, protocolId] = viewer.run.mock.calls[0];
    expect(activeStudy).toBe(mockStudies[A]);
    expect(studies).toEqual([mockStudies[A], mockStudies[P]]);
    expect(protocolId).toBe('@pacsai/compareCT');
    expect(getPriorUIDs()).toEqual([P]);
    expect(viewer.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Setting up hanging protocol…' })
    );
    expect(viewer.hide).toHaveBeenCalledWith(LOADING);
  });
});

describe('loadRelevantPriors: a load the case has moved on from', () => {
  it('does not run when it settles after an in-document switch to B (a new generation, B active); its indicator goes and the next load is not blocked', async () => {
    const viewer = fakeViewer();
    const displaySetsOfA = deferred<void>();
    mockPatient.createDisplaySets.mockImplementation(() => displaySetsOfA.promise);
    const loadOfA = viewer.load();
    await new Promise(r => setTimeout(r, 0)); // A's load now waits on its display sets
    expect(viewer.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Setting up hanging protocol…' })
    );

    mockTrace.generation = 2; // switchStudy: the trace opens generation 2 …
    viewer.state.active = B; // … and the mode re-hangs for B
    displaySetsOfA.resolve();
    await loadOfA;

    expect(viewer.run).not.toHaveBeenCalled();
    expect(viewer.hide).toHaveBeenCalledWith(LOADING);
    expect(viewer.show).toHaveBeenCalledTimes(1); // no error toast either
    dropped('display sets');

    // The inFlight entry went with it: A opened again loads again.
    mockTrace.generation = 3;
    viewer.state.active = A;
    mockPatient.createDisplaySets.mockResolvedValue(undefined);
    await viewer.load();
    expect(viewer.run).toHaveBeenCalledTimes(1);
    expect(viewer.run.mock.calls[0][0].activeStudy).toBe(mockStudies[A]);
  });

  it('does not run when only the generation moved (right after a switch the protocol still holds A active)', async () => {
    const viewer = fakeViewer();
    const displaySetsOfA = deferred<void>();
    mockPatient.createDisplaySets.mockImplementation(() => displaySetsOfA.promise);
    const loadOfA = viewer.load();
    await new Promise(r => setTimeout(r, 0));
    mockTrace.generation = 2;
    displaySetsOfA.resolve();
    await loadOfA;
    expect(viewer.run).not.toHaveBeenCalled();
    expect(viewer.hide).toHaveBeenCalledWith(LOADING);
  });

  it('does not run when only the active study moved (no trace in the document; the session switcher focused a sibling)', async () => {
    mockTrace.generation = null;
    const viewer = fakeViewer();
    const displaySetsOfA = deferred<void>();
    mockPatient.createDisplaySets.mockImplementation(() => displaySetsOfA.promise);
    const loadOfA = viewer.load();
    await new Promise(r => setTimeout(r, 0));
    viewer.state.active = S;
    displaySetsOfA.resolve();
    await loadOfA;
    expect(viewer.run).not.toHaveBeenCalled();
    dropped('display sets');
  });

  it('publishes nothing when the case moved on during its patient query: no session studies, priors, roles, indicator or run', async () => {
    const viewer = fakeViewer();
    const patientOfA = deferred<unknown[]>();
    mockPatient.query.mockImplementation(() => patientOfA.promise);
    const loadOfA = viewer.load();
    await new Promise(r => setTimeout(r, 0));
    mockTrace.generation = 2;
    viewer.state.active = B;
    patientOfA.resolve(PATIENT);
    await loadOfA;
    expect(getSessionStudies()).toEqual([]);
    expect(getAvailablePriors()).toEqual([]);
    expect(getPriorUIDs()).toEqual([]);
    expect(viewer.show).not.toHaveBeenCalled();
    expect(viewer.run).not.toHaveBeenCalled();
    dropped('patient query');
  });

  it('stops its re-hang poll once the case moved on, and dismisses its indicator', async () => {
    jest.useFakeTimers();
    const viewer = fakeViewer({ currentMatchable: false }); // A's series still half-loaded shells
    await viewer.load();
    expect(viewer.run).toHaveBeenCalledTimes(1); // the first hang, while A was the case
    expect(viewer.hide).not.toHaveBeenCalled(); // the poll holds the indicator

    mockTrace.generation = 2;
    viewer.state.active = B;
    viewer.displaySets[0].numImageFrames = 40; // A would now be matchable …
    viewer.displaySets[0].unsupported = false;
    jest.advanceTimersByTime(750);
    expect(viewer.run).toHaveBeenCalledTimes(1); // … but it is not the case any more
    expect(viewer.hide).toHaveBeenCalledWith(LOADING);
    dropped('re-hang poll');
    jest.advanceTimersByTime(60000);
    expect(viewer.run).toHaveBeenCalledTimes(1);
  });

  it("does not report the previous case's failure as the new one's", async () => {
    const viewer = fakeViewer();
    const displaySetsOfA = deferred<void>();
    mockPatient.createDisplaySets.mockImplementation(() =>
      displaySetsOfA.promise.then(() => {
        throw new Error('A failed to load');
      })
    );
    const loadOfA = viewer.load();
    await new Promise(r => setTimeout(r, 0));
    mockTrace.generation = 2;
    viewer.state.active = B;
    displaySetsOfA.resolve();
    await loadOfA;
    expect(viewer.hide).toHaveBeenCalledWith(LOADING);
    expect(viewer.show).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Relevant priors' })
    );
  });
});
