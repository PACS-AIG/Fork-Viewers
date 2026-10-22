/**
 * 22 Oct: a prod X-ray study showed a blank viewer. Its text SR's viewport
 * rendered an object as text (React error #31), and the only boundary around
 * the viewer was the route's, which replaced all of it. The viewport grid
 * (platform/app/src/components/ViewportGrid.tsx) now has a boundary in each
 * pane and one around itself: a viewport that throws shows a card in its own
 * pane, the other panes keep rendering, and the route's boundary is not
 * reached. These render the real grid and the real ui-next ErrorBoundary; the
 * pane, the grid's state and the services are stood in.
 */
import React, { useEffect } from 'react';
import { act, fireEvent, render } from '@testing-library/react';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const mockToast = { error: jest.fn(), success: jest.fn() };
jest.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => mockToast.error(...a),
    success: (...a: unknown[]) => mockToast.success(...a),
  },
}));

type Pane = {
  viewportId: string;
  displaySetInstanceUIDs: string[];
  viewportOptions: { viewportId: string };
  displaySetOptions: Record<string, unknown>[];
  x: number;
  y: number;
  width: number;
  height: number;
  viewportLabel: string;
};
let mockGrid: {
  layout: { numRows: number; numCols: number };
  activeViewportId: string;
  isHangingProtocolLayout: boolean;
  viewports: Map<string, Pane>;
};
const mockGridApi = {
  setViewportIsReady: jest.fn(),
  getNumViewportPanes: () => mockGrid.viewports.size,
  getGridViewportsReady: () => false,
  publishViewportsReady: jest.fn(),
  setViewportGridSizeChanged: jest.fn(),
  setActiveViewportId: jest.fn(),
  setLayout: jest.fn(),
  setDisplaySetsForViewports: jest.fn(),
};
jest.mock('@ohif/ui-next', () => ({
  ErrorBoundary: jest.requireActual(
    '../../../../platform/ui-next/src/components/Errorboundary/ErrorBoundary'
  ).ErrorBoundary,
  RenderErrorCard: jest.requireActual(
    '../../../../platform/ui-next/src/components/Errorboundary/RenderErrorCard'
  ).RenderErrorCard,
  useViewportGrid: () => [mockGrid, mockGridApi],
}));
// The pane's drop target and the grid's layout: plain boxes here.
jest.mock('@ohif/ui', () => ({
  ViewportGrid: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ViewportPane: ({ children }: { children: React.ReactNode }) => (
    <div data-test-pane="">{children}</div>
  ),
}));
jest.mock('@ohif/core', () => ({
  MeasurementService: { EVENTS: { JUMP_TO_MEASUREMENT_LAYOUT: 'jump' } },
  Types: {},
}));
jest.mock('@state', () => ({ useAppConfig: () => [{}] }), { virtual: true });
jest.mock('react-resize-detector', () => ({
  useResizeDetector: () => ({ ref: { current: null } }),
}));

// eslint-disable-next-line import/first
import ViewportGrid from '../../../../platform/app/src/components/ViewportGrid';
// eslint-disable-next-line import/first
import { ErrorBoundary } from '../../../../platform/ui-next/src/components/Errorboundary/ErrorBoundary';

type ViewportProps = { viewportId: string; displaySets: Record<string, unknown>[] };

/** An image viewport that renders. */
function ImageViewport({ viewportId, displaySets }: ViewportProps) {
  return <div data-test-viewport={viewportId}>{String(displaySets[0].label)}</div>;
}
/** 22 Oct's defect: the SR's report text arrived as a bulk data reference, rendered as is. */
function TextReportViewport({ viewportId, displaySets }: ViewportProps) {
  return <div data-test-viewport={viewportId}>{displaySets[0].report as React.ReactNode}</div>;
}
let mockFlakyThrows = true;
function FlakyViewport({ viewportId }: ViewportProps) {
  if (mockFlakyThrows) {
    throw new Error('not ready yet');
  }
  return <div data-test-viewport={viewportId}>recovered</div>;
}
/** A viewport whose cleanup throws (a disable on an element already gone). */
function CleanupThrowsViewport({ viewportId }: ViewportProps) {
  useEffect(
    () => () => {
      throw new Error('cleanup failed');
    },
    []
  );
  return <div data-test-viewport={viewportId}>cleanup</div>;
}

const viewportComponents = [
  { displaySetsToDisplay: ['image'], component: ImageViewport },
  { displaySetsToDisplay: ['text-sr'], component: TextReportViewport },
  { displaySetsToDisplay: ['flaky'], component: FlakyViewport },
  { displaySetsToDisplay: ['cleanup'], component: CleanupThrowsViewport },
];

// Synthetic display sets: no real study.
const displaySets: Record<string, Record<string, unknown>> = {
  'ds-cr-1': { displaySetInstanceUID: 'ds-cr-1', SOPClassHandlerId: 'image', label: 'CR view 1' },
  'ds-cr-2': { displaySetInstanceUID: 'ds-cr-2', SOPClassHandlerId: 'image', label: 'CR view 2' },
  'ds-sr': {
    displaySetInstanceUID: 'ds-sr',
    SOPClassHandlerId: 'text-sr',
    report: { BulkDataURI: 'bulk/1', retrieveBulkData: () => undefined },
  },
  'ds-flaky': { displaySetInstanceUID: 'ds-flaky', SOPClassHandlerId: 'flaky' },
  'ds-cleanup': { displaySetInstanceUID: 'ds-cleanup', SOPClassHandlerId: 'cleanup' },
};

const pane = (viewportId: string, uid: string, x: number, width: number): Pane => ({
  viewportId,
  displaySetInstanceUIDs: [uid],
  viewportOptions: { viewportId },
  displaySetOptions: [{}],
  x,
  y: 0,
  width,
  height: 1,
  viewportLabel: viewportId,
});
const gridOf = (...panes: Pane[]) => ({
  layout: { numRows: 1, numCols: panes.length },
  activeViewportId: panes[0].viewportId,
  isHangingProtocolLayout: true,
  viewports: new Map(panes.map(p => [p.viewportId, p])),
});

const servicesManager = {
  services: {
    displaySetService: {
      getDisplaySetByUID: (uid: string) => displaySets[uid],
      getActiveDisplaySets: () => [],
    },
    measurementService: { subscribe: () => ({ unsubscribe: () => undefined }) },
    hangingProtocolService: {
      subscribe: () => ({ unsubscribe: () => undefined }),
      EVENTS: { PROTOCOL_CHANGED: 'changed' },
      getViewportsRequireUpdate: () => [],
    },
    uiNotificationService: { show: jest.fn() },
    customizationService: { getCustomization: () => undefined },
  },
};

/** The grid as Mode.tsx hands it to the layout: a component that calls it as a function. */
const ViewportGridWithDataSource = () =>
  ViewportGrid({ servicesManager, viewportComponents, dataSource: {} } as never);

/** The route's boundary, as routes/index.tsx mounts it, around the grid. */
function RouteWithGrid() {
  return (
    <ErrorBoundary
      context="Route /viewer"
      fallbackComponent={() => <div data-test-route-fallback="" />}
    >
      <div data-test-header="">header</div>
      <ViewportGridWithDataSource />
    </ErrorBoundary>
  );
}

const q = (c: HTMLElement, selector: string) => c.querySelectorAll(selector);
const cardsIn = (c: HTMLElement, scope: 'viewport' | 'grid') =>
  q(c, `[data-pacsai-render-error="${scope}"]`);

let consoleError: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockFlakyThrows = true;
  // React and the boundaries log each caught error; asserted where it matters.
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
  jest.useRealTimers();
});

describe('a viewport that throws while rendering', () => {
  it('shows a card in its own pane; the other pane, the header and the route stay', () => {
    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 0.5), pane('vp-2', 'ds-sr', 0.5, 0.5));
    const { container } = render(<RouteWithGrid />);

    expect(q(container, '[data-test-route-fallback]')).toHaveLength(0);
    expect(q(container, '[data-test-header]')).toHaveLength(1);
    expect(cardsIn(container, 'grid')).toHaveLength(0);
    const cards = cardsIn(container, 'viewport');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('This series could not be displayed');

    const panes = q(container, '[data-test-pane]');
    expect(panes).toHaveLength(2);
    expect(panes[0].querySelector('[data-test-viewport="vp-1"]')?.textContent).toBe('CR view 1');
    expect(panes[1].contains(cards[0])).toBe(true);
    expect(panes[1].querySelector('[data-test-viewport]')).toBeNull();
  });

  it('keeps the error behind Details, the error text only', () => {
    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 0.5), pane('vp-2', 'ds-sr', 0.5, 0.5));
    const { container } = render(<RouteWithGrid />);

    expect(q(container, '[data-pacsai-render-error-text]')).toHaveLength(0);
    fireEvent.click(container.querySelector('[data-pacsai-render-error-details]') as Element);
    const text = container.querySelector('[data-pacsai-render-error-text]')?.textContent ?? '';
    expect(text).toMatch(/^Error: Objects are not valid as a React child/);
    expect(text).toContain('BulkDataURI');
  });

  it('logs the error with its viewport, and marks that viewport ready', () => {
    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 0.5), pane('vp-2', 'ds-sr', 0.5, 0.5));
    render(<RouteWithGrid />);

    expect(
      consoleError.mock.calls.some(([first]) => first === 'Viewport vp-2 Error Boundary')
    ).toBe(true);
    // The grid's VIEWPORTS_READY waits for every pane; this one will never enable an element.
    expect(mockGridApi.setViewportIsReady).toHaveBeenCalledWith('vp-2', true);
    expect(mockGridApi.setViewportIsReady).not.toHaveBeenCalledWith('vp-1', true);
  });

  it('renders afresh when the pane gets another series', () => {
    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 0.5), pane('vp-2', 'ds-sr', 0.5, 0.5));
    const { container, rerender } = render(<RouteWithGrid />);
    expect(cardsIn(container, 'viewport')).toHaveLength(1);

    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 0.5), pane('vp-2', 'ds-cr-2', 0.5, 0.5));
    rerender(<RouteWithGrid />);
    expect(cardsIn(container, 'viewport')).toHaveLength(0);
    expect(container.querySelector('[data-test-viewport="vp-2"]')?.textContent).toBe('CR view 2');
  });

  it('renders afresh on Try again', () => {
    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 0.5), pane('vp-2', 'ds-flaky', 0.5, 0.5));
    const { container } = render(<RouteWithGrid />);
    expect(cardsIn(container, 'viewport')).toHaveLength(1);

    mockFlakyThrows = false;
    fireEvent.click(container.querySelector('[data-pacsai-render-error-retry]') as Element);
    expect(cardsIn(container, 'viewport')).toHaveLength(0);
    expect(container.querySelector('[data-test-viewport="vp-2"]')?.textContent).toBe('recovered');
  });
});

describe('what gets past a pane', () => {
  it('a viewport throwing as a layout change removes its pane: the grid shows a card, the route stays', () => {
    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 0.5), pane('vp-2', 'ds-cleanup', 0.5, 0.5));
    const { container, rerender } = render(<RouteWithGrid />);
    expect(container.querySelector('[data-test-viewport="vp-2"]')).not.toBeNull();

    // 1x2 to 1x1: vp-2's pane, and the boundary in it, go; its cleanup throws.
    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 1));
    act(() => rerender(<RouteWithGrid />));

    expect(q(container, '[data-test-route-fallback]')).toHaveLength(0);
    expect(q(container, '[data-test-header]')).toHaveLength(1);
    const cards = cardsIn(container, 'grid');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('The images could not be displayed');

    // Try again renders the grid afresh, in its new layout.
    fireEvent.click(cards[0].querySelector('[data-pacsai-render-error-retry]') as Element);
    expect(cardsIn(container, 'grid')).toHaveLength(0);
    expect(container.querySelector('[data-test-viewport="vp-1"]')?.textContent).toBe('CR view 1');
  });
});

describe("the route's own render error", () => {
  it("still reaches the route's boundary, whose toast stays until dismissed", () => {
    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 1));
    function Header(): React.ReactElement {
      throw new Error('the header threw');
    }
    const { container } = render(
      <ErrorBoundary context="Route /viewer">
        <Header />
        <ViewportGridWithDataSource />
      </ErrorBoundary>
    );

    expect(container.querySelector('[data-test-viewport]')).toBeNull();
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    const [title, options] = mockToast.error.mock.calls[0];
    expect(title).toBe('Something went wrong in Route /viewer.');
    // Sonner reads a duration of 0 as its default, 4 s.
    expect(options.duration).toBe(Infinity);
  });
});

describe('an error no boundary can catch', () => {
  it('reaches no boundary: no card, no fallback, nothing silenced on its behalf', () => {
    jest.useFakeTimers();
    mockGrid = gridOf(pane('vp-1', 'ds-cr-1', 0, 0.5), pane('vp-2', 'ds-cr-2', 0.5, 0.5));
    const { container } = render(
      // The route's boundary with its default fallback (which toasts when shown).
      <ErrorBoundary context="Route /viewer">
        <div data-test-header="">header</div>
        <ViewportGridWithDataSource />
      </ErrorBoundary>
    );

    const rejection = Object.assign(new Event('unhandledrejection', { cancelable: true }), {
      reason: new RangeError('byte length of Float32Array should be a multiple of 4'),
    });
    const thrown = new ErrorEvent('error', {
      cancelable: true,
      error: new TypeError('a timer threw'),
      message: 'a timer threw',
    });
    // A listener of the test's own: with none on the window, jest's jsdom
    // environment rethrows a dispatched error event as the test's failure.
    const seen = jest.fn();
    window.addEventListener('error', seen);
    act(() => {
      window.dispatchEvent(rejection);
      window.dispatchEvent(thrown);
      jest.advanceTimersByTime(500);
    });
    window.removeEventListener('error', seen);
    expect(seen).toHaveBeenCalledTimes(1);

    // The boundaries used to take these as their own: silenced, then (100 ms
    // later) their fallback and its toast. The page's reporter has them now.
    expect(rejection.defaultPrevented).toBe(false);
    expect(thrown.defaultPrevented).toBe(false);
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(cardsIn(container, 'viewport')).toHaveLength(0);
    expect(cardsIn(container, 'grid')).toHaveLength(0);
    expect(container.querySelector('[data-test-viewport="vp-1"]')?.textContent).toBe('CR view 1');
    expect(container.querySelector('[data-test-viewport="vp-2"]')?.textContent).toBe('CR view 2');
  });
});
