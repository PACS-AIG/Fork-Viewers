import React, { useState } from 'react';

import useIsTruncated from './useIsTruncated';

/**
 * The study-role pill rendered in a viewport's top-right corner
 * ("CURRENT · JUN 1, 2026 14:32", "PRIOR · … · 3 MO").
 *
 * Shared by the static CURRENT tag (`studyRoleOverlayItem`) and the interactive
 * PRIOR tag (`PriorSwitcher`), so a clickable prior looks identical to a
 * non-clickable one apart from the caret and the hover cursor.
 *
 * `onActivate` turns it into a real <button>: the overlay corners are
 * `pointer-events: none` (ViewportOverlay), so an interactive child must opt
 * itself back in, and mousedown must be stopped or cornerstone starts a tool
 * drag on the image underneath. It also lifts itself above the in-viewport
 * insets — the scroll minimap (z 20) is a full-height 14px strip on the right
 * edge and the pill's caret end can fall under it, which reads as a dead button.
 *
 * Both variants surface the FULL text on hover when the corner clips the pill
 * (capped at 40% of the pane width). The interactive one always carries a title
 * — it holds pointer events anyway — while the static one claims them only while
 * actually clipped, so a fully-readable pill never takes the mouse away from the
 * image beneath it.
 */
export function RoleTag({
  color,
  label,
  onActivate,
  title,
  expanded,
  buttonRef,
}: {
  color: string;
  label: string;
  /** Provide to render an interactive tag (button + caret). */
  onActivate?: () => void;
  title?: string;
  /** Reflected as aria-expanded when interactive. */
  expanded?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const { ref: textRef, truncated } = useIsTruncated<HTMLSpanElement>();
  const [hovered, setHovered] = useState(false);

  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '1px 6px',
    borderRadius: 4,
    background: 'rgba(0, 0, 0, 0.55)',
    border: `1px solid ${color}`,
    color,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  };

  const dot = (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: color,
        flex: '0 0 auto',
      }}
    />
  );

  // Own span so it can shrink: the overlay corner is capped at 40% of the
  // viewport width (CustomizableViewportOverlay.css) and a flex child's
  // min-width defaults to its content, so a bare text node gets hard-
  // CLIPPED on narrow viewports instead of ellipsized. minWidth:0 +
  // ellipsis degrades to "CURRENT · JUN 1…" gracefully.
  const text = (
    <span
      ref={textRef}
      style={{
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );

  if (!onActivate) {
    return (
      <span
        data-cy="study-role-indicator"
        // Only a clipped pill claims pointer events, and only so its tooltip works.
        style={{ ...style, pointerEvents: truncated ? 'auto' : 'none' }}
        title={truncated ? label : undefined}
      >
        {dot}
        {text}
      </span>
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      data-cy="study-role-indicator"
      title={[label, title].filter(Boolean).join(' — ')}
      aria-haspopup="listbox"
      aria-expanded={expanded}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...style,
        font: 'inherit',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        // The overlay corner is pointer-events:none; opt this control back in.
        pointerEvents: 'auto',
        // Above the scroll minimap (z 20) / scout navigator (z 19): those insets
        // live in the same stacking context and the minimap's right-edge strip can
        // otherwise cover the caret end of the pill and swallow the click.
        position: 'relative',
        zIndex: 30,
        // Hover feedback, so "this pill is a control" is discoverable without
        // relying on the 9px caret alone.
        background: hovered ? 'rgba(0, 0, 0, 0.8)' : style.background,
        boxShadow: hovered ? `0 0 0 1px ${color}` : undefined,
      }}
      // Stop the press from reaching the cornerstone element beneath, which
      // would otherwise begin a WWWC / pan drag on the image.
      onMouseDown={event => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
    >
      {dot}
      {text}
      <span
        aria-hidden="true"
        style={{ flex: '0 0 auto', fontSize: 9, lineHeight: 1, opacity: 0.85 }}
      >
        ▾
      </span>
    </button>
  );
}

export default RoleTag;
