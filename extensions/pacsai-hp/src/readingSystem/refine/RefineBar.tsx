/**
 * RS-38, the refine tool's bar, at the top of the viewport the lesion was
 * marked on: what the refine is doing, SAM2CT's outline once it is back (with
 * the colours' key), and Keep / Discard / Try again. At the top, not the foot:
 * OHIF's investigational-use banner is fixed along the page's foot, above the
 * viewports, until the reader dismisses it.
 *
 * It sits inside the viewport, where OHIF wraps an inactive viewport in
 * pointer-events: none and acts on any pointer event that reaches the pane, so
 * the bar takes pointer events itself and keeps them (as the 3D cell does).
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { CURRENT_RGB, PREVIEW_RGB, describePreview, type RefineStore } from './refineStore';

const css = (rgb: [number, number, number]) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const keep = (e: React.SyntheticEvent) => e.stopPropagation();

export function RefineBar({
  store,
  now = () => Date.now(),
}: {
  store: RefineStore;
  now?: () => number;
}) {
  useSyncExternalStore(store.subscribe, store.version);
  const view = store.getView();
  const [, tick] = useState(0);
  const sending = view.phase === 'sending';
  useEffect(() => {
    if (!sending) {
      return undefined;
    }
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [sending]);

  if (view.phase === 'idle' || view.phase === 'drawing' || !view.message) {
    return null;
  }
  const seconds =
    sending && view.startedAt !== null
      ? Math.max(0, Math.floor((now() - view.startedAt) / 1000))
      : null;
  const busy = view.phase === 'sending' || view.phase === 'keeping';
  return (
    <div
      className="prs-refine-bar"
      data-rs-refine-bar={view.phase}
      data-level={view.message.level}
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={keep}
      onDoubleClick={keep}
      onWheel={keep}
    >
      <span
        className="prs-refine-text"
        role="status"
        aria-live="polite"
      >
        {view.preview && view.phase !== 'kept' ? (
          <>
            <span
              className="prs-refine-key"
              style={{ background: css(PREVIEW_RGB) }}
              aria-hidden="true"
            />
            {`SAM2CT’s outline: ${describePreview(view.preview)}. `}
            <span
              className="prs-refine-key"
              style={{ background: css(CURRENT_RGB) }}
              aria-hidden="true"
            />
            {view.target?.mask ? 'The current one.' : 'It has no outline yet.'}
            {view.preview.keep.possible
              ? ''
              : ` ${view.preview.keep.reason ?? 'It cannot be kept.'}`}
            {view.message.level !== 'info' && !view.message.text.startsWith('SAM2CT’s outline')
              ? ` ${view.message.text}`
              : ''}
          </>
        ) : (
          `${view.message.text}${seconds !== null ? ` ${seconds} s` : ''}`
        )}
      </span>
      {view.phase === 'preview' || view.phase === 'keeping' ? (
        <>
          {view.preview?.keep.possible ? (
            <button
              type="button"
              className="prs-btn"
              data-primary="true"
              disabled={busy}
              onClick={e => {
                e.stopPropagation();
                void store.keep();
              }}
            >
              Keep
            </button>
          ) : null}
          <button
            type="button"
            className="prs-btn"
            disabled={busy}
            onClick={e => {
              e.stopPropagation();
              store.discard();
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="prs-btn"
            disabled={busy || !view.canRetry}
            onClick={e => {
              e.stopPropagation();
              void store.retry();
            }}
          >
            Try again
          </button>
        </>
      ) : null}
      {view.phase === 'answered' ? (
        <>
          {view.canRetry ? (
            <button
              type="button"
              className="prs-btn"
              onClick={e => {
                e.stopPropagation();
                void store.retry();
              }}
            >
              Try again
            </button>
          ) : null}
          <button
            type="button"
            className="prs-btn"
            onClick={e => {
              e.stopPropagation();
              store.discard();
            }}
          >
            Close
          </button>
        </>
      ) : null}
    </div>
  );
}
