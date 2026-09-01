import React from 'react';

import useIsTruncated from './useIsTruncated';

/**
 * One line of viewport-overlay text that shows its FULL value on hover when the
 * pane is too narrow to display it.
 *
 * The overlay corners are capped at 40% of the pane width, so on a 2-up compare
 * or a whole-spine 3-up the date, series and study lines lose their tails —
 * exactly the information the reader went looking for. The tooltip (and the
 * pointer events it needs) appear ONLY while the text is actually clipped, so a
 * fully-visible line never takes the mouse away from the image beneath it.
 *
 * Used by the top-left items (study date+time, series description, study
 * description); the role pills do their own version inside `RoleTag`.
 */
export function OverlayTextLine({ text }: { text?: string | null }) {
  const { ref, truncated } = useIsTruncated<HTMLSpanElement>();

  if (!text) {
    return null;
  }

  return (
    <span
      ref={ref}
      title={truncated ? text : undefined}
      data-cy="overlay-text-line"
      style={{
        // inline-block so clientWidth is measurable (an inline span reports 0)
        // and so this element, not just an ancestor, ellipsizes.
        display: 'inline-block',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'bottom',
        pointerEvents: truncated ? 'auto' : 'none',
      }}
    >
      {text}
    </span>
  );
}

/**
 * Wrap a value-picker into an overlay-item `contentF` that renders through
 * `OverlayTextLine`. Lets the mode patch the stock top-left items without
 * importing React (those mode files are plain .ts).
 */
export function overlayTextLine(
  pick: (props: Record<string, any>) => string | undefined | null
) {
  return (props: Record<string, any>) => <OverlayTextLine text={pick(props)} />;
}

export default OverlayTextLine;
