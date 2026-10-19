import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReadingMicLine, ReadingModeControl } from './ReadingControls';
import { currentReadingDock, ensureReadingDock } from './session';

// The island, as the app serves it: the session imports it by URL at run time.
const mockHandle = {
  api: 'pacsai.reportIsland',
  version: 1,
  setCase: jest.fn(() => ({ ok: true, generation: 2, sameCase: false })),
  setVisibility: jest.fn(),
  setFocus: jest.fn(() => true),
  settle: jest.fn(async () => ({ studyInstanceUid: '1.2.3', generation: 1, state: 'reportable' })),
  unmount: jest.fn(),
  toggleDictation: jest.fn(() => true),
};
let mockOptions: Record<string, (arg?: unknown) => void> = {};
jest.mock(
  '/api/report-editor/report-editor.js',
  () => ({
    ISLAND_API: 'pacsai.reportIsland',
    ISLAND_API_VERSION: 1,
    ISLAND_BUILD: 'test',
    mountReportEditor: (_el: HTMLElement, o: Record<string, (arg?: unknown) => void>) => {
      mockOptions = o;
      return mockHandle;
    },
  }),
  { virtual: true }
);

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });
  (window as { fetch?: unknown }).fetch = jest.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({ viewerHost: true }),
  }));
  window.history.replaceState(null, '', '/viewer/viewer/radcopilot?StudyInstanceUIDs=1.2.3');
});
afterEach(async () => {
  await currentReadingDock()?.destroy();
});

function Header() {
  return (
    <div>
      <ReadingModeControl />
      <ReadingMicLine />
    </div>
  );
}

describe('the reading controls in the header', () => {
  it('render nothing where the document has no dock', () => {
    const { container } = render(<Header />);
    expect(container.textContent).toBe('');
  });

  it('offer Images / Both / Report, Images refused until the microphone state is known', async () => {
    render(<Header />);
    await act(async () => {
      ensureReadingDock().enter('1.2.3');
      await settle();
    });
    const images = screen.getByRole('button', { name: 'Images' });
    const both = screen.getByRole('button', { name: 'Both' });
    expect((images as HTMLButtonElement).disabled).toBe(true);
    expect(both.getAttribute('aria-pressed')).toBe('true');
    expect(window.fetch).toHaveBeenCalledWith('/api/workspace/flags', expect.anything());

    await act(async () => {
      mockOptions.onDictation({ started: true, busy: false, available: true, pending: 1 });
    });
    expect((images as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Dictating into the report/)).toBeNull(); // the report shows its own

    fireEvent.click(images);
    expect(images.getAttribute('aria-pressed')).toBe('true');
    expect(mockHandle.setVisibility).toHaveBeenLastCalledWith(false);
    expect(screen.getByText('Dictating into the report · 1 to confirm')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation into the report' }));
    expect(mockHandle.toggleDictation).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockOptions.onNotice({ level: 'error', code: 'DRAFT_NOT_SAVED' });
    });
    expect(screen.getByText('Report: the draft is not saved')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(mockHandle.setVisibility).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText('Report: the draft is not saved')).toBeNull();
  });
});
