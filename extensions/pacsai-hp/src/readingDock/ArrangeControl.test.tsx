/**
 * Rev 11 milestone 7 (N05): Arrange in the header, by pointer and keyboard.
 * The controller is a real one (arrangeSession.ts) over fake services.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createArrange, type ArrangeDeps } from '../arrange/arrangeSession';
import type { BrowsingMode } from '../allinone/browsingMode';

const CHEST = {
  id: '@pacsai/compareCTChest',
  name: 'CT Chest Compare',
  stages: [
    { id: 's0', name: 'Axial Lung (current/prior)', status: 'enabled' },
    { id: 's1', name: 'Coronal (current/prior)', status: 'enabled' },
  ],
};

const hp = { protocolId: CHEST.id, stageIndex: 0 };
let browsing: BrowsingMode = 'append';
let layout = { mode: 'both' as 'images' | 'both' | 'report', reportRatio: 0.4 };
let held: typeof layout | null = null;
const restore = jest.fn(async () => ({ missing: [] as string[] }));
const deps: ArrangeDeps = {
  hanging: () =>
    ({
      getActiveProtocol: () => ({
        protocol: CHEST,
        stageIndex: hp.stageIndex,
        activeStudy: { StudyInstanceUID: 'A' },
      }),
      getState: () => ({
        protocolId: hp.protocolId,
        stageIndex: hp.stageIndex,
        activeStudyUID: 'A',
      }),
      run: () => undefined,
      setProtocol: (_id: string, o?: { stageIndex?: number }) => {
        hp.stageIndex = o?.stageIndex ?? 0;
      },
      protocolEngine: { findMatchByStudy: () => [{ score: 3, protocol: CHEST }] },
    }) as never,
  displaySets: () => [],
  getStudy: uid => ({ StudyInstanceUID: uid }),
  place: () => ({
    capture: () => ({ grid: {} as never, viewports: [] }),
    restore,
    series: () => [],
  }),
  dock: () => ({
    layoutNow: () => ({ ...layout }),
    splitBoundsNow: () => ({ min: 0.3, max: 0.5 }),
    previewLayout: l => {
      held = held ?? { ...layout };
      layout = { mode: l.mode ?? layout.mode, reportRatio: l.reportRatio ?? layout.reportRatio };
      return true;
    },
    endLayoutPreview: apply => {
      if (held && !apply) {
        layout = held;
      }
      held = null;
    },
    layoutMenu: () => ({ modality: 'CT', ownLayout: false }),
    layoutAction: () => true,
    getSnapshot: () => ({ routeStudyRef: 'ref' }),
  }),
  settling: () => false,
  priorLoaded: () => false,
  browsing: { get: () => browsing, preview: m => (browsing = m) },
};
const mockArrange = createArrange(deps);
let mockFocusRequested = false;
jest.mock('../arrange/arrangeHost', () => ({
  currentArrange: () => mockArrange,
  takeArrangeFocusRequest: () => {
    const asked = mockFocusRequested;
    mockFocusRequested = false;
    return asked;
  },
}));
// The dock's snapshot, for the narrow window (Arrange's button gives way).
let mockNarrow = false;
const mockDockListeners = new Set<() => void>();
jest.mock('./session', () => ({
  currentReadingDock: () => ({
    getSnapshot: () => ({ narrow: mockNarrow }),
    subscribe: (l: () => void) => {
      mockDockListeners.add(l);
      return () => mockDockListeners.delete(l);
    },
  }),
  onReadingDockChange: () => () => undefined,
}));

// eslint-disable-next-line import/first
import { ArrangeControl } from './ArrangeControl';

beforeEach(() => {
  mockNarrow = false;
  mockFocusRequested = false;
  hp.stageIndex = 0;
  layout = { mode: 'both', reportRatio: 0.4 };
  held = null;
  restore.mockClear();
});
afterEach(async () => {
  await act(async () => {
    await mockArrange.cancel();
  });
});

const panel = () => document.querySelector('[data-cy="pacsai-arrange-panel"]');

describe('Arrange in the header (milestone 7)', () => {
  it('opens one panel with the Images and Workspace groups, by pointer, keeping the focus where it was', () => {
    render(
      <>
        <textarea data-testid="report" />
        <ArrangeControl />
      </>
    );
    const report = screen.getByTestId('report');
    report.focus();
    const trigger = screen.getByRole('button', { name: /Arrange/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // A pointer press does not take the focus (the report keeps its caret).
    expect(fireEvent.mouseDown(trigger)).toBe(false);
    fireEvent.click(trigger, { detail: 1 });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panel()).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Arrange' })).toBeTruthy();
    expect(document.querySelector('[data-arrange-group="images"]')).not.toBeNull();
    expect(document.querySelector('[data-arrange-group="workspace"]')).not.toBeNull();
    expect(screen.getByText('Using: CT Chest Compare · Axial Lung (current/prior)')).toBeTruthy();
    expect(document.activeElement).toBe(report);
  });

  it('previews a layout, and Cancel puts it back', async () => {
    render(<ArrangeControl />);
    fireEvent.click(screen.getByRole('button', { name: /Arrange/ }), { detail: 1 });
    fireEvent.click(screen.getByRole('radio', { name: 'Coronal (current/prior)' }));
    expect(hp.stageIndex).toBe(1);
    expect(screen.getByRole('button', { name: 'Use this case' })).not.toHaveProperty(
      'disabled',
      true
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }), { detail: 1 });
    });
    expect(hp.stageIndex).toBe(0);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  it('Escape cancels wherever the focus is; a click outside cancels', async () => {
    render(
      <>
        <button type="button">elsewhere</button>
        <ArrangeControl />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /Arrange/ }), { detail: 1 });
    fireEvent.click(screen.getByRole('radio', { name: '50 %' }));
    expect(layout.reportRatio).toBe(0.5);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(layout.reportRatio).toBe(0.4);
    expect(panel()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Arrange/ }), { detail: 1 });
    fireEvent.click(screen.getByRole('radio', { name: 'Report' }));
    expect(layout.mode).toBe('report');
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    });
    expect(layout.mode).toBe('both');
    expect(panel()).toBeNull();
  });

  it('from the keyboard: the panel takes the focus, and gives it back to Arrange', async () => {
    render(<ArrangeControl />);
    const trigger = screen.getByRole('button', { name: /Arrange/ });
    trigger.focus();
    fireEvent.click(trigger, { detail: 0 });
    expect(panel()?.contains(document.activeElement)).toBe(true);
    await act(async () => {
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // ArrowDown on Arrange opens it too.
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(panel()).not.toBeNull();
  });

  it('Use this case keeps the choice and closes; nothing to use until something changed', () => {
    render(<ArrangeControl />);
    fireEvent.click(screen.getByRole('button', { name: /Arrange/ }), { detail: 1 });
    const use = screen.getByRole('button', { name: 'Use this case' }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '45 %' }));
    expect(use.disabled).toBe(false);
    fireEvent.click(use, { detail: 1 });
    expect(layout.reportRatio).toBe(0.45);
    expect(panel()).toBeNull();
  });

  it("offers F56's Save this layout, Restore saved and the modality's own layout", () => {
    render(<ArrangeControl />);
    fireEvent.click(screen.getByRole('button', { name: /Arrange/ }), { detail: 1 });
    expect(screen.getByRole('button', { name: 'Save this layout' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore saved' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Own layout for CT: off' })).toBeTruthy();
  });
  // 8 Nov: a window too narrow for Both (200 % zoom): the button gives way to the
  // image tools, and the gear menu's "Arrange…" opens the panel, focus inside.
  it('in a window too narrow for Both: no button; opened from the gear menu, the panel takes the focus', async () => {
    jest.useFakeTimers();
    try {
      mockNarrow = true;
      render(<ArrangeControl />);
      expect(screen.queryByRole('button', { name: /Arrange/ })).toBeNull();
      await act(async () => {
        mockFocusRequested = true;
        mockArrange.open();
      });
      expect(panel()).not.toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      expect(panel()?.contains(document.activeElement)).toBe(true);
      // Wide again: the button is back.
      await act(async () => {
        mockNarrow = false;
        mockDockListeners.forEach(l => l());
      });
      expect(screen.getByRole('button', { name: /Arrange/ })).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
