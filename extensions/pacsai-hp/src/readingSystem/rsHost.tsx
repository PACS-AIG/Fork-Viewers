/**
 * RS-36: the reading-system pane in the reading dock's report column.
 *
 * The pane is the column's first child, at its top, and the dock's island and
 * cover start below it (the dock's setReadingSystemInset). The island itself
 * is not changed, and neither are the dock's layout rules: the column keeps
 * its width and place, and only the height inside it is shared.
 *
 *   - Folded, the pane is its one-line bar; open, it takes PANE_SHARE of the
 *     column's height, leaving the island at least ISLAND_MIN_PX.
 *   - A study the reading system does not serve gives the pane no height at
 *     all, so the island has the whole column as before.
 *   - K, anywhere outside a text field and outside the report editor, opens or
 *     closes the Copilot on the selected sentence; Escape closes it. Both are
 *     taken on the window first (capture), as the dock takes F4, so the
 *     viewer's own hotkeys never see them twice.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AnatomyStore } from './anatomy/anatomyStore';
import type { RsController, RsSnapshot } from './rsController';
import { RsPane } from './RsPane';

export const BAR_PX = 36;
export const PANE_SHARE = 0.45;
export const PANE_MIN_PX = 200;
export const ISLAND_MIN_PX = 200;
/** The Copilot's one key (no modifier), as `KeyboardEvent.key` gives it either case. */
export const COPILOT_KEYS = ['k', 'K'];

/** The pane's height for this state in a column this tall (pure). */
export function paneHeightPx(
  snap: Pick<RsSnapshot, 'phase' | 'collapsed'>,
  columnPx: number
): number {
  if (snap.phase === 'idle' || snap.phase === 'not_served') {
    return 0;
  }
  if (snap.collapsed || snap.phase !== 'ready') {
    return BAR_PX;
  }
  const want = Math.round(columnPx * PANE_SHARE);
  const most = Math.max(BAR_PX, columnPx - ISLAND_MIN_PX);
  return Math.max(BAR_PX, Math.min(most, Math.max(PANE_MIN_PX, want)));
}

/** A text field, an editable region or a select: where K is typing, not a command. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== 'object' || !('tagName' in el)) {
    return false;
  }
  const tag = String(el.tagName).toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  return Boolean(el.closest?.('[contenteditable=""], [contenteditable="true"]'));
}

/** Inside the report editor (the island) or one of its popovers. */
export function inReportEditor(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || typeof (el as Element).closest !== 'function') {
    return false;
  }
  return Boolean(
    el.closest('[data-pacsai-reading-island]') || el.closest('[data-pacs-island-portal-host]')
  );
}

export interface RsHost {
  readonly column: HTMLElement;
  /** The pane's element, while it is mounted. */
  readonly element: HTMLElement;
  /** Fit the pane to the column again (a resize). */
  layout(): void;
  destroy(): void;
}

export function createRsHost({
  win,
  column,
  controller,
  anatomy = null,
  setInset,
}: {
  win: Window;
  column: HTMLElement;
  controller: RsController;
  /** The study's anatomy layers (the Anatomy tab), when the reading system serves them. */
  anatomy?: AnatomyStore | null;
  /** The dock's: the island and its cover start this far below the column's top. */
  setInset: (px: number) => void;
}): RsHost {
  const doc = win.document;
  const pane = doc.createElement('div');
  pane.setAttribute('data-pacsai-rs-pane', '');
  pane.setAttribute('role', 'region');
  pane.setAttribute('aria-label', 'CT analysis');
  Object.assign(pane.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    height: '0px',
    display: 'none',
    zIndex: '2',
    overflow: 'hidden',
  });
  column.prepend(pane);
  const root: Root = createRoot(pane);
  root.render(
    <RsPane
      controller={controller}
      doc={doc}
      anatomy={anatomy}
    />
  );

  let lastPx = -1;
  const layout = () => {
    const px = paneHeightPx(controller.getSnapshot(), column.getBoundingClientRect().height);
    if (px !== lastPx) {
      lastPx = px;
      pane.style.height = `${px}px`;
      pane.style.display = px === 0 ? 'none' : 'block';
      setInset(px);
    }
  };
  const offState = controller.subscribe(layout);
  layout();
  let observer: ResizeObserver | null = null;
  const RO = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  if (typeof RO === 'function') {
    observer = new RO(() => layout());
    observer.observe(column);
  }
  win.addEventListener('resize', layout);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const snap = controller.getSnapshot();
    if (snap.phase !== 'ready' || !column.isConnected) {
      return;
    }
    if (e.key === 'Escape' && snap.copilotOpen) {
      if (isTyping(e.target) && !pane.contains(e.target as Node)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      controller.closeCopilot();
      return;
    }
    if (!COPILOT_KEYS.includes(e.key) || e.repeat) {
      return;
    }
    if (isTyping(e.target) || inReportEditor(e.target)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    controller.toggleCopilot();
  };
  win.addEventListener('keydown', onKeyDown, true);

  return {
    column,
    element: pane,
    layout,
    destroy() {
      offState();
      observer?.disconnect();
      win.removeEventListener('resize', layout);
      win.removeEventListener('keydown', onKeyDown, true);
      try {
        root.unmount();
      } catch (_) {
        /* the page is going on without it */
      }
      pane.remove();
      setInset(0);
    },
  };
}
