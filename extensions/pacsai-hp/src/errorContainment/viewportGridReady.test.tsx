/**
 * ui-next's ViewportGridProvider: a ready signal for a viewport no longer in
 * the grid (a layout change removed it before its element enabled, or before
 * its pane's error card marked it) returned no state, and every reader of the
 * grid then threw. It now leaves the state as it is.
 */
import React from 'react';
import { act, render } from '@testing-library/react';

jest.mock('@ohif/core', () => {
  class ViewportGridService {
    setServiceImplementation() {
      return undefined;
    }
  }
  return { ViewportGridService, utils: { uuidv4: () => '12345678-0000-4000-8000-000000000000' } };
});

// eslint-disable-next-line import/first
import { ViewportGridService } from '@ohif/core';
// eslint-disable-next-line import/first
import {
  ViewportGridProvider,
  useViewportGrid,
} from '../../../../platform/ui-next/src/contextProviders/ViewportGridProvider';

let grid: ReturnType<typeof useViewportGrid>;
function Reader() {
  grid = useViewportGrid();
  const [state] = grid;
  const ready = Array.from(state.viewports.values()).filter(v => v.isReady).length;
  return <div data-test-grid="">{`${state.viewports.size} viewport(s), ${ready} ready`}</div>;
}

const mount = () =>
  render(
    <ViewportGridProvider service={new (ViewportGridService as unknown as new () => never)()}>
      <Reader />
    </ViewportGridProvider>
  );

it('a ready signal for a viewport the grid no longer has leaves the grid as it is', () => {
  const { container } = mount();
  expect(container.textContent).toBe('1 viewport(s), 0 ready');

  act(() => grid[1].setViewportIsReady('removed-by-a-layout-change', true));
  expect(container.textContent).toBe('1 viewport(s), 0 ready');

  // And one for a viewport it has still counts.
  act(() => grid[1].setViewportIsReady('default', true));
  expect(container.textContent).toBe('1 viewport(s), 1 ready');
});
