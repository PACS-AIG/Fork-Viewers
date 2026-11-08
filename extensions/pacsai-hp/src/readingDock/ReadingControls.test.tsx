import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReadingControls, ReadingMicLine, ReadingModeControl } from './ReadingControls';
import { currentReadingDock, ensureReadingDock } from './session';
import getToolbarModule, { READING_MODES_UITYPE } from '../getToolbarModule';

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

// 22 Oct: the section's one item. OHIF's Toolbar draws each item of a section in
// a block of its own, so as two items the microphone stacked under the buttons.
describe('the reading controls as one toolbar item', () => {
  const rowOf = (container: HTMLElement) =>
    container.querySelector('[data-cy="pacsai-reading-controls"]') as HTMLElement;
  const partsOf = (row: HTMLElement) => [...row.children].map(c => c.getAttribute('data-cy'));

  it("is what the reading dock's toolbar uiType draws, with no microphone item of its own", () => {
    const entries = getToolbarModule({
      commandsManager: {},
      servicesManager: { services: {} },
    } as never) as Array<{ name: string; defaultComponent?: unknown }>;
    expect(entries.find(e => e.name === READING_MODES_UITYPE)?.defaultComponent).toBe(
      ReadingControls
    );
    expect(entries.map(e => e.name)).not.toContain('pacsai.readingMic');
  });

  it('renders nothing where the document has no dock', () => {
    const { container } = render(<ReadingControls />);
    expect(container.innerHTML).toBe('');
  });

  it("in Images, puts the report's microphone in the buttons' row, after them", async () => {
    const { container } = render(<ReadingControls />);
    await act(async () => {
      ensureReadingDock().enter('1.2.3');
      await settle();
    });
    await act(async () => {
      mockOptions.onDictation({ started: true, busy: false, available: true, pending: 0 });
    });
    const row = rowOf(container);
    expect(row.style.display).toBe('flex');
    // Milestone 7: Arrange sits beside the three modes.
    expect(partsOf(row)).toEqual(['pacsai-reading-modes', 'pacsai-arrange']);

    fireEvent.click(screen.getByRole('button', { name: 'Images' }));
    expect(partsOf(row)).toEqual(['pacsai-reading-modes', 'pacsai-arrange', 'pacsai-reading-mic']);
    expect(
      screen.getByText('Dictating into the report').closest('[data-cy="pacsai-reading-controls"]')
    ).toBe(row);

    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(partsOf(row)).toEqual(['pacsai-reading-modes', 'pacsai-arrange']);
  });
});

// 22 Oct: a window too narrow for Both (200 % zoom among them): the microphone's
// line gives its width to the image tools, which had none left at 200 %.
describe('the microphone in a window too narrow for Both', () => {
  const inImages = async (pending: number) => {
    render(<ReadingControls />);
    await act(async () => {
      ensureReadingDock().enter('1.2.3');
      await settle();
    });
    await act(async () => {
      mockOptions.onDictation({ started: true, busy: false, available: true, pending });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Images' }));
  };

  it("keeps the toggle and the notices; the line is read out but off screen, and in the toggle's title", async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 960 });
    await inImages(1);
    expect(currentReadingDock()?.getSnapshot()).toMatchObject({ mode: 'images', narrow: true });
    const line = screen.getByText('Dictating into the report · 1 to confirm');
    expect(line.style.position).toBe('absolute');
    expect(line.style.width).toBe('1px');
    expect(line.closest('[role="status"]')).not.toBeNull();
    const toggle = screen.getByRole('button', { name: 'Stop dictation into the report' });
    expect(toggle.getAttribute('title')).toBe('Dictating into the report · 1 to confirm');

    await act(async () => {
      mockOptions.onNotice({ level: 'error', code: 'DRAFT_NOT_SAVED' });
    });
    expect(screen.getByText('Report: the draft is not saved').style.position).toBe('');
  });

  it('at 1920 the line shows beside the toggle, which has no title, as before', async () => {
    await inImages(0);
    expect(currentReadingDock()?.getSnapshot()).toMatchObject({ mode: 'images', narrow: false });
    const line = screen.getByText('Dictating into the report');
    expect(line.style.position).toBe('');
    expect(line.style.fontSize).toBe('13px');
    expect(
      screen.getByRole('button', { name: 'Stop dictation into the report' }).getAttribute('title')
    ).toBeNull();
  });
});

// Milestone 7, PR 3 (docs/12 §4, N06): a re-hang held for the reader, offered beside Arrange.
describe('New images available · Update layout', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const late = require('../arrange/lateArrivals') as typeof import('../arrange/lateArrivals');
  const open = async () => {
    const view = render(<ReadingControls />);
    await act(async () => {
      ensureReadingDock().enter('1.2.3');
      await settle();
    });
    return view;
  };
  const hold = (kind: 'images' | 'layout', label: string | null = null) => {
    const run = jest.fn();
    act(() => {
      late.latchInteraction('scroll');
      late.holdOrRun({ kind: () => ({ kind, label }), run });
    });
    return run;
  };
  beforeEach(() => late.lateCaseEntered(true));
  afterEach(() => late.lateCaseLeft());

  it('nothing is offered while nothing is held', async () => {
    const { container } = await open();
    expect(container.querySelector('[data-cy="pacsai-late-layout"]')).toBeNull();
    act(() => late.latchInteraction('scroll'));
    expect(container.querySelector('[data-cy="pacsai-late-layout"]')).toBeNull();
  });

  it('beside Arrange, read out; Update layout hangs the case again, once, without taking the focus', async () => {
    const { container } = await open();
    const run = hold('images');
    const offer = container.querySelector('[data-cy="pacsai-late-layout"]') as HTMLElement;
    expect(offer).not.toBeNull();
    expect(offer.getAttribute('data-late-kind')).toBe('images');
    const line = screen.getByText('New images available');
    expect(line.closest('[role="status"]')).not.toBeNull();
    expect(line.style.position).toBe('');
    const button = screen.getByRole('button', { name: 'Update layout' });
    // A press does not take the focus from the report.
    expect(fireEvent.mouseDown(button)).toBe(false);
    await act(async () => {
      fireEvent.click(button);
      await settle();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-cy="pacsai-late-layout"]')).toBeNull();
  });

  it("only the reader's layout waiting: said with its study type", async () => {
    await open();
    hold('layout', 'CTA Head/Neck');
    expect(screen.getByText('Your CTA Head/Neck layout')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Update layout' })).not.toBeNull();
  });

  it("in a window too narrow for Both the line is read out off screen and is in the button's title", async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 960 });
    await open();
    hold('images');
    const line = screen.getByText('New images available');
    expect(line.style.position).toBe('absolute');
    expect(screen.getByRole('button', { name: 'Update layout' }).getAttribute('title')).toBe(
      'New images available. Hang the case again with the images that arrived.'
    );
  });
});
