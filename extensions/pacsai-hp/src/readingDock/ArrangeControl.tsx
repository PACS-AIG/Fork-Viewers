import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { currentArrange, takeArrangeFocusRequest } from '../arrange/arrangeHost';
import type { Arrange, ArrangeView } from '../arrange/arrangeSession';
import { DOCK_Z_INDEX } from './readingDock';
import { currentReadingDock, onReadingDockChange } from './session';

/**
 * Rev 11 milestone 7 (B31, N05): Arrange ▾ beside Images / Both / Report in the
 * reading window's header: one panel, two groups (docs/12 §3).
 *
 *   Images     the hanging in use; the protocols that match, All-in-one only
 *              and Manual; with or without the prior; the protocol's layouts.
 *   Workspace  Images / Both / Report, the report's width; Save this layout
 *              (the Saved default), Restore saved, a modality's own layout.
 *
 * Every choice shows at once and writes nothing; Use this case keeps it, and
 * Cancel, Escape or a click outside the panel puts back what was shown.
 * With the pointer nothing here takes the focus, so the report keeps its caret
 * (as the mode buttons do); from the keyboard the panel takes it, and gives it
 * back to Arrange when it closes.
 */

/** Above the dock's column and divider, below OHIF's own menus and dialogs (z-50). */
export const ARRANGE_Z_INDEX = DOCK_Z_INDEX + 5;

const BUTTON: React.CSSProperties = {
  boxSizing: 'border-box',
  height: 30,
  padding: '0 10px',
  border: '1px solid rgb(var(--pacs-border-strong))',
  borderRadius: 4,
  background: 'rgb(var(--pacs-panel-elev))',
  color: 'rgb(var(--pacs-text))',
  fontSize: 13,
  lineHeight: '28px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const CHOICE: React.CSSProperties = {
  ...BUTTON,
  height: 28,
  lineHeight: '26px',
  padding: '0 8px',
  fontSize: 12.5,
};

const PANEL: React.CSSProperties = {
  position: 'fixed',
  zIndex: ARRANGE_Z_INDEX,
  boxSizing: 'border-box',
  width: 420,
  maxWidth: 'calc(100vw - 16px)',
  maxHeight: 'calc(100vh - 64px)',
  overflowY: 'auto',
  padding: '10px 12px 12px',
  borderRadius: 6,
  border: '1px solid rgb(var(--pacs-border-strong))',
  background: 'rgb(var(--pacs-panel, 20 28 38))',
  color: 'rgb(var(--pacs-text))',
  boxShadow: '0 8px 24px rgba(0,0,0,.5)',
  fontSize: 13,
};

const HEADING: React.CSSProperties = {
  margin: '6px 0 6px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'rgb(var(--pacs-text-muted, 167 179 194))',
};

const LABEL: React.CSSProperties = {
  fontSize: 12,
  color: 'rgb(var(--pacs-text-muted, 167 179 194))',
  margin: '8px 0 4px',
};

const ROW: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4 };

/** One choice in a group: pressed when in use; never takes the focus from the pointer. */
function Choice({
  label,
  selected,
  disabled,
  title,
  onPick,
  data,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  title?: string;
  onPick: () => void;
  data: Record<string, string>;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      title={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onPick}
      {...data}
      style={{
        ...CHOICE,
        background: selected ? 'rgb(var(--pacs-accent, 49 215 255) / 0.18)' : CHOICE.background,
        fontWeight: selected ? 600 : 400,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function ArrangePanel({
  arrange,
  view,
  anchor,
  panelRef,
  onClose,
}: {
  arrange: Arrange;
  view: ArrangeView;
  anchor: DOMRect | null;
  panelRef: React.RefObject<HTMLDivElement>;
  onClose: (how: 'use' | 'cancel', byKeyboard: boolean) => void;
}) {
  const top = anchor ? Math.round(anchor.bottom + 6) : 56;
  // No anchor (opened from the gear menu): under the header, at its right end.
  const left = anchor
    ? Math.max(8, Math.min(Math.round(anchor.left), window.innerWidth - 8 - 420))
    : Math.max(8, window.innerWidth - 8 - 420);
  const ws = view.workspace;
  const imagesDisabled = view.settling;
  const changed = view.changed.images || view.changed.workspace;
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Arrange"
      data-cy="pacsai-arrange-panel"
      style={{ ...PANEL, top, left }}
    >
      <section
        aria-labelledby="pacsai-arrange-images"
        data-arrange-group="images"
      >
        <h3
          id="pacsai-arrange-images"
          style={HEADING}
        >
          Images
        </h3>
        <div
          data-arrange-summary=""
          style={{ fontSize: 13, marginBottom: 2 }}
        >
          {view.summary}
        </div>
        {view.settling && (
          <div
            data-arrange-settling=""
            style={{ ...LABEL, marginTop: 4 }}
          >
            Setting up the comparison…
          </div>
        )}
        {view.protocols.length > 0 && (
          <>
            <div
              id="pacsai-arrange-protocol"
              style={LABEL}
            >
              Hanging
            </div>
            <div
              role="radiogroup"
              aria-labelledby="pacsai-arrange-protocol"
              style={ROW}
            >
              {view.protocols.map(p => (
                <Choice
                  key={p.id}
                  label={p.label}
                  selected={p.selected}
                  disabled={imagesDisabled}
                  onPick={() => arrange.chooseProtocol(p.id)}
                  data={{ 'data-arrange-protocol': p.id }}
                />
              ))}
            </div>
          </>
        )}
        {view.prior.length > 0 && (
          <>
            <div
              id="pacsai-arrange-prior"
              style={LABEL}
            >
              Prior
            </div>
            <div
              role="radiogroup"
              aria-labelledby="pacsai-arrange-prior"
              style={ROW}
            >
              {view.prior.map(p => (
                <Choice
                  key={p.value}
                  label={p.label}
                  selected={p.selected}
                  disabled={imagesDisabled}
                  onPick={() => arrange.choosePrior(p.value)}
                  data={{ 'data-arrange-prior': p.value }}
                />
              ))}
            </div>
          </>
        )}
        {view.stages.length > 0 && (
          <>
            <div
              id="pacsai-arrange-layout"
              style={LABEL}
            >
              Layout
            </div>
            <div
              role="radiogroup"
              aria-labelledby="pacsai-arrange-layout"
              style={{ ...ROW, flexDirection: 'column', alignItems: 'stretch' }}
            >
              {view.stages.map(s => (
                <Choice
                  key={s.index}
                  label={s.label}
                  selected={s.selected}
                  disabled={imagesDisabled || !s.available}
                  onPick={() => arrange.chooseStage(s.index)}
                  data={{ 'data-arrange-stage': String(s.index) }}
                />
              ))}
            </div>
            {view.hiddenStages > 0 && (
              <div
                data-arrange-hidden-stages={String(view.hiddenStages)}
                style={{ ...LABEL, marginTop: 6 }}
              >
                {view.hiddenStages === 1
                  ? '1 more layout needs a series or prior this case lacks'
                  : `${view.hiddenStages} more layouts need series or priors this case lacks`}
              </div>
            )}
          </>
        )}
      </section>
      {ws && (
        <section
          aria-labelledby="pacsai-arrange-workspace"
          data-arrange-group="workspace"
          style={{
            borderTop: '1px solid rgb(var(--pacs-border-strong))',
            marginTop: 10,
            paddingTop: 4,
          }}
        >
          <h3
            id="pacsai-arrange-workspace"
            style={HEADING}
          >
            Workspace
          </h3>
          <div
            role="radiogroup"
            aria-label="Reading layout"
            style={ROW}
          >
            {ws.modes.map(m => (
              <Choice
                key={m.value}
                label={m.label}
                selected={m.selected}
                onPick={() => arrange.chooseMode(m.value)}
                data={{ 'data-arrange-mode': m.value }}
              />
            ))}
          </div>
          {ws.shares.length > 0 && (
            <>
              <div
                id="pacsai-arrange-width"
                style={LABEL}
              >
                Report width
              </div>
              <div
                role="radiogroup"
                aria-labelledby="pacsai-arrange-width"
                style={ROW}
              >
                {ws.shares.map(s => (
                  <Choice
                    key={s.value}
                    label={s.label}
                    selected={s.selected}
                    disabled={!s.available}
                    title={
                      s.available
                        ? undefined
                        : 'Too wide for this window: the images keep their floor'
                    }
                    onPick={() => arrange.chooseShare(s.value)}
                    data={{ 'data-arrange-share': String(s.value) }}
                  />
                ))}
              </div>
            </>
          )}
          {ws.layoutMenu && (
            <div style={{ ...ROW, marginTop: 8 }}>
              <button
                type="button"
                data-arrange-save=""
                title="Save the layout shown as your default for this display"
                onMouseDown={e => e.preventDefault()}
                onClick={() => arrange.saveLayout()}
                style={CHOICE}
              >
                Save this layout
              </button>
              <button
                type="button"
                data-arrange-restore=""
                title="Back to your saved default layout"
                onMouseDown={e => e.preventDefault()}
                onClick={() => arrange.restoreSaved()}
                style={CHOICE}
              >
                Restore saved
              </button>
              {ws.layoutMenu.modality && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={ws.layoutMenu.ownLayout}
                  data-arrange-own=""
                  title={`Give ${ws.layoutMenu.modality} cases a layout of their own on this display`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => arrange.setOwnLayout(!ws.layoutMenu?.ownLayout)}
                  style={CHOICE}
                >
                  {`Own layout for ${ws.layoutMenu.modality}: ${ws.layoutMenu.ownLayout ? 'on' : 'off'}`}
                </button>
              )}
            </div>
          )}
        </section>
      )}
      {view.note && (
        <div
          role="status"
          data-arrange-note=""
          style={{ ...LABEL, color: '#F5C36B' }}
        >
          {view.note}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 6,
          marginTop: 12,
          borderTop: '1px solid rgb(var(--pacs-border-strong))',
          paddingTop: 10,
        }}
      >
        <button
          type="button"
          data-arrange-cancel=""
          onMouseDown={e => e.preventDefault()}
          onClick={e => onClose('cancel', e.detail === 0)}
          style={BUTTON}
        >
          Cancel
        </button>
        <button
          type="button"
          data-arrange-use=""
          disabled={!changed}
          title={
            changed ? 'Keep these images for this case and this layout' : 'Nothing changed yet'
          }
          onMouseDown={e => e.preventDefault()}
          onClick={e => onClose('use', e.detail === 0)}
          style={{
            ...BUTTON,
            fontWeight: 600,
            opacity: changed ? 1 : 0.45,
            cursor: changed ? 'pointer' : 'not-allowed',
          }}
        >
          Use this case
        </button>
      </div>
    </div>
  );
}

/** Whether the window is too narrow for Both (the dock's one pane): Arrange's button gives way. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => currentReadingDock()?.getSnapshot().narrow === true);
  useEffect(() => {
    let offDock: () => void = () => undefined;
    const follow = () => {
      offDock();
      const dock = currentReadingDock();
      setNarrow(dock?.getSnapshot().narrow === true);
      offDock =
        dock?.subscribe(() => setNarrow(dock.getSnapshot().narrow === true)) ?? (() => undefined);
    };
    follow();
    const offChange = onReadingDockChange(follow);
    return () => {
      offDock();
      offChange();
    };
  }, []);
  return narrow;
}

export function ArrangeControl(): React.ReactElement | null {
  const [arrange] = useState(() => currentArrange());
  const [, setTick] = useState(0);
  useEffect(() => arrange.subscribe(() => setTick(t => t + 1)), [arrange]);
  const narrow = useNarrow();
  const open = arrange.isOpen();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const focusAfterOpen = useRef(false);

  const close = useCallback(
    (how: 'use' | 'cancel', byKeyboard: boolean) => {
      if (how === 'use') {
        arrange.useThisCase();
      } else {
        void arrange.cancel();
      }
      if (byKeyboard) {
        triggerRef.current?.focus();
      }
    },
    [arrange]
  );

  // The viewer's hanging changes under an open panel (a stage key, a late hang):
  // the panel shows what is on screen now.
  useEffect(() => {
    if (!open) {
      return;
    }
    const id = window.setInterval(() => setTick(t => t + 1), 500);
    return () => window.clearInterval(id);
  }, [open]);

  // A click anywhere outside the panel and its button is Cancel; so is Escape,
  // wherever the focus is (with the pointer the report keeps it).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (panelRef.current?.contains(t) || triggerRef.current?.contains(t))) {
        return;
      }
      void arrange.cancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const inPanel = !!panelRef.current?.contains(document.activeElement);
      close('cancel', inPanel || document.activeElement === triggerRef.current);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, arrange, close]);

  useLayoutEffect(() => {
    if (open && focusAfterOpen.current) {
      focusAfterOpen.current = false;
      const first = panelRef.current?.querySelector<HTMLElement>('button:not([disabled])');
      first?.focus();
    }
  }, [open]);

  // Opened from the gear menu (a narrow window): the panel takes the focus once
  // the menu has closed and handed it back to its trigger.
  useEffect(() => {
    if (!open || !takeArrangeFocusRequest()) {
      return;
    }
    const id = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    }, 150);
    return () => window.clearTimeout(id);
  }, [open]);

  const toggle = (byKeyboard: boolean) => {
    if (open) {
      close('cancel', byKeyboard);
      return;
    }
    setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
    focusAfterOpen.current = byKeyboard;
    arrange.open();
  };

  const view = open ? arrange.view() : null;
  const panel =
    open && view
      ? createPortal(
          <ArrangePanel
            arrange={arrange}
            view={view}
            anchor={narrow ? null : anchor}
            panelRef={panelRef}
            onClose={close}
          />,
          document.body
        )
      : null;
  // A window too narrow for Both: the button gives way to the image tools (the
  // gear menu's "Arrange…" opens the panel, as the session switcher gives way).
  if (narrow) {
    return panel;
  }
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-cy="pacsai-arrange"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Arrange: the images' hanging and the workspace layout"
        onMouseDown={e => e.preventDefault()}
        // A click from the keyboard (Enter or Space) has no pointer detail.
        onClick={e => toggle(e.detail === 0)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            toggle(true);
          }
        }}
        style={{
          ...BUTTON,
          marginLeft: 6,
          background: open ? 'rgb(var(--pacs-accent, 49 215 255) / 0.18)' : BUTTON.background,
        }}
      >
        Arrange ▾
      </button>
      {panel}
    </>
  );
}

export default ArrangeControl;
