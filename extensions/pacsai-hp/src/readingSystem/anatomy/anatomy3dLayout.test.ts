import { gridBoxes, withAnatomy3dCell, type CellBox } from './anatomy3dLayout';

const r = (b: CellBox) => [b.x, b.y, b.width, b.height].map(v => Math.round(v * 1000) / 1000);

describe('where the 3D anatomy cell goes in the grid (RS-36)', () => {
  it('gives a uniform grid its boxes in reading order', () => {
    expect(gridBoxes(2, 2).map(r)).toEqual([
      [0, 0, 0.5, 0.5],
      [0.5, 0, 0.5, 0.5],
      [0, 0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5],
    ]);
    expect(gridBoxes(1, 3, 2)).toHaveLength(2);
  });

  it('grows one row of up to three: 1x1 -> 1x2, 1x2 -> 1x3, 1x3 -> 2x2, the model last', () => {
    const one = withAnatomy3dCell(1, 1, gridBoxes(1, 1));
    expect([one.numRows, one.numCols]).toEqual([1, 2]);
    expect(one.layoutOptions.map(r)).toEqual([
      [0, 0, 0.5, 1],
      [0.5, 0, 0.5, 1],
    ]);
    const pair = withAnatomy3dCell(1, 2, gridBoxes(1, 2));
    expect([pair.numRows, pair.numCols]).toEqual([1, 3]);
    expect(pair.layoutOptions.map(r)[2]).toEqual([0.667, 0, 0.333, 1]);
    const three = withAnatomy3dCell(1, 3, gridBoxes(1, 3));
    expect([three.numRows, three.numCols]).toEqual([2, 2]);
    expect(three.layoutOptions.map(r)).toEqual([
      [0, 0, 0.5, 0.5],
      [0.5, 0, 0.5, 0.5],
      [0, 0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5],
    ]);
  });

  it('gives any other layout a new right-hand column for the model, spanning every row', () => {
    const four = withAnatomy3dCell(2, 2, gridBoxes(2, 2));
    expect([four.numRows, four.numCols]).toEqual([2, 3]);
    expect(four.layoutOptions.map(r)).toEqual([
      [0, 0, 0.333, 0.5],
      [0.333, 0, 0.333, 0.5],
      [0, 0.5, 0.333, 0.5],
      [0.333, 0.5, 0.333, 0.5],
      [0.667, 0, 0.333, 1],
    ]);
    const six = withAnatomy3dCell(2, 3, gridBoxes(2, 3));
    expect([six.numRows, six.numCols]).toEqual([2, 4]);
    expect(six.layoutOptions.map(r)[6]).toEqual([0.75, 0, 0.25, 1]);
    // One row of four: a column too (four images stay in their row).
    const row4 = withAnatomy3dCell(1, 4, gridBoxes(1, 4));
    expect([row4.numRows, row4.numCols]).toEqual([1, 5]);
    // A custom layout (a wide pane over two): its boxes narrowed, the model on the right.
    const custom = withAnatomy3dCell(2, 2, [
      { x: 0, y: 0, width: 1, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ]);
    expect(custom.layoutOptions.map(r)).toEqual([
      [0, 0, 0.667, 0.5],
      [0, 0.5, 0.333, 0.5],
      [0.333, 0.5, 0.333, 0.5],
      [0.667, 0, 0.333, 1],
    ]);
  });
});
