import { CALLOUT_GAP, deepestPoint, placeCallout, type Rect } from './anatomyFocus';

/** A mask from rows of '#' (inside) and '.' (outside). */
function maskOf(rows: string[]): { mask: Uint8Array; w: number; h: number } {
  const w = rows[0].length;
  const h = rows.length;
  const mask = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((c, x) => (mask[y * w + x] = c === '#' ? 1 : 0)));
  return { mask, w, h };
}
const deepest = (rows: string[]) => {
  const { mask, w, h } = maskOf(rows);
  return deepestPoint(mask, w, h);
};

describe('the point inside a structure (RS-36)', () => {
  it("takes a block's middle, the pixel farthest from its edge", () => {
    expect(deepest(['#######', '#######', '#######', '#######', '#######'])).toEqual({
      x: 3,
      y: 2,
      depth: 3,
      size: 35,
      box: { left: 0, top: 0, right: 7, bottom: 5 },
    });
    // Equally deep pixels: the one nearest their middle (the first of those, row by row).
    expect(
      deepest(['########', '########', '########', '########', '########', '########'])
    ).toMatchObject({
      x: 3,
      y: 2,
      depth: 3,
    });
  });

  it('stays inside a curved structure whose centroid lies outside it', () => {
    // A thick C: its centroid falls in the opening, on no pixel of it.
    const rows = [
      '#########',
      '#########',
      '###......',
      '###......',
      '###......',
      '#########',
      '#########',
    ];
    const { mask, w } = maskOf(rows);
    let sx = 0;
    let sy = 0;
    let n = 0;
    mask.forEach((v, p) => {
      if (v) {
        sx += p % w;
        sy += Math.floor(p / w);
        n++;
      }
    });
    expect(mask[Math.round(sy / n) * w + Math.round(sx / n)]).toBe(0);
    const p = deepest(rows)!;
    expect(mask[p.y * w + p.x]).toBe(1);
    // The C's back is its widest part.
    expect(p).toMatchObject({ x: 1, y: 3, depth: 2 });
  });

  it('takes the largest piece, its diagonal neighbours counting as one piece with it', () => {
    const p = deepest([
      '##.........',
      '##.........',
      '...#####...',
      '...#####...',
      '..#........',
      '.#.........',
    ])!;
    // The bar and the two pixels touching it at corners: 12 pixels, more than the 4-pixel block.
    expect(p.size).toBe(12);
    expect(p.box).toEqual({ left: 1, top: 2, right: 8, bottom: 6 });
    // Every pixel of it is on its edge: the one nearest their middle, (4.4, 2.8).
    expect([p.x, p.y]).toEqual([4, 3]);
    expect(deepest(['....', '....'])).toBeNull();
    expect(deepestPoint(new Uint8Array(0), 0, 0)).toBeNull();
  });
});

describe('where a structure’s name goes on a view (RS-36)', () => {
  // A 400 x 300 view; the structure's piece in the middle; its name 60 x 18.
  const piece: Rect = { left: 180, top: 130, right: 220, bottom: 170 };
  const base = {
    width: 400,
    height: 300,
    anchor: [200, 150] as [number, number],
    piece,
    label: [60, 18] as [number, number],
    avoid: [] as Rect[],
    last: null,
  };
  // Drawn anatomy right of x = 230 and below y = 200; the piece itself.
  const fraction = (r: Rect, inside: (x: number, y: number) => boolean) => {
    let n = 0;
    let hit = 0;
    for (let y = r.top; y < r.bottom; y += 2) {
      for (let x = r.left; x < r.right; x += 2) {
        n++;
        hit += inside(x, y) ? 1 : 0;
      }
    }
    return n ? hit / n : 0;
  };
  const inPiece = (x: number, y: number) =>
    x >= piece.left && x < piece.right && y >= piece.top && y < piece.bottom;
  const cover = (r: Rect) => ({
    anatomy: fraction(r, (x, y) => x >= 230 || y >= 200 || inPiece(x, y)),
    self: fraction(r, inPiece),
  });

  it('puts it beside the structure, where nothing is drawn, the leader from its nearest point', () => {
    const c = placeCallout({ ...base, cover })!;
    expect(c.side).toBe('left');
    expect(c.box).toEqual({
      left: piece.left - CALLOUT_GAP - 60,
      top: 141,
      right: piece.left - CALLOUT_GAP,
      bottom: 159,
    });
    expect(c.from).toEqual([166, 150]);
    expect(c.to).toEqual([200, 150]);
  });

  it("keeps clear of the viewport's corner text and the point it names", () => {
    const blocked = { left: 90, top: 120, right: 170, bottom: 180 };
    const c = placeCallout({ ...base, cover, avoid: [blocked] })!;
    expect(c.side).not.toBe('left');
    expect(
      Math.min(c.box.right, blocked.right) - Math.max(c.box.left, blocked.left) <= 0 ||
        Math.min(c.box.bottom, blocked.bottom) - Math.max(c.box.top, blocked.top) <= 0
    ).toBe(true);
    // A structure against the view's left edge: the left side would sit on it, so another side.
    const edge = placeCallout({
      ...base,
      anchor: [20, 150],
      piece: { left: 0, top: 120, right: 40, bottom: 180 },
      cover: () => ({ anatomy: 0, self: 0 }),
    })!;
    expect(
      edge.box.left > 20 || edge.box.right <= 20 || edge.box.bottom <= 150 || edge.box.top > 150
    ).toBe(true);
  });

  it('keeps the side it took last time unless another is clearly better, and needs room', () => {
    const empty = () => ({ anatomy: 0, self: 0 });
    // Left and right alike: left comes first, unless the label was on the right.
    expect(placeCallout({ ...base, cover: empty })!.side).toBe('left');
    expect(placeCallout({ ...base, cover: empty, last: 'right' })!.side).toBe('right');
    // The right side covered in anatomy: it moves, whatever it took before.
    expect(placeCallout({ ...base, cover, last: 'right' })!.side).toBe('left');
    expect(placeCallout({ ...base, width: 60, cover })).toBeNull();
    expect(placeCallout({ ...base, label: [0, 18], cover })).toBeNull();
  });
});
