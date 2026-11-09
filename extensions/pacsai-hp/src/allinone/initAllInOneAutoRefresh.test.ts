/**
 * The all-in-one refresh: a study's series arriving builds its composite and,
 * a composite newly made, re-hangs the case. Rev 11 milestone 7, PR 3: in the
 * reading window, once the reader has worked the images, that re-hang waits
 * for them (lateArrivals.ts), and it is the case's plan (rehangCase).
 */
jest.mock('./buildAllInOneDisplaySet', () => ({
  __esModule: true,
  default: jest.fn(() => ({ created: 1 })),
}));
jest.mock('./rehang', () => ({ rehangCase: jest.fn() }));

// eslint-disable-next-line import/first
import syncAllInOneDisplaySets from './buildAllInOneDisplaySet';
// eslint-disable-next-line import/first
import { rehangCase } from './rehang';
// eslint-disable-next-line import/first
import { initAllInOneAutoRefresh } from './initAllInOneAutoRefresh';
// eslint-disable-next-line import/first
import { setBrowsingMode } from './browsingMode';
// eslint-disable-next-line import/first
import {
  latchInteraction,
  lateCaseEntered,
  lateCaseLeft,
  lateView,
  noteHung,
  updateLayout,
} from '../arrange/lateArrivals';

type DisplaySetLike = {
  displaySetInstanceUID: string;
  numImageFrames: number;
  isAllInOne?: boolean;
};

function viewer() {
  let listener: (event: { displaySetsAdded?: DisplaySetLike[] }) => void = () => undefined;
  let sets: DisplaySetLike[] = [{ displaySetInstanceUID: 'a1', numImageFrames: 40 }];
  const displaySetService = {
    EVENTS: { DISPLAY_SETS_ADDED: 'event::displaySetsAdded' },
    subscribe: jest.fn((_event: string, cb: typeof listener) => {
      listener = cb;
      return { unsubscribe: jest.fn() };
    }),
    getActiveDisplaySets: () => sets,
  };
  const servicesManager = { services: { displaySetService } };
  const stop = initAllInOneAutoRefresh({ servicesManager, extensionManager: {} } as never);
  return {
    servicesManager,
    stop,
    sets: () => sets,
    /** A study's series arrive (the comparison, or the current study's late ones). */
    arrive: (...uids: string[]) => {
      const added = uids.map(uid => ({ displaySetInstanceUID: uid, numImageFrames: 30 }));
      sets = [...sets, ...added];
      listener({ displaySetsAdded: added });
      jest.advanceTimersByTime(600);
    },
  };
}

const rehang = rehangCase as jest.Mock;
const sync = syncAllInOneDisplaySets as unknown as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  rehang.mockReset();
  sync.mockReset().mockReturnValue({ created: 1 });
  setBrowsingMode('append');
  lateCaseEntered(true);
});
afterEach(() => {
  lateCaseLeft();
  jest.useRealTimers();
});

describe('the all-in-one refresh and late arrivals (milestone 7, PR 3)', () => {
  it('untouched: a composite newly made re-hangs the case, its own plan (rehangCase)', () => {
    const v = viewer();
    noteHung(v.sets());
    v.arrive('p1', 'p2');
    expect(sync).toHaveBeenCalledTimes(1);
    expect(rehang).toHaveBeenCalledTimes(1);
    expect(rehang).toHaveBeenCalledWith(v.servicesManager);
    v.stop();
  });

  it('once the reader worked the images, it waits for them: offered as new images, hung by Update layout', () => {
    const v = viewer();
    noteHung(v.sets());
    latchInteraction('scroll');
    v.arrive('p1', 'p2');
    // The composite is still built (the rail lists it); the layout is not touched.
    expect(sync).toHaveBeenCalledTimes(1);
    expect(rehang).not.toHaveBeenCalled();
    expect(lateView().held).toEqual({ kind: 'images', label: null });
    updateLayout();
    expect(rehang).toHaveBeenCalledTimes(1);
    v.stop();
  });

  it('latched, with no image new since the layout was hung: nothing is offered or moved', () => {
    const v = viewer();
    latchInteraction('keys');
    noteHung([...v.sets(), { displaySetInstanceUID: 'p1', numImageFrames: 30 }]);
    v.arrive('p1');
    expect(rehang).not.toHaveBeenCalled();
    expect(lateView().held).toBeNull();
    v.stop();
  });

  it('a composite that only grew, or Manual, re-hangs nothing, as before', () => {
    const v = viewer();
    sync.mockReturnValue({ created: 0 });
    v.arrive('a2');
    expect(rehang).not.toHaveBeenCalled();
    sync.mockReturnValue({ created: 1 });
    setBrowsingMode('manual');
    v.arrive('p1');
    expect(rehang).not.toHaveBeenCalled();
    v.stop();
  });

  it('outside the reading window it re-hangs as before, whatever the reader did', () => {
    lateCaseEntered(false);
    const v = viewer();
    latchInteraction('scroll');
    v.arrive('p1');
    expect(rehang).toHaveBeenCalledTimes(1);
    v.stop();
  });

  it('our own composites arriving start nothing', () => {
    const v = viewer();
    const listener = (v.servicesManager.services.displaySetService.subscribe as jest.Mock).mock
      .calls[0][1];
    listener({
      displaySetsAdded: [{ displaySetInstanceUID: 'p.all', numImageFrames: 90, isAllInOne: true }],
    });
    jest.advanceTimersByTime(600);
    expect(sync).not.toHaveBeenCalled();
    v.stop();
  });
});
