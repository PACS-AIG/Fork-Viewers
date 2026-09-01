import React from 'react';

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
 * drag on the image underneath.
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
        style={style}
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
      title={title}
      aria-haspopup="listbox"
      aria-expanded={expanded}
      style={{
        ...style,
        font: 'inherit',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        // The overlay corner is pointer-events:none; opt this control back in.
        pointerEvents: 'auto',
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
