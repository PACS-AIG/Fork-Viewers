/**
 * Rev 11 milestone 7, PR 3: the two commands that move the case's latch
 * (lateArrivals.ts). The toolbar's browsing switch is the reader choosing the
 * case's images: it latches, and its re-hang takes in everything loaded, so a
 * held update goes. Focusing another study of the session gives it its own
 * hang and its own latch: its comparison may hang until the reader works it.
 */
jest.mock('@ohif/core', () => ({
  Types: {},
  DicomMetadataStore: { getStudy: (uid: string) => ({ StudyInstanceUID: uid }) },
}));
jest.mock('../priors/loadRelevantPriors', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../priors/selectPrior', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../allinone/rehang', () => ({ rehangForMode: jest.fn(), rehangCase: jest.fn() }));

// eslint-disable-next-line import/first
import getCommandsModule from '../getCommandsModule';
// eslint-disable-next-line import/first
import { rehangForMode } from '../allinone/rehang';
// eslint-disable-next-line import/first
import { setBrowsingMode } from '../allinone/browsingMode';
// eslint-disable-next-line import/first
import {
  holdOrRun,
  interactionLatched,
  latchInteraction,
  lateCaseEntered,
  lateCaseLeft,
  lateCounts,
  lateView,
} from './lateArrivals';

function commands() {
  const run = jest.fn();
  const services = {
    hangingProtocolService: {
      getState: () => ({ activeStudyUID: 'study-A' }),
      run,
      getActiveProtocol: () => null,
    },
    displaySetService: {
      getActiveDisplaySets: () => [
        { StudyInstanceUID: 'study-A' },
        { StudyInstanceUID: 'study-S' },
      ],
    },
  };
  const module = getCommandsModule({
    servicesManager: { services },
    extensionManager: {},
    commandsManager: {},
  } as never) as { actions: Record<string, (args: Record<string, unknown>) => void> };
  return { actions: module.actions, run };
}

beforeEach(() => {
  setBrowsingMode('append');
  lateCaseEntered(true);
  (rehangForMode as jest.Mock).mockClear();
});
afterEach(() => {
  lateCaseLeft();
  setBrowsingMode('append');
});

describe('the commands and the case’s latch (milestone 7, PR 3)', () => {
  it('the browsing switch latches the case and drops an update held before its re-hang', () => {
    const { actions } = commands();
    latchInteraction('scroll');
    const held = jest.fn();
    holdOrRun({ kind: () => ({ kind: 'images', label: null }), run: held });
    actions.setBrowsingMode({ mode: 'current' });
    expect(rehangForMode).toHaveBeenCalledTimes(1);
    expect(interactionLatched()).toBe(true);
    expect(lateView().held).toBeNull();
    expect(held).not.toHaveBeenCalled();
  });

  it('the browsing switch on an untouched case latches it: later arrivals wait for the reader', () => {
    const { actions } = commands();
    actions.setBrowsingMode({ mode: 'allinone' });
    expect(interactionLatched()).toBe(true);
    expect(lateCounts().reason).toBe('browsing');
  });

  it('focusing another study of the session starts its own latch, nothing held', () => {
    const { actions, run } = commands();
    latchInteraction('scroll');
    holdOrRun({ kind: () => ({ kind: 'images', label: null }), run: jest.fn() });
    actions.focusSessionStudy({ studyInstanceUID: 'study-S' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(lateView()).toEqual({ latched: false, held: null });
  });
});
