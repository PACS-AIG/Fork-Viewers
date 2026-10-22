import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { READING_MODES, micLine } from './dockModel';
import { currentReadingDock, onReadingDockChange } from './session';
import type { ReadingDock, ReadingDockSnapshot } from './readingDock';

/**
 * Rev 11 milestone 6, approach C, phase 1: the reading dock's controls in the
 * viewer's header (radcopilot's 'secondary' toolbar section): Images / Both /
 * Report, and, while the report is hidden, its microphone (indicator, toggle,
 * where the words go) and the notices it sent. They render nothing when the
 * document has no dock (READING_DOCK off, or another mode).
 */

const noSubscribe = () => () => undefined;
const noSnapshot = (): ReadingDockSnapshot | null => null;

function useReadingDock(): { dock: ReadingDock | null; snap: ReadingDockSnapshot | null } {
  const [dock, setDock] = useState<ReadingDock | null>(() => currentReadingDock());
  useEffect(() => {
    setDock(currentReadingDock());
    return onReadingDockChange(() => setDock(currentReadingDock()));
  }, []);
  const snap = useSyncExternalStore(
    dock ? dock.subscribe : noSubscribe,
    dock ? dock.getSnapshot : noSnapshot
  );
  return { dock, snap: snap && snap.phase !== 'gone' ? snap : null };
}

const SEGMENT: React.CSSProperties = {
  boxSizing: 'border-box',
  height: 30,
  padding: '0 12px',
  border: '1px solid rgb(var(--pacs-border-strong))',
  background: 'rgb(var(--pacs-panel-elev))',
  color: 'rgb(var(--pacs-text))',
  fontSize: 13,
  lineHeight: '28px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** Off screen but still read: the microphone's line in a narrow window stays in its live region. */
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

export function ReadingModeControl(): React.ReactElement | null {
  const { dock, snap } = useReadingDock();
  if (!dock || !snap) {
    return null;
  }
  const imagesRefused = snap.phase === 'mounted' && snap.dictation === null;
  const note = snap.imagesHeld
    ? 'Images once the report has said whether it is dictating'
    : !snap.fits
      ? 'Too narrow for Both: one pane'
      : null;
  return (
    <div
      role="group"
      aria-label="Reading layout"
      data-cy="pacsai-reading-modes"
      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32 }}
    >
      <div style={{ display: 'flex' }}>
        {READING_MODES.map((m, i) => {
          const pressed = snap.requested === m.value;
          const disabled = m.value === 'images' && imagesRefused;
          return (
            <button
              key={m.value}
              type="button"
              data-reading-mode={m.value}
              aria-pressed={pressed}
              disabled={disabled}
              title={
                disabled
                  ? 'Images waits until the report has said whether it is dictating'
                  : `${m.label} (${m.keys[0].replace('alt+', 'Alt+')})`
              }
              // A press does not move focus: the report keeps its caret up to the switch.
              onMouseDown={e => e.preventDefault()}
              onClick={() => dock.setMode(m.value)}
              style={{
                ...SEGMENT,
                borderRadius: i === 0 ? '4px 0 0 4px' : i === READING_MODES.length - 1 ? '0 4px 4px 0' : 0,
                marginLeft: i === 0 ? 0 : -1,
                background: pressed ? 'rgb(var(--pacs-accent, 49 215 255) / 0.18)' : SEGMENT.background,
                fontWeight: pressed ? 600 : 400,
                opacity: disabled ? 0.45 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {note && (
        <span
          data-reading-mode-note=""
          style={{ fontSize: 12, color: 'rgb(var(--pacs-text-muted, 167 179 194))', whiteSpace: 'nowrap' }}
        >
          {note}
        </span>
      )}
    </div>
  );
}

function MicGlyph({ on }: { on: boolean }): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-2.07A7 7 0 0 0 19 12h-2z"
        fill="currentColor"
      />
      {!on && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}

export function ReadingMicLine(): React.ReactElement | null {
  const { dock, snap } = useReadingDock();
  if (!dock || !snap || snap.phase !== 'mounted' || snap.mode !== 'images') {
    return null;
  }
  const d = snap.dictation;
  const started = !!d?.started;
  const line = micLine(d);
  return (
    <div
      data-cy="pacsai-reading-mic"
      role="status"
      aria-live="polite"
      style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, marginLeft: 8 }}
    >
      <button
        type="button"
        data-reading-mic={started ? 'on' : 'off'}
        aria-pressed={started}
        aria-label={started ? 'Stop dictation into the report' : 'Start dictation into the report'}
        // The line, in a narrow window (see below).
        title={snap.narrow ? line : undefined}
        disabled={!d || !d.available || d.busy}
        onMouseDown={e => e.preventDefault()}
        onClick={() => dock.toggleDictation()}
        style={{
          ...SEGMENT,
          padding: '0 8px',
          borderRadius: 15,
          display: 'flex',
          alignItems: 'center',
          color: started ? '#0D1218' : 'rgb(var(--pacs-text))',
          background: started ? '#8FD7B2' : SEGMENT.background,
          opacity: !d || !d.available ? 0.45 : 1,
        }}
      >
        <MicGlyph on={started} />
      </button>
      {/* 22 Oct: a window too narrow for Both (200 % zoom among them) keeps the
          toggle and the notices; the line moves to the toggle's title, still
          read out here, and its width goes to the image tools, which at 200 %
          had none left once the microphone joined the header's row. */}
      <span
        data-reading-mic-line=""
        style={
          snap.narrow
            ? VISUALLY_HIDDEN
            : { fontSize: 13, whiteSpace: 'nowrap', color: 'rgb(var(--pacs-text))' }
        }
      >
        {line}
      </span>
      {snap.notices.map(n => (
        <span
          key={n.code}
          data-reading-notice={n.code}
          style={{
            fontSize: 12,
            whiteSpace: 'nowrap',
            padding: '2px 8px',
            borderRadius: 10,
            background: n.level === 'error' ? '#33191E' : '#2E2413',
            color: n.level === 'error' ? '#FFADB6' : '#F5C36B',
          }}
        >
          {n.text}
        </span>
      ))}
    </div>
  );
}

/**
 * 22 Oct: the controls as the section's one item, in one row: the layout's
 * buttons, then, while the report is hidden, its microphone beside them.
 * OHIF's Toolbar draws each item of a section in a block of its own, so as
 * two items the microphone stacked under the buttons, below the header's row
 * and over the top of the images.
 */
export function ReadingControls(): React.ReactElement | null {
  const { dock, snap } = useReadingDock();
  if (!dock || !snap) {
    return null;
  }
  return (
    <div
      data-cy="pacsai-reading-controls"
      style={{ display: 'flex', alignItems: 'center', height: 32 }}
    >
      <ReadingModeControl />
      <ReadingMicLine />
    </div>
  );
}
