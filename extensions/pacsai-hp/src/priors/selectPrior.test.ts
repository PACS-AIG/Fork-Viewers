/**
 * selectPrior (the on-image prior switcher) over fake services: a pick is for
 * the case it was made on, and one that finishes after an in-document switch
 * A→B writes none of A's roles into B's registry and re-hangs nothing — the
 * relevant-priors load's defect (milestone 6, V04), through the same pinCase.
 * The real pinGeneration, role registry and re-hang (its run() is the fake's);
 * the attempt generation and the active study are the test's to move.
 */
import { clearComparisonRoles, getPriorUIDs, setComparisonRoles } from './roleRegistry';

const A = '1.2.840.99.1'; // the case the pick is made on
const B = '1.2.840.99.2'; // the case after the switch
const P1 = '1.2.840.99.10'; // A's hung prior
const P2 = '1.2.840.99.11'; // the prior the reader picks on A
const PB = '1.2.840.99.20'; // B's prior, published by B's load

// The generation the fake attempt trace reports (null: no trace in this document).
const mockTrace: { generation: number | null } = { generation: 1 };
const mockStudies: Record<string, { StudyInstanceUID: string }> = Object.fromEntries(
  [A, B, P1, P2, PB].map(uid => [uid, { StudyInstanceUID: uid }])
);
const mockCreateDisplaySets = jest.fn();

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
  requestDisplaySetCreationForStudy: (...args: unknown[]) => mockCreateDisplaySets(...args),
}));

import selectPrior from './selectPrior';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * The viewer's services as selectPrior reads them, with the case at
 * `state.active`; the grid shows `state.shown` (display set UIDs, one per
 * viewport).
 */
function fakeViewer({ pickedMatchable = true } = {}) {
  const state = { active: A as string, shown: [`ds-${A}`, `ds-${P1}`] };
  const displaySets = [A, B, P1, PB].map(uid => ({
    displaySetInstanceUID: `ds-${uid}`,
    StudyInstanceUID: uid,
    numImageFrames: 40,
  }));
  const picked = {
    displaySetInstanceUID: `ds-${P2}`,
    StudyInstanceUID: P2,
    numImageFrames: pickedMatchable ? 40 : 0,
    unsupported: !pickedMatchable,
  };
  displaySets.push(picked as (typeof displaySets)[number]);
  const run = jest.fn();
  const show = jest.fn(({ message }: { message: string }) => `notification:${message}`);
  const hide = jest.fn();
  const services = {
    hangingProtocolService: { getState: () => ({ activeStudyUID: state.active }), run },
    displaySetService: {
      getActiveDisplaySets: () => displaySets,
      getDisplaySetByUID: (uid: string) => displaySets.find(ds => ds.displaySetInstanceUID === uid),
    },
    viewportGridService: {
      getState: () => ({ viewports: new Map(state.shown.map((_, i) => [`vp-${i}`, {}])) }),
      getDisplaySetsUIDsForViewport: (id: string) => [state.shown[Number(id.slice(3))]],
    },
    uiNotificationService: { show, hide },
  };
  const extensionManager = { getActiveDataSource: () => [{}] };
  const pick = (studyInstanceUID = P2, replaceUID = P1) =>
    selectPrior({ servicesManager: { services }, extensionManager, studyInstanceUID, replaceUID });
  /** switchStudy to B: the trace opens generation 2, the mode re-hangs for B, B's grid shows. */
  const switchToB = ({ publishRolesOfB = true } = {}) => {
    mockTrace.generation = 2;
    state.active = B;
    state.shown = [`ds-${B}`];
    if (publishRolesOfB) {
      setComparisonRoles({ priors: [PB], siblings: [] });
    }
  };
  return { state, picked, run, show, hide, pick, switchToB };
}

const LOADING = 'notification:Loading selected prior…';
const NOT_HUNG = expect.stringContaining('this protocol has no viewport for it');
const dropped = (where: string) =>
  expect(console.log).toHaveBeenCalledWith(
    '[pacsai-hp]',
    expect.stringContaining(`dropping the result (${where})`)
  );

beforeEach(() => {
  jest.useFakeTimers();
  mockTrace.generation = 1;
  mockCreateDisplaySets.mockReset().mockResolvedValue(undefined);
  clearComparisonRoles();
  setComparisonRoles({ priors: [P1], siblings: [] });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('selectPrior: a pick on the case', () => {
  it('re-points the prior role and re-hangs the case with it, and clears its indicator', async () => {
    const viewer = fakeViewer();
    await viewer.pick();
    expect(getPriorUIDs()).toEqual([P2]);
    expect(viewer.run).toHaveBeenCalledTimes(1);
    expect(viewer.run.mock.calls[0][0].activeStudy).toBe(mockStudies[A]);
    expect(viewer.hide).toHaveBeenCalledWith(LOADING);
  });
});

describe('selectPrior: a pick the case has moved on from', () => {
  it('writes no roles and does not re-hang when its display sets arrive after a switch to B; the next pick is taken', async () => {
    const viewer = fakeViewer();
    const createdP2 = deferred<void>();
    mockCreateDisplaySets.mockImplementation(() => createdP2.promise);
    const pickOnA = viewer.pick();
    expect(viewer.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Loading selected prior…' })
    );

    viewer.switchToB();
    createdP2.resolve();
    await pickOnA;

    expect(getPriorUIDs()).toEqual([PB]); // B's roles, not A's pick written over them
    expect(viewer.run).not.toHaveBeenCalled();
    expect(viewer.hide).toHaveBeenCalledWith(LOADING);
    dropped('display sets');
    jest.advanceTimersByTime(30000);
    expect(viewer.run).not.toHaveBeenCalled();

    // The pick released the switcher: a pick on B goes through.
    mockCreateDisplaySets.mockResolvedValue(undefined);
    await viewer.pick(P2, PB);
    expect(getPriorUIDs()).toEqual([P2]);
    expect(viewer.run).toHaveBeenCalledTimes(1);
    expect(viewer.run.mock.calls[0][0].activeStudy).toBe(mockStudies[B]);
  });

  it('does not write when only the generation moved (right after a switch the protocol still holds A active)', async () => {
    const viewer = fakeViewer();
    const createdP2 = deferred<void>();
    mockCreateDisplaySets.mockImplementation(() => createdP2.promise);
    const pickOnA = viewer.pick();
    mockTrace.generation = 2;
    createdP2.resolve();
    await pickOnA;
    expect(getPriorUIDs()).toEqual([P1]);
    expect(viewer.run).not.toHaveBeenCalled();
  });

  it('does not write when only the active study moved (no trace in the document)', async () => {
    mockTrace.generation = null;
    const viewer = fakeViewer();
    const createdP2 = deferred<void>();
    mockCreateDisplaySets.mockImplementation(() => createdP2.promise);
    const pickOnA = viewer.pick();
    viewer.state.active = B;
    createdP2.resolve();
    await pickOnA;
    expect(getPriorUIDs()).toEqual([P1]);
    expect(viewer.run).not.toHaveBeenCalled();
    dropped('display sets');
  });

  it('stops its re-hang poll once the case moved on, and dismisses its indicator', async () => {
    const viewer = fakeViewer({ pickedMatchable: false }); // P2's series still half-loaded shells
    await viewer.pick();
    expect(viewer.run).toHaveBeenCalledTimes(1); // the first hang, while A was the case
    expect(viewer.hide).not.toHaveBeenCalled(); // the poll holds the indicator

    viewer.switchToB();
    viewer.picked.numImageFrames = 40; // P2 would now be matchable …
    viewer.picked.unsupported = false;
    jest.advanceTimersByTime(750);
    expect(viewer.run).toHaveBeenCalledTimes(1); // … but A is not the case any more
    expect(getPriorUIDs()).toEqual([PB]);
    expect(viewer.hide).toHaveBeenCalledWith(LOADING);
    dropped('re-hang poll');
    jest.advanceTimersByTime(30000);
    expect(viewer.run).toHaveBeenCalledTimes(1);
    expect(viewer.show).not.toHaveBeenCalledWith(expect.objectContaining({ message: NOT_HUNG }));
  });

  it('does not judge B’s grid for A’s pick: no “no viewport for it” notice after a switch', async () => {
    const viewer = fakeViewer();
    await viewer.pick(); // hung on A; the check is due 1.5 s later
    viewer.switchToB({ publishRolesOfB: false }); // B's load still in flight: P2 still the prior
    jest.advanceTimersByTime(1500);
    expect(viewer.show).not.toHaveBeenCalledWith(expect.objectContaining({ message: NOT_HUNG }));
  });

  it('still says so on the case itself when the pick hangs nowhere', async () => {
    const viewer = fakeViewer();
    await viewer.pick();
    viewer.state.shown = [`ds-${A}`]; // the protocol found no viewport for P2
    jest.advanceTimersByTime(1500);
    expect(viewer.show).toHaveBeenCalledWith(expect.objectContaining({ message: NOT_HUNG }));
  });

  it('does not report the previous case’s failure as the new one’s', async () => {
    const viewer = fakeViewer();
    const createdP2 = deferred<void>();
    mockCreateDisplaySets.mockImplementation(() =>
      createdP2.promise.then(() => {
        throw new Error('P2 failed to load');
      })
    );
    const pickOnA = viewer.pick();
    viewer.switchToB();
    createdP2.resolve();
    await pickOnA;
    expect(viewer.hide).toHaveBeenCalledWith(LOADING);
    expect(viewer.show).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Could not load the selected prior.' })
    );
    expect(getPriorUIDs()).toEqual([PB]);
  });
});
