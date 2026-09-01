import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Is this element's text actually clipped right now?
 *
 * The viewport overlay corners are capped at 40% of the pane width
 * (CustomizableViewportOverlay.css) and ellipsize their spans, so on a narrow
 * pane — a 2-up compare, a whole-spine 3-up — a date or a role pill silently
 * loses its tail ("PRIOR · JUN 1, 2026 14…"). A tooltip fixes that, but a
 * tooltip needs pointer events, and permanently enabling them on a corner would
 * eat tool drags that start there. So: measure, and only opt into pointer events
 * (and a title) when the text is genuinely cut off.
 *
 * Re-measures after every render and on any width change (ResizeObserver), so
 * dragging a panel or changing layout flips the tooltip on and off correctly.
 * The element must be a block/inline-block for clientWidth to be meaningful —
 * an inline span always reports 0.
 */
export function useIsTruncated<T extends HTMLElement>(): {
  ref: React.RefObject<T>;
  truncated: boolean;
} {
  const ref = useRef<T>(null);
  const [truncated, setTruncated] = useState(false);

  // No dependency array on purpose: the label and the available width both
  // change without a prop we can watch. setState with an unchanged value bails
  // out, so this settles after one extra render instead of looping.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    // The clip can happen at ANY level between us and the overlay corner: the
    // stock `ohif.overlayItem` wraps its value in a `shrink-0` span, so our own
    // box often gets its full content width while an ancestor is what actually
    // cuts the text off. Walk up to the `.viewport-overlay` container and treat a
    // clip anywhere along the way as "the reader cannot see all of this".
    const measure = () => {
      let node: HTMLElement | null = element;
      let clipped = false;
      while (node) {
        if (node.scrollWidth > node.clientWidth + 1) {
          clipped = true;
          break;
        }
        if (node.classList?.contains('viewport-overlay')) {
          break;
        }
        node = node.parentElement;
      }
      setTruncated(clipped);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    // Observe our own box AND the corner container: when an ancestor is the one
    // clipping us, a narrowing pane never resizes our box, so watching only
    // ourselves would leave the tooltip stale.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const container = element.closest('.viewport-overlay');
    if (container) {
      observer.observe(container);
    }
    return () => observer.disconnect();
  });

  return { ref, truncated };
}

export default useIsTruncated;
