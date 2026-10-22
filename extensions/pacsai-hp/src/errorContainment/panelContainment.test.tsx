/**
 * 22 Oct, after the viewports: a side panel's render error reached the
 * route's boundary too, which replaced the whole viewer. ui-next's SidePanel
 * now holds a boundary around its active tab's content: a panel that throws
 * shows a card in its own body; its tabs, the other side panel and the viewer
 * keep working. These render the real SidePanel, twice as ViewerLayout does,
 * and the real ErrorBoundary, inside a route's.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const mockToast = { error: jest.fn(), success: jest.fn() };
jest.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => mockToast.error(...a),
    success: (...a: unknown[]) => mockToast.success(...a),
  },
}));

// eslint-disable-next-line import/first
import { SidePanel } from '../../../../platform/ui-next/src/components/SidePanel/SidePanel';
// eslint-disable-next-line import/first
import { TooltipProvider } from '../../../../platform/ui-next/src/components/Tooltip/Tooltip';
// eslint-disable-next-line import/first
import { ErrorBoundary } from '../../../../platform/ui-next/src/components/Errorboundary/ErrorBoundary';

/** A study browser on 22 Oct's kind of data: a reference object rendered as text. */
let mockStudyBrowserThrows = true;
function StudyBrowserPanel() {
  const description = mockStudyBrowserThrows
    ? ({ BulkDataURI: 'bulk/2', retrieveBulkData: () => undefined } as unknown as string)
    : 'CT Abdomen';
  return <div data-test-panel="studies">{description}</div>;
}
function SegmentationPanel() {
  return <div data-test-panel="segmentation">segments</div>;
}
function MeasurementsPanel() {
  return <div data-test-panel="measurements">measurements</div>;
}

type Tab = { id: string; name: string; label: string; iconName: string; content: React.FC };
const tab = (name: string, content: React.FC): Tab => ({
  id: `${name}-id`,
  name,
  label: name,
  iconName: 'TabStudies',
  content,
});

const noop = () => undefined;
const panelOf = (side: 'left' | 'right', tabs: Tab[]) => (
  <SidePanel
    side={side}
    className=""
    isExpanded
    activeTabIndex={0}
    tabs={tabs}
    onOpen={noop}
    onClose={noop}
    onActiveTabIndexChange={noop}
    {...({} as Record<string, never>)}
  />
);

/** The viewer's route as ViewerLayout lays it out: left panel, images, right panel. */
function Viewer({ left, right }: { left: Tab[]; right: Tab[] }) {
  return (
    <ErrorBoundary
      context="Route /viewer"
      fallbackComponent={() => <div data-test-route-fallback="" />}
    >
      <TooltipProvider>
        <div data-test-left="">{panelOf('left', left)}</div>
        <div data-test-viewer="">images</div>
        <div data-test-right="">{panelOf('right', right)}</div>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

const leftTabs = () => [tab('studies', StudyBrowserPanel), tab('segmentation', SegmentationPanel)];
const rightTabs = () => [tab('measurements', MeasurementsPanel)];
const q = (c: Element, selector: string) => c.querySelector(selector);
const cardIn = (c: Element) => q(c, '[data-pacsai-render-error="panel"]');

let consoleError: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockStudyBrowserThrows = true;
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => consoleError.mockRestore());

describe('a side panel that throws while rendering', () => {
  it('shows a card in its own body; its tabs, the other panel and the viewer stay', () => {
    const { container } = render(
      <Viewer
        left={leftTabs()}
        right={rightTabs()}
      />
    );
    const left = q(container, '[data-test-left]') as Element;

    expect(q(container, '[data-test-route-fallback]')).toBeNull();
    expect(cardIn(left)?.textContent).toContain('This panel could not be displayed');
    expect(q(left, '[data-test-panel="studies"]')).toBeNull();
    expect(q(left, '[data-cy="studies-btn"]')).not.toBeNull();
    expect(q(left, '[data-cy="segmentation-btn"]')).not.toBeNull();
    expect(q(container, '[data-test-viewer]')?.textContent).toBe('images');
    const right = q(container, '[data-test-right]') as Element;
    expect(q(right, '[data-test-panel="measurements"]')?.textContent).toBe('measurements');
    expect(cardIn(right)).toBeNull();
    expect(
      consoleError.mock.calls.some(([first]) => first === 'Panel studies Error Boundary')
    ).toBe(true);
  });

  it('another tab renders; back on the failed one, it renders afresh', () => {
    const { container } = render(
      <Viewer
        left={leftTabs()}
        right={rightTabs()}
      />
    );
    const left = q(container, '[data-test-left]') as Element;

    fireEvent.click(q(left, '[data-cy="segmentation-btn"]') as Element);
    expect(cardIn(left)).toBeNull();
    expect(q(left, '[data-test-panel="segmentation"]')?.textContent).toBe('segments');

    mockStudyBrowserThrows = false;
    fireEvent.click(q(left, '[data-cy="studies-btn"]') as Element);
    expect(cardIn(left)).toBeNull();
    expect(q(left, '[data-test-panel="studies"]')?.textContent).toBe('CT Abdomen');
  });

  it('Try again renders it afresh', () => {
    const { container } = render(
      <Viewer
        left={leftTabs()}
        right={rightTabs()}
      />
    );
    const left = q(container, '[data-test-left]') as Element;
    expect(cardIn(left)).not.toBeNull();

    mockStudyBrowserThrows = false;
    fireEvent.click(q(left, '[data-pacsai-render-error-retry]') as Element);
    expect(cardIn(left)).toBeNull();
    expect(q(left, '[data-test-panel="studies"]')?.textContent).toBe('CT Abdomen');
  });

  it('another panel in that tab renders afresh', () => {
    const { container, rerender } = render(
      <Viewer
        left={leftTabs()}
        right={rightTabs()}
      />
    );
    const left = q(container, '[data-test-left]') as Element;
    expect(cardIn(left)).not.toBeNull();

    // The mode's panels change (a PANELS_CHANGED): the first tab is another panel now.
    rerender(
      <Viewer
        left={[tab('studies', MeasurementsPanel), tab('segmentation', SegmentationPanel)]}
        right={rightTabs()}
      />
    );
    expect(cardIn(left)).toBeNull();
    expect(q(left, '[data-test-panel="measurements"]')?.textContent).toBe('measurements');
  });
});
