/**
 * RS-36: where a structure is, for the eye.
 *
 *   - `deepestPoint`: in a mask, the pixel of its largest piece (8-connected)
 *     farthest from the piece's edge (a 3-4 chamfer distance): the middle of
 *     its widest part. A click on a structure aims there. Its centroid would
 *     not do: a curved or scattered structure's centroid can lie outside it
 *     (the colon's pieces around the small bowel, the costal cartilages' arc
 *     in front of the heart), and the coronal and sagittal views through it
 *     would miss the structure. Among pixels equally deep, the one nearest
 *     their centroid.
 *   - `placeCallout`: where a structure's name goes on a view: beside its
 *     largest piece on one side, or at the view's left or right edge at its
 *     height, whichever covers the least drawn anatomy and none of the
 *     viewport's corner text, with the shortest leader. The side it took
 *     last time is kept unless another is clearly better, so the name does
 *     not hop from side to side as the reader scrolls.
 *
 * Pure: no window, React or OHIF here.
 */

/** A rectangle in pixels: right and bottom exclusive. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DeepestPoint {
  /** The pixel, in the mask's columns and rows. */
  x: number;
  y: number;
  /** Its distance to the piece's edge, in pixels (1 on the edge). */
  depth: number;
  /** The piece's pixel count and box. */
  size: number;
  box: Rect;
}

/**
 * The deepest pixel of a mask's largest 8-connected piece (non-zero is
 * inside; `w` columns, row after row). Outside the mask's frame counts as
 * outside the piece. Null for an empty mask.
 */
export function deepestPoint(mask: Uint8Array, w: number, h: number): DeepestPoint | null {
  const n = w * h;
  if (!(n > 0) || mask.length < n) {
    return null;
  }
  // Its pieces, by a flood fill over the 8 neighbours.
  const piece = new Int32Array(n);
  const stack = new Int32Array(n);
  let pieces = 0;
  let largest = 0;
  let largestSize = 0;
  for (let p = 0; p < n; p++) {
    if (!mask[p] || piece[p]) {
      continue;
    }
    const id = ++pieces;
    let top = 0;
    let size = 0;
    stack[top++] = p;
    piece[p] = id;
    while (top > 0) {
      const q = stack[--top];
      size++;
      const x = q % w;
      const y = (q - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= w) {
            continue;
          }
          const r = yy * w + xx;
          if (mask[r] && !piece[r]) {
            piece[r] = id;
            stack[top++] = r;
          }
        }
      }
    }
    if (size > largestSize) {
      largestSize = size;
      largest = id;
    }
  }
  if (!largest) {
    return null;
  }

  // The 3-4 chamfer distance (3 a side step, 4 a diagonal one) to the nearest pixel outside the piece.
  const d = new Int32Array(n);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (piece[p] === largest) {
        d[p] = 1 << 29;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * w + x;
      if (!d[p]) {
        continue;
      }
      let v = d[p];
      v = Math.min(v, (x > 0 ? d[p - 1] : 0) + 3);
      v = Math.min(v, (y > 0 ? d[p - w] : 0) + 3);
      v = Math.min(v, (x > 0 && y > 0 ? d[p - w - 1] : 0) + 4);
      v = Math.min(v, (x < w - 1 && y > 0 ? d[p - w + 1] : 0) + 4);
      d[p] = v;
    }
  }
  let deepest = 0;
  for (let y = y1; y >= y0; y--) {
    for (let x = x1; x >= x0; x--) {
      const p = y * w + x;
      if (!d[p]) {
        continue;
      }
      let v = d[p];
      v = Math.min(v, (x < w - 1 ? d[p + 1] : 0) + 3);
      v = Math.min(v, (y < h - 1 ? d[p + w] : 0) + 3);
      v = Math.min(v, (x < w - 1 && y < h - 1 ? d[p + w + 1] : 0) + 4);
      v = Math.min(v, (x > 0 && y < h - 1 ? d[p + w - 1] : 0) + 4);
      d[p] = v;
      deepest = Math.max(deepest, v);
    }
  }

  // The deepest pixels' centroid, then the deepest pixel nearest it.
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (d[y * w + x] === deepest) {
        sx += x;
        sy += y;
        count++;
      }
    }
  }
  const cx = sx / count;
  const cy = sy / count;
  let best = -1;
  let bestDistance = Infinity;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * w + x;
      if (d[p] !== deepest) {
        continue;
      }
      const dd = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (dd < bestDistance - 1e-9) {
        bestDistance = dd;
        best = p;
      }
    }
  }
  const bx = best % w;
  return {
    x: bx,
    y: (best - bx) / w,
    depth: deepest / 3,
    size: largestSize,
    box: { left: x0, top: y0, right: x1 + 1, bottom: y1 + 1 },
  };
}

export type CalloutSide = 'left' | 'right' | 'above' | 'below' | 'edge-left' | 'edge-right';

export interface CalloutInput {
  /** The view, CSS px. */
  width: number;
  height: number;
  /** The point inside the structure the leader ends on (a pixel's centre). */
  anchor: [number, number];
  /** The box of the structure's largest piece. */
  piece: Rect;
  /** The name label's width and height. */
  label: [number, number];
  /** How much of a rectangle is drawn anatomy, and how much is the structure itself (each 0..1). */
  cover: (r: Rect) => { anatomy: number; self: number };
  /** Where the viewport's own text sits (its corners' overlay, the orientation letters). */
  avoid: Rect[];
  /** The side the label took last time on this view. */
  last: CalloutSide | null;
}

export interface Callout {
  side: CalloutSide;
  box: Rect;
  /** The leader: from the label's nearest point to the anchor. */
  from: [number, number];
  to: [number, number];
}

/** How far a label stands off its structure and the view's edge, px. */
export const CALLOUT_GAP = 14;
export const CALLOUT_MARGIN = 6;

const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Where the name label goes, or null when the view has no room for it. */
export function placeCallout(input: CalloutInput): Callout | null {
  const { width: W, height: H, anchor, piece, avoid, last } = input;
  const [lw, lh] = input.label;
  const M = CALLOUT_MARGIN;
  const G = CALLOUT_GAP;
  if (!(lw > 0 && lh > 0) || lw + 2 * M > W || lh + 2 * M > H) {
    return null;
  }
  const [ax, ay] = anchor;
  const at = (side: CalloutSide, left: number, top: number) => {
    const l = Math.max(M, Math.min(left, W - M - lw));
    const t = Math.max(M, Math.min(top, H - M - lh));
    return { side, box: { left: l, top: t, right: l + lw, bottom: t + lh } };
  };
  const candidates = [
    at('left', piece.left - G - lw, ay - lh / 2),
    at('right', piece.right + G, ay - lh / 2),
    at('above', ax - lw / 2, piece.top - G - lh),
    at('below', ax - lw / 2, piece.bottom + G),
    at('edge-left', M, ay - lh / 2),
    at('edge-right', W - M - lw, ay - lh / 2),
  ];
  let best: Callout | null = null;
  let bestCost = Infinity;
  for (const c of candidates) {
    const b = c.box;
    const area = lw * lh;
    const from: [number, number] = [
      Math.max(b.left, Math.min(ax, b.right)),
      Math.max(b.top, Math.min(ay, b.bottom)),
    ];
    const length = Math.hypot(ax - from[0], ay - from[1]);
    const blocked = avoid.reduce((s, r) => s + overlap(b, r), 0) / area;
    const { anatomy, self } = input.cover(b);
    const onAnchor = ax >= b.left && ax < b.right && ay >= b.top && ay < b.bottom;
    const cost =
      (blocked > 0 ? 500 + 1000 * blocked : 0) +
      (onAnchor ? 1000 : 0) +
      300 * self +
      100 * anatomy +
      0.15 * length -
      (c.side === last ? 15 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = { side: c.side, box: b, from, to: [ax, ay] };
    }
  }
  return best;
}
