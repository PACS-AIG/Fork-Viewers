/**
 * RS-36: the viewer grid's 3D anatomy cell (anatomy3dCell): OHIF's viewport
 * for the cell's display set, drawing the model as the Anatomy tab's 3D view
 * does (the tab's colours and switches, the picked-out structure, Show all),
 * with its x taking the cell out of the grid.
 *
 * Not an image viewport: it takes the pointer itself, though OHIF turns the
 * pointer off in a viewport until it is the active one, and a click or the
 * wheel in it never makes it OHIF's active viewport (the toolbar's tools act
 * on images); a double click is not OHIF's one-up; the trackball and the
 * wheel are the model's.
 */
import React, { useEffect, useSyncExternalStore } from 'react';
import { ensurePaneStyle } from '../RsPane';
import { Anatomy3DView } from './Anatomy3DView';
import { currentAnatomy3dCell, type Anatomy3dCell } from './anatomy3dCell';

const noCell = {
  subscribe: () => () => {},
  version: () => 0,
};
// The cell's own pointer handling, not the viewport pane's (OHIF activates a viewport on pointer down, click and wheel).
const keep = (e: React.SyntheticEvent) => e.stopPropagation();

export function Anatomy3DViewport(): React.ReactElement {
  const cell: Anatomy3dCell | null = currentAnatomy3dCell();
  const source = cell ?? noCell;
  useSyncExternalStore(source.subscribe, source.version, source.version);
  const doc = typeof document === 'undefined' ? undefined : document;
  useEffect(() => ensurePaneStyle(doc), [doc]);
  const series = cell?.series() ?? null;
  return (
    <div
      className="prs-3d-cell"
      data-rs-anatomy-3d-cell=""
      onPointerDown={keep}
      onClick={keep}
      onDoubleClick={keep}
      onWheel={keep}
    >
      {cell && series !== null ? (
        <Anatomy3DView
          store={cell.store}
          series={series}
          inViewport
          onClose={() => cell.hide()}
        />
      ) : (
        <div className="prs-3d-cell-empty">The 3D anatomy is not available for this study.</div>
      )}
    </div>
  );
}

export default Anatomy3DViewport;
