import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  getAvailablePriors,
  getPriorUIDs,
  subscribeAvailablePriors,
  type PriorOption,
} from '../priors/roleRegistry';
import { requestPriorSwitch } from '../priors/selectPrior';
import { formatInterval, formatStudyDateTime } from './formatStudyDateTime';
import RoleTag from './RoleTag';

/**
 * The PRIOR pill, made interactive: click the date and pick a different prior
 * from the patient's history — the protocol re-hangs (every stage, including the
 * all-in-one pane) against the chosen study.
 *
 * Why it exists: `loadRelevantPriors` auto-picks ONE prior by policy
 * (same-body > same-modality > most-recent > score). That is right most of the
 * time and wrong exactly when the rad knows something the metadata doesn't — the
 * relevant comparison is the pre-treatment exam from two years ago, not
 * last month's. Before this, overriding meant leaving the viewer.
 *
 * Behaviour notes:
 *  - Lists EVERY earlier out-of-session study the patient query returned, with
 *    the policy-qualifying ones first (dimmed rows scored below `minScore`) —
 *    see `PriorOption`. Cross-modality picks are allowed and labelled: the
 *    protocol's prior selectors may not match an unrelated modality, in which
 *    case the pane hangs empty and the rad picks again.
 *  - Falls back to the plain static pill when there is nothing to switch TO, so
 *    a single-prior patient gets no misleading affordance.
 *  - On a multi-prior hang (whole-spine, one prior per region) only same-region
 *    candidates are offered: the per-region selectors match on region, so an
 *    off-region prior would hang an empty pane.
 *  - The menu is PORTALLED to <body>: the overlay corner is capped at 40% width
 *    with `overflow: hidden` on its spans (CustomizableViewportOverlay.css), so
 *    an in-place dropdown would be clipped to a sliver.
 */

const MENU_MAX_HEIGHT = 320;
const MENU_WIDTH = 300;

type Placement = { top?: number; bottom?: number; right: number };

function optionLabel(
  option: PriorOption,
  currentDate: unknown,
  formatDate?: (value: unknown) => string
): { primary: string; secondary: string } {
  const stamp = formatStudyDateTime(option, formatDate) || option.StudyDate || 'Unknown date';
  const interval = formatInterval(currentDate, option.StudyDate);
  const primary = [stamp, option.modality, interval].filter(Boolean).join(' · ');
  return { primary, secondary: option.StudyDescription ?? '' };
}

export function PriorSwitcher({
  color,
  label,
  priorUID,
  currentDate,
  formatDate,
}: {
  color: string;
  label: string;
  /** The study currently hung in THIS pane. */
  priorUID?: string;
  /** Raw StudyDate of the current (report-target) study, for the interval column. */
  currentDate?: string;
  formatDate?: (value: unknown) => string;
}) {
  // Re-render when the candidate list or the hung prior changes (a switch elsewhere,
  // a fresh study open).
  const [, forceRender] = useReducer(x => x + 1, 0);
  useEffect(() => subscribeAvailablePriors(forceRender), []);

  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const hungPriors = getPriorUIDs();
  const allOptions = getAvailablePriors();

  // A whole-spine hang has one prior per region; only offer same-region swaps.
  const thisRegion = allOptions.find(o => o.uid === priorUID)?.bodyPart;
  const options =
    hungPriors.length > 1 && thisRegion
      ? allOptions.filter(o => o.bodyPart === thisRegion)
      : allOptions;

  // Nothing to switch to = no affordance. (The hung prior itself is in the list.)
  const switchable = options.some(o => o.uid !== priorUID);

  const reposition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const right = Math.max(4, window.innerWidth - rect.right);
    const spaceBelow = window.innerHeight - rect.bottom;
    setPlacement(
      spaceBelow < 160 && rect.top > spaceBelow
        ? { bottom: window.innerHeight - rect.top + 4, right }
        : { top: rect.bottom + 4, right }
    );
  }, []);

  useLayoutEffect(() => {
    if (open) {
      reposition();
    }
  }, [open, reposition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        close();
      }
    };
    // Capture phase: the viewport swallows plain mousedown for its tools.
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', close);
    // A scroll anywhere (side panel, worklist) invalidates the anchor rect.
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const choose = (uid: string) => {
    setOpen(false);
    if (uid === priorUID) {
      return;
    }
    requestPriorSwitch({ studyInstanceUID: uid, replaceUID: priorUID });
  };

  const tag = (
    <RoleTag
      color={color}
      label={label}
      buttonRef={switchable ? buttonRef : undefined}
      expanded={switchable ? open : undefined}
      title={switchable ? 'Click to compare against a different prior' : undefined}
      onActivate={switchable ? () => setOpen(o => !o) : undefined}
    />
  );

  if (!switchable || !open || !placement) {
    return tag;
  }

  const menu = (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Comparison prior"
      data-cy="prior-switcher-menu"
      style={{
        position: 'fixed',
        top: placement.top,
        bottom: placement.bottom,
        right: placement.right,
        width: MENU_WIDTH,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: MENU_MAX_HEIGHT,
        overflowY: 'auto',
        zIndex: 9999,
        background: 'rgba(10, 15, 22, 0.97)',
        border: `1px solid ${color}`,
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
        padding: 4,
        pointerEvents: 'auto',
        textAlign: 'left',
      }}
      onMouseDown={event => event.stopPropagation()}
    >
      <div
        style={{
          padding: '4px 8px 6px',
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#8EA4B8',
        }}
      >
        Compare against
      </div>
      {options.map(option => {
        const { primary, secondary } = optionLabel(option, currentDate, formatDate);
        const isHung = option.uid === priorUID;
        return (
          <button
            key={option.uid}
            type="button"
            role="option"
            aria-selected={isHung}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              choose(option.uid);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '5px 8px',
              borderRadius: 4,
              border: 'none',
              background: isHung ? 'rgba(255, 255, 255, 0.10)' : 'transparent',
              color: '#E8EEF4',
              font: 'inherit',
              fontSize: 12,
              cursor: 'pointer',
              // Below-threshold candidates stay pickable but read as secondary.
              opacity: option.qualifying ? 1 : 0.62,
            }}
            onMouseEnter={event => {
              event.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)';
            }}
            onMouseLeave={event => {
              event.currentTarget.style.background = isHung
                ? 'rgba(255, 255, 255, 0.10)'
                : 'transparent';
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, flex: '0 0 auto', color }}>{isHung ? '✓' : ''}</span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{primary}</span>
            </span>
            {secondary ? (
              <span
                style={{
                  display: 'block',
                  paddingLeft: 16,
                  color: '#9FB3C4',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={secondary}
              >
                {secondary}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {tag}
      {createPortal(menu, document.body)}
    </>
  );
}

export default PriorSwitcher;
