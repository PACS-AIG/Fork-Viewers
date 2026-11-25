/**
 * RS-36: where the 3D anatomy cell goes in the viewer's grid (WeiWei, 25 Nov
 * 2026: the 3D model in the main viewports, an exception to the hanging
 * protocol's layout). The protocol's layout gains one cell, the model's,
 * after the stage's own viewports, which keep their order:
 *
 *   - one row of up to three: 1x1 -> 1x2, 1x2 -> 1x3 (a current | prior pair
 *     stays side by side), 1x3 -> 2x2 (the three images, then the model);
 *   - any other layout (more rows, a custom one): a new column on the right
 *     for the model, spanning every row; the stage's viewports keep their
 *     places, narrowed (2x2 -> 2x3, 2x3 -> 2x4).
 *
 * Boxes are fractions of the grid, as OHIF's viewport grid takes them
 * (`layoutOptions`): x and y from the top left, width and height.
 */

export interface CellBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridLayout {
  numRows: number;
  numCols: number;
  /** One box per pane, in pane order: the stage's viewports, then the model's last. */
  layoutOptions: CellBox[];
}

const EPS = 1e-6;
const near = (a: CellBox, b: CellBox): boolean =>
  Math.abs(a.x - b.x) < EPS &&
  Math.abs(a.y - b.y) < EPS &&
  Math.abs(a.width - b.width) < EPS &&
  Math.abs(a.height - b.height) < EPS;

/** The boxes of a uniform grid, in reading order (OHIF's pane order). */
export function gridBoxes(numRows: number, numCols: number, count = numRows * numCols): CellBox[] {
  const boxes: CellBox[] = [];
  for (let i = 0; i < count && i < numRows * numCols; i++) {
    const row = Math.floor(i / numCols);
    const col = i % numCols;
    boxes.push({ x: col / numCols, y: row / numRows, width: 1 / numCols, height: 1 / numRows });
  }
  return boxes;
}

/**
 * The layout with the 3D cell added to a grid of `numRows` x `numCols` whose
 * panes have `boxes` (in pane order). The model's box is the last.
 */
export function withAnatomy3dCell(numRows: number, numCols: number, boxes: CellBox[]): GridLayout {
  const n = boxes.length;
  const oneRow =
    numRows === 1 &&
    n === numCols &&
    n >= 1 &&
    gridBoxes(1, numCols).every((b, i) => near(b, boxes[i]));
  if (oneRow && n <= 2) {
    return { numRows: 1, numCols: n + 1, layoutOptions: gridBoxes(1, n + 1) };
  }
  if (oneRow && n === 3) {
    return { numRows: 2, numCols: 2, layoutOptions: gridBoxes(2, 2) };
  }
  const cols = Math.max(1, numCols);
  const scale = cols / (cols + 1);
  return {
    numRows: Math.max(1, numRows),
    numCols: cols + 1,
    layoutOptions: [
      ...boxes.map(b => ({ x: b.x * scale, y: b.y, width: b.width * scale, height: b.height })),
      { x: scale, y: 0, width: 1 - scale, height: 1 },
    ],
  };
}
