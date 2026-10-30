/**
 * 30 Oct (Rev 11 M6, the acceptance, pass 2): the session switcher gives way in
 * radcopilot's window too narrow for Images + Report (200 % zoom among them),
 * where its 212 px took the header's whole tools zone; the gear menu lists the
 * session's studies there instead (radcopilotMode.test.ts). Outside radcopilot
 * there is no reading dock, and the switcher is as before.
 */
import React from 'react';
import { act, render } from '@testing-library/react';

type Listener = () => void;
const mockDock = {
  narrow: false,
  listeners: new Set<Listener>(),
  present: true,
};
const mockChange = new Set<Listener>();
jest.mock('../readingDock/session', () => ({
  currentReadingDock: () =>
    mockDock.present
      ? {
          getSnapshot: () => ({ narrow: mockDock.narrow }),
          subscribe: (l: Listener) => {
            mockDock.listeners.add(l);
            return () => mockDock.listeners.delete(l);
          },
        }
      : null,
  onReadingDockChange: (l: Listener) => {
    mockChange.add(l);
    return () => mockChange.delete(l);
  },
}));

// eslint-disable-next-line import/first
import SessionStudyDropdown from './SessionStudyDropdown';
// eslint-disable-next-line import/first
import { setSessionStudies } from '../priors/roleRegistry';

const props = {
  commandsManager: { runCommand: jest.fn() },
  servicesManager: {
    services: { hangingProtocolService: { getState: () => ({ activeStudyUID: '1.2.3' }) } },
  },
};
const select = () => document.querySelector('[data-cy="pacsai-session-switcher"]');
const tell = (set: Set<Listener>) => act(() => set.forEach(l => l()));

beforeEach(() => {
  mockDock.narrow = false;
  mockDock.present = true;
  mockDock.listeners.clear();
  mockChange.clear();
  setSessionStudies([
    { uid: '1.2.3', label: 'CT HEAD' },
    { uid: '1.2.4', label: 'CT C-SPINE' },
  ] as never);
});
afterEach(() => setSessionStudies([]));

describe('the session switcher', () => {
  it('shows with two studies in a wide window, and gives way while the dock is narrow', () => {
    const { unmount } = render(<SessionStudyDropdown {...props} />);
    expect(select()).not.toBeNull();
    mockDock.narrow = true;
    tell(mockDock.listeners);
    expect(select()).toBeNull();
    mockDock.narrow = false;
    tell(mockDock.listeners);
    expect(select()).not.toBeNull();
    unmount();
    expect(mockDock.listeners.size).toBe(0);
    expect(mockChange.size).toBe(0);
  });

  it('opens narrow when the dock already is, and follows a dock made again', () => {
    mockDock.narrow = true;
    render(<SessionStudyDropdown {...props} />);
    expect(select()).toBeNull();
    // The dock made again after a leave, in a wide window.
    mockDock.narrow = false;
    tell(mockChange);
    expect(select()).not.toBeNull();
  });

  it('outside radcopilot (no dock) is as before', () => {
    mockDock.present = false;
    render(<SessionStudyDropdown {...props} />);
    expect(select()).not.toBeNull();
    act(() => setSessionStudies([{ uid: '1.2.3', label: 'CT HEAD' }] as never));
    expect(select()).toBeNull();
  });
});
