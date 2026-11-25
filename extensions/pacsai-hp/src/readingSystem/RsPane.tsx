/**
 * RS-36: the reading-system pane, in the top of the reading dock's report
 * column, above the report editor (the island), which keeps the rest of the
 * column. WeiWei, 20 Nov 2026: "Inside report column".
 *
 * A bar that is always there (the pane collapses to it): CT analysis, the
 * published draft's revision, the inbox and change counts, the Copilot's key.
 * Open, the pane shows the chrome lines and three tabs, four with anatomy:
 *   - Anatomy (when the study's anatomy is published, and then first, and
 *     shown at the study's opening): TotalSegmentator's structures drawn over
 *     the images, with their switches, opacity and volumes
 *     (anatomy/AnatomyTab); the bar's Anatomy button turns the layers on and
 *     off from anywhere;
 *   - Draft: the published report; a click on a sentence selects it and opens
 *     nothing; Enter (or K anywhere outside a text field) opens the Copilot on
 *     the selected finding; the arrow keys move the selection;
 *   - Inbox: each material change with its claims, its exact consequence
 *     preview and any patch of the reader's own wording; Accept / Reject;
 *   - Changes: the published draft against the latest evidence, and the
 *     draft's revisions with Undo;
 *   - PathGrade (research): PathGrade's showcase on public kidney tumours,
 *     never this patient (pathgrade/PathGradeTab), read when first opened.
 * The Copilot is a card over the tabs (Escape or its Close button closes it).
 *
 * Rendered with its own React root, outside OHIF's tree, like the dock it sits
 * in: the viewer's route changes and its study-not-found page leave it alone.
 */
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { AnatomyTab } from './anatomy/AnatomyTab';
import type { AnatomySnapshot, AnatomyStore } from './anatomy/anatomyStore';
import { PathGradeTab } from './pathgrade/PathGradeTab';
import type { ShowcaseStore } from './pathgrade/showcaseStore';
import type { RsController, RsSnapshot, RsTab } from './rsController';
import {
  changeListView,
  chromeLines,
  copilotView,
  draftView,
  inboxView,
  revisionsView,
  type ChangeLine,
} from './rsModel';

export const COPILOT_KEY_LABEL = 'K';

const STYLE_ID = 'pacsai-rs-style';
const CSS = `
.prs-root { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; background: #0A111B; color: #E8EEF5; font: 13px/18px system-ui, -apple-system, "Segoe UI", sans-serif; border-bottom: 1px solid #1B2735; }
.prs-root * { box-sizing: border-box; }
.prs-bar { flex: 0 0 36px; display: flex; align-items: center; gap: 10px; padding: 0 10px; min-width: 0; border-bottom: 1px solid #1B2735; }
.prs-bar button { font: inherit; }
.prs-title { display: inline-flex; align-items: center; gap: 6px; padding: 2px 6px; border: 0; border-radius: 4px; background: transparent; color: #E8EEF5; font-weight: 600; cursor: pointer; white-space: nowrap; }
.prs-title:hover, .prs-title:focus-visible { background: #15202D; outline: none; }
.prs-meta { color: #9AA8B8; white-space: nowrap; }
.prs-count { white-space: nowrap; color: #9AA8B8; }
.prs-count[data-live="true"] { color: #F5C36B; font-weight: 600; }
.prs-spacer { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9AA8B8; }
.prs-btn { padding: 3px 10px; border-radius: 6px; border: 1px solid #2B3A4D; background: #101A26; color: #E8EEF5; cursor: pointer; white-space: nowrap; }
.prs-btn:hover:not(:disabled), .prs-btn:focus-visible { border-color: #8AB4F8; outline: none; }
.prs-btn:disabled { opacity: 0.5; cursor: default; }
.prs-btn[data-primary="true"] { border-color: #8AB4F8; color: #8AB4F8; }
.prs-body { position: relative; flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.prs-chrome { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 6px 12px 0; }
.prs-chrome span[data-tone="pending"] { color: #8AB4F8; }
.prs-chrome span[data-tone="warn"] { color: #F5C36B; }
.prs-chrome span[data-tone="muted"] { color: #9AA8B8; }
.prs-tabs { flex: 0 0 auto; display: flex; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid #1B2735; }
.prs-tab { padding: 4px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #9AA8B8; cursor: pointer; font: inherit; }
.prs-tab[aria-selected="true"] { color: #E8EEF5; border-bottom-color: #8AB4F8; }
.prs-tab:focus-visible { outline: 1px solid #8AB4F8; }
.prs-panel { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 12px 12px; }
.prs-section { margin: 0 0 8px; }
.prs-section h4 { margin: 6px 0 2px; font-size: 11px; line-height: 16px; letter-spacing: 0.06em; text-transform: uppercase; color: #7F8EA0; }
.prs-passage { display: block; width: 100%; text-align: left; margin: 0; padding: 3px 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: inherit; font: inherit; }
.prs-passage[data-selectable="true"] { cursor: pointer; }
.prs-passage[data-selectable="true"]:hover { background: #111C29; }
.prs-passage:focus-visible { outline: none; border-color: #3C5675; }
.prs-passage[aria-selected="true"] { background: #15263A; border-color: #8AB4F8; }
.prs-passage[data-owner="clinician"]::after { content: "your wording"; margin-left: 8px; font-size: 11px; color: #7F8EA0; }
.prs-empty { color: #7F8EA0; padding: 3px 6px; }
.prs-card { border: 1px solid #1F2C3B; border-radius: 6px; padding: 8px 10px; margin: 0 0 8px; background: #0D1620; }
.prs-card h5 { margin: 0 0 4px; font-size: 13px; }
.prs-kind { font-size: 11px; color: #7F8EA0; text-transform: uppercase; letter-spacing: 0.06em; }
.prs-list { margin: 4px 0; padding-left: 18px; }
.prs-change { margin: 4px 0; }
.prs-before { color: #C9A3A3; text-decoration: line-through; }
.prs-after { color: #B9E3C6; }
.prs-actions { display: flex; gap: 8px; margin-top: 6px; align-items: center; }
.prs-reason { color: #F5C36B; }
.prs-notice { flex: 0 0 auto; display: flex; gap: 8px; align-items: center; padding: 6px 12px; border-top: 1px solid #1B2735; }
.prs-notice[data-level="warn"] { color: #F5C36B; }
.prs-notice[data-level="error"] { color: #F28B82; }
.prs-copilot { position: absolute; inset: 0; overflow: auto; padding: 10px 12px; background: #0D1620; border-top: 1px solid #2B3A4D; }
.prs-copilot header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.prs-copilot header h4 { margin: 0; font-size: 13px; flex: 1 1 auto; }
.prs-copilot dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 4px 0 8px; }
.prs-copilot dt { color: #7F8EA0; }
.prs-copilot dd { margin: 0; }
.prs-copilot h5 { margin: 8px 0 2px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #7F8EA0; }
.prs-btn[aria-pressed="true"] { border-color: #8AB4F8; color: #8AB4F8; }
.prs-anatomy-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 2px 0 8px; margin-bottom: 6px; border-bottom: 1px solid #1B2735; }
.prs-anatomy-controls label { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.prs-opacity input[type="range"] { width: 96px; height: 14px; accent-color: #8AB4F8; color-scheme: dark; }
.prs-seg { display: inline-flex; border: 1px solid #2B3A4D; border-radius: 6px; overflow: hidden; }
.prs-seg button { padding: 2px 10px; border: 0; background: #101A26; color: #9AA8B8; font: inherit; cursor: pointer; }
.prs-seg button[aria-pressed="true"] { background: #15263A; color: #E8EEF5; }
.prs-seg button:disabled { opacity: 0.5; cursor: default; }
.prs-anatomy-desc { margin: 2px 0 4px; font-size: 12px; color: #7F8EA0; }
.prs-anatomy-resampled { margin: 0 0 6px; font-size: 11px; line-height: 15px; color: #7F8EA0; }
.prs-anatomy-task { margin: 4px 0 8px; }
.prs-anatomy-task header { display: flex; align-items: center; gap: 6px; }
.prs-anatomy-task header label { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.prs-fold { width: 18px; padding: 0; border: 0; background: transparent; color: #9AA8B8; cursor: pointer; font: inherit; }
.prs-structures { width: calc(100% - 18px); margin: 2px 0 0 18px; border-collapse: collapse; }
.prs-structures td { padding: 1px 4px; vertical-align: middle; }
.prs-structures tr:hover { background: #111C29; }
.prs-structures tr[aria-selected="true"] { background: #15263A; }
.prs-structures tr[data-hidden="true"] .prs-structure, .prs-structures tr[data-hidden="true"] .prs-num { color: #6B7A8C; }
.prs-cell-check, .prs-cell-swatch { width: 1%; }
.prs-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.25); vertical-align: middle; }
.prs-structure { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.prs-structure:hover:not(:disabled), .prs-structure:focus-visible { color: #8AB4F8; text-decoration: underline; outline: none; }
.prs-structure:disabled { cursor: default; }
.prs-num { text-align: right; white-space: nowrap; color: #9AA8B8; font-variant-numeric: tabular-nums; }
.prs-structures th { padding: 0 4px 2px; font-size: 11px; font-weight: 400; letter-spacing: 0.04em; text-transform: uppercase; color: #6B7A8C; }
.prs-th-sub { display: block; font-size: 10px; letter-spacing: 0.02em; text-transform: none; color: #5D6B7C; }
.prs-num[data-out-of-band="true"] { color: #F5C36B; }
.prs-flag { display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 8px; background: #3A2E12; color: #F5C36B; font-size: 11px; line-height: 16px; font-weight: 700; cursor: help; }
.prs-structure-warnings td { padding: 0 4px 3px; font-size: 12px; line-height: 16px; color: #F5C36B; }
.prs-research-toggle { margin-left: 6px; padding: 0 6px; border: 1px solid #4B3F72; border-radius: 8px; background: transparent; color: #B7A8F0; font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
.prs-research-toggle[aria-expanded="true"] { background: #231C3D; }
.prs-research { margin: 2px 0 6px 18px; padding: 6px 8px; border: 1px dashed #4B3F72; border-radius: 6px; background: #120F1F; }
.prs-research-head { font-weight: 600; color: #D8D0FA; }
.prs-research-banner { margin: 2px 0 6px; font-size: 12px; color: #F5C36B; }
.prs-research-reason { font-size: 12px; color: #9AA8B8; }
.prs-research summary { cursor: pointer; color: #B7A8F0; font-size: 12px; }
.prs-research-grid { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 0 10px; margin: 2px 0 4px 12px; font-size: 12px; }
.prs-research-grid dt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9AA8B8; }
.prs-research-grid dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.prs-anatomy-notes { margin: 6px 0; padding-left: 18px; color: #F5C36B; }
.prs-anatomy-foot { margin-top: 8px; font-size: 11px; color: #6B7A8C; }
.prs-pathgrade { max-width: 1320px; }
.prs-pg-banner { margin: 2px 0 4px; padding: 6px 8px; border: 1px dashed #4B3F72; border-radius: 6px; background: #120F1F; color: #F5C36B; }
.prs-pg-credit { font-size: 11px; color: #9AA8B8; }
.prs-pg-title { margin: 10px 0 2px; font-size: 14px; font-weight: 600; color: #D8D0FA; }
.prs-pg-section { margin: 10px 0 0; }
.prs-pg-section h4 { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #E8EEF5; }
.prs-pg-quiet { margin: 2px 0; color: #9AA8B8; }
.prs-pg-strips { margin: 2px 0; padding-left: 18px; }
.prs-pg-finding { margin-right: 6px; color: #B7A8F0; }
.prs-pg-text p { margin: 0 0 6px; }
.prs-pg-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 1px 12px; margin: 2px 0 8px; }
.prs-pg-facts dt { color: #9AA8B8; }
.prs-pg-facts dd { margin: 0; font-variant-numeric: tabular-nums; }
.prs-pg-tablewrap { overflow-x: auto; margin: 2px 0 8px; }
.prs-pg-table { border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
.prs-pg-table caption { caption-side: top; text-align: left; padding-bottom: 2px; color: #9AA8B8; }
.prs-pg-table th, .prs-pg-table td { padding: 2px 8px; border-bottom: 1px solid #1B2735; text-align: left; white-space: nowrap; }
.prs-pg-table th { color: #9AA8B8; font-weight: 600; }
.prs-pg-figure { margin: 2px 0 10px; }
.prs-pg-row { display: flex; flex-wrap: wrap; gap: 8px; }
.prs-pg-panel { flex: 1 1 160px; max-width: 420px; min-width: 0; margin: 0; }
.prs-pg-panel figcaption, .prs-pg-figcaption, .prs-pg-larger-caption { margin-top: 2px; font-size: 11px; line-height: 15px; color: #9AA8B8; }
.prs-pg-picture { display: block; width: 100%; padding: 0; border: 1px solid #2B3A4D; border-radius: 4px; background: #000; cursor: zoom-in; }
.prs-pg-picture img, .prs-pg-larger img { display: block; width: 100%; height: auto; }
.prs-pg-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; padding: 6px; border: 1px dashed #2B3A4D; border-radius: 4px; color: #7F8EA0; font-size: 11px; text-align: center; }
.prs-pg-larger { margin: 8px 0 0; padding: 6px; border: 1px solid #4B3F72; border-radius: 6px; background: #05090F; }
.prs-pg-larger .prs-btn { margin-top: 6px; }
.prs-pg-sources { margin-top: 10px; font-size: 11px; color: #7F8EA0; }
.prs-pg-sources summary { cursor: pointer; }
.prs-pg-sources ul { margin: 2px 0; padding-left: 18px; }
`;

function useInjectedStyle(doc: Document | undefined): void {
  useEffect(() => {
    if (!doc || doc.getElementById(STYLE_ID)) {
      return;
    }
    const el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    doc.head.appendChild(el);
  }, [doc]);
}

const TABS: Array<{ id: RsTab; label: string }> = [
  { id: 'draft', label: 'Draft' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'changes', label: 'Changes' },
];
const ANATOMY_TAB: { id: RsTab; label: string } = { id: 'anatomy', label: 'Anatomy' };
const PATHGRADE_TAB: { id: RsTab; label: string } = {
  id: 'pathgrade',
  label: 'PathGrade (research)',
};

// A pane without an anatomy store: no Anatomy tab.
const NO_ANATOMY: AnatomySnapshot = {
  phase: 'idle',
  reason: null,
  series: [],
  structures: {},
  settings: { enabled: false, opacity: 0.35, style: 'fill' },
  selected: null,
  hovered: null,
  notes: [],
  revision: 0,
};
const noAnatomy = () => NO_ANATOMY;
const noSubscribe = () => () => {};

/** The Anatomy tab is there once the study's anatomy is read (or its read refused, to say why). */
export const anatomyTabShown = (phase: AnatomySnapshot['phase']): boolean =>
  phase === 'ready' || phase === 'refused' || phase === 'failed';

function Change({ line }: { line: ChangeLine }) {
  return (
    <div
      className="prs-change"
      data-rs-change={line.passageId}
    >
      {line.sectionTitle ? <div className="prs-kind">{line.sectionTitle}</div> : null}
      {line.before !== null ? (
        <div
          className="prs-before"
          data-rs-before=""
        >
          {line.before}
        </div>
      ) : null}
      {line.after !== null ? (
        <div
          className="prs-after"
          data-rs-after=""
        >
          {line.after}
        </div>
      ) : null}
    </div>
  );
}

function Draft({ snap, controller }: { snap: RsSnapshot; controller: RsController }) {
  const view = draftView(snap.docs!.report);
  const selected = snap.selection?.passageId ?? null;
  const ref = useRef<HTMLDivElement | null>(null);
  // Keep the selected sentence in view when the arrow keys move it.
  useEffect(() => {
    const el = selected
      ? ref.current?.querySelector<HTMLElement>(`[data-rs-passage="${CSS_ESCAPE(selected)}"]`)
      : null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      controller.moveSelection(e.key === 'ArrowDown' ? 1 : -1);
      const next = controller.getSnapshot().selection?.passageId;
      if (next) {
        ref.current?.querySelector<HTMLElement>(`[data-rs-passage="${CSS_ESCAPE(next)}"]`)?.focus();
      }
    } else if (e.key === 'Enter' && controller.getSnapshot().selection) {
      e.preventDefault();
      controller.openCopilot();
    }
  };
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Draft report"
      onKeyDown={onKeyDown}
      data-rs-draft=""
      data-rs-revision-shown={view.revision}
    >
      {view.sections.map(section => (
        <section
          key={section.id}
          className="prs-section"
          data-rs-section={section.id}
        >
          <h4>{section.title}</h4>
          {section.passages.length === 0 ? (
            <div className="prs-empty">—</div>
          ) : (
            section.passages.map(p => (
              <div
                key={p.id}
                className="prs-passage"
                role="option"
                tabIndex={
                  p.selectable
                    ? p.id === selected || (!selected && p === view.selectable[0])
                      ? 0
                      : -1
                    : undefined
                }
                aria-selected={p.id === selected}
                aria-disabled={!p.selectable}
                data-selectable={p.selectable}
                data-owner={p.owner}
                data-rs-passage={p.id}
                data-rs-entry={p.entryId ?? undefined}
                onClick={() => p.selectable && controller.select(p.id)}
              >
                {p.text}
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function Inbox({ snap, controller }: { snap: RsSnapshot; controller: RsController }) {
  const entries = inboxView(snap.docs!.inbox, snap.docs!.report);
  if (!entries.length) {
    return (
      <div className="prs-empty">Nothing waiting: no update since the draft was published.</div>
    );
  }
  return (
    <div data-rs-inbox="">
      {entries.map(e => (
        <article
          key={e.id}
          className="prs-card"
          data-rs-inbox-entry={e.id}
        >
          <div className="prs-kind">{e.kindLabel}</div>
          <h5>{e.summary}</h5>
          {e.claims.length ? (
            <ul className="prs-list">
              {e.claims.map(c => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
          {e.preview.length ? (
            <div data-rs-preview="">
              <div className="prs-kind">If accepted</div>
              {e.preview.map(line => (
                <Change
                  key={line.passageId}
                  line={line}
                />
              ))}
            </div>
          ) : null}
          {e.patches.map(p => (
            <div
              key={p.passageId}
              data-rs-patch={p.passageId}
            >
              <div className="prs-kind">Your wording ({p.status})</div>
              <div>{p.ours}</div>
              <div className="prs-kind">Machine wording</div>
              <div className="prs-after">{p.theirs}</div>
            </div>
          ))}
          <div className="prs-actions">
            <button
              type="button"
              className="prs-btn"
              data-primary="true"
              data-rs-accept={e.id}
              disabled={snap.busy || !e.acceptable}
              title={!e.acceptable && e.reason ? e.reason : undefined}
              onClick={() => void controller.accept(e.id)}
            >
              Accept
            </button>
            <button
              type="button"
              className="prs-btn"
              data-rs-reject={e.id}
              disabled={snap.busy}
              onClick={() => void controller.reject(e.id)}
            >
              Reject
            </button>
            {!e.acceptable && e.reason ? <span className="prs-reason">{e.reason}</span> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function Changes({ snap, controller }: { snap: RsSnapshot; controller: RsController }) {
  const groups = changeListView(snap.docs!.inbox.changeList, snap.docs!.report);
  const revisions = revisionsView(snap.docs!.versions);
  return (
    <div data-rs-changes="">
      <div className="prs-kind">Latest evidence against the published draft</div>
      {groups.length === 0 ? (
        <div
          className="prs-empty"
          data-rs-changelist-empty=""
        >
          The latest evidence says what the published draft says.
        </div>
      ) : (
        groups.map(g => (
          <div
            key={g.key}
            className="prs-card"
            data-rs-change-group={g.key}
          >
            <h5>{g.label}</h5>
            {g.lines.map(line => (
              <Change
                key={`${g.key}:${line.passageId}`}
                line={line}
              />
            ))}
          </div>
        ))
      )}
      <div
        className="prs-kind"
        style={{ marginTop: 10 }}
      >
        Revisions of the published draft
      </div>
      {revisions.length === 0 ? (
        <div className="prs-empty">No revision since the draft was compiled.</div>
      ) : (
        <ul
          className="prs-list"
          style={{ listStyle: 'none', paddingLeft: 0 }}
        >
          {revisions.map(r => (
            <li
              key={r.revisionId}
              data-rs-revision={r.revisionId}
              data-rs-undone={r.undone || undefined}
              style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '3px 0' }}
            >
              <span className="prs-meta">r{r.revision}</span>
              <span
                style={r.undone ? { textDecoration: 'line-through', color: '#7F8EA0' } : undefined}
              >
                {r.label}
              </span>
              {r.undoable ? (
                <button
                  type="button"
                  className="prs-btn"
                  data-rs-undo={r.revisionId}
                  disabled={snap.busy}
                  onClick={() => void controller.undo(r.revisionId)}
                >
                  Undo
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Copilot({ snap, controller }: { snap: RsSnapshot; controller: RsController }) {
  const view = snap.docs?.evidence
    ? copilotView(snap.docs.evidence, snap.selection?.entryId ?? null)
    : null;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const list = (title: string, items: string[], attr: string) =>
    items.length ? (
      <>
        <h5>{title}</h5>
        <ul
          className="prs-list"
          data-rs-copilot-list={attr}
        >
          {items.map((x, i) => (
            <li key={`${i}:${x}`}>{x}</li>
          ))}
        </ul>
      </>
    ) : null;
  return (
    <section
      className="prs-copilot"
      role="dialog"
      aria-modal="false"
      aria-label="Copilot"
      data-rs-copilot={snap.selection?.entryId ?? ''}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          controller.closeCopilot();
        }
      }}
    >
      <header>
        <h4>Copilot{view ? `: ${view.heading}` : ''}</h4>
        <button
          ref={closeRef}
          type="button"
          className="prs-btn"
          data-rs-copilot-close=""
          onClick={() => controller.closeCopilot()}
        >
          Close
        </button>
      </header>
      {!view ? (
        <div className="prs-empty">The evidence view does not describe this finding.</div>
      ) : (
        <>
          <dl>
            {view.facts.map(f => (
              <React.Fragment key={f.label}>
                <dt>{f.label}</dt>
                <dd data-rs-copilot-fact={f.label}>{f.value}</dd>
              </React.Fragment>
            ))}
            {view.comparison ? (
              <>
                <dt>Comparison</dt>
                <dd data-rs-copilot-fact="Comparison">{view.comparison}</dd>
              </>
            ) : null}
          </dl>
          {list('Sources', view.sources, 'sources')}
          {list('Disagreement', view.disagreement, 'disagreement')}
          {list('Predicates still unresolved', view.unresolved, 'unresolved')}
          {list('Pathway branches', view.branches, 'branches')}
          {list(
            'Class alternatives',
            view.alternatives.map(a => a.text),
            'alternatives'
          )}
          {list('Questions, in their fixed order', view.questions, 'questions')}
          {list('Signing', view.signing, 'signing')}
          {list('Processing', view.processing, 'processing')}
        </>
      )}
    </section>
  );
}

/** `CSS.escape` where the platform has it (a passage id is plain, but a selector is never built from raw text). */
function CSS_ESCAPE(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  return css?.escape ? css.escape(value) : value.replace(/["\\]/g, '\\$&');
}

export function RsPane({
  controller,
  doc,
  anatomy = null,
  pathgrade = null,
}: {
  controller: RsController;
  doc?: Document;
  anatomy?: AnatomyStore | null;
  pathgrade?: ShowcaseStore | null;
}) {
  useInjectedStyle(doc ?? (typeof document !== 'undefined' ? document : undefined));
  const snap = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const anat = useSyncExternalStore(
    anatomy ? anatomy.subscribe : noSubscribe,
    anatomy ? anatomy.getSnapshot : noAnatomy,
    anatomy ? anatomy.getSnapshot : noAnatomy
  );
  const withAnatomy = Boolean(anatomy) && anatomyTabShown(anat.phase);
  const anatomyReady = Boolean(anatomy) && anat.phase === 'ready';
  const paneReady = snap.phase === 'ready';
  useEffect(() => {
    // WeiWei: the pane is to show what the software can do, more on the visual
    // side; a study with anatomy opens on it (unless the reader picked a tab).
    if (anatomyReady && paneReady) {
      controller.offerTab('anatomy');
    }
  }, [anatomyReady, paneReady, controller]);
  const tabs = [
    ...(withAnatomy ? [ANATOMY_TAB] : []),
    ...TABS,
    ...(pathgrade ? [PATHGRADE_TAB] : []),
  ];
  const tab: RsTab =
    (snap.tab === 'anatomy' && !withAnatomy) || (snap.tab === 'pathgrade' && !pathgrade)
      ? 'draft'
      : snap.tab;
  const structureCount = Object.keys(anat.structures).length;
  const docs = snap.docs;
  const inboxCount = docs?.inbox.entries.length ?? 0;
  const changeCount = docs
    ? changeListView(docs.inbox.changeList, docs.report).reduce((n, g) => n + g.lines.length, 0)
    : 0;
  const lines = docs ? chromeLines(docs.report) : [];
  const ready = snap.phase === 'ready' && docs;
  const status =
    snap.phase === 'loading'
      ? 'Loading…'
      : snap.phase === 'refused' || snap.phase === 'failed'
        ? (snap.reason ?? 'Unavailable')
        : (lines[0]?.text ?? '');

  return (
    <div
      className="prs-root"
      data-rs-phase={snap.phase}
      data-rs-collapsed={snap.collapsed}
    >
      <div
        className="prs-bar"
        data-rs-bar=""
      >
        <button
          type="button"
          className="prs-title"
          aria-expanded={!snap.collapsed}
          data-rs-collapse=""
          onClick={() => controller.setCollapsed(!snap.collapsed)}
          title={snap.collapsed ? 'Show the CT analysis' : 'Fold the CT analysis to this line'}
        >
          <span aria-hidden="true">{snap.collapsed ? '▸' : '▾'}</span>
          CT analysis
        </button>
        {ready ? (
          <>
            <span
              className="prs-meta"
              data-rs-published={docs.report.revision}
            >
              Draft r{docs.report.revision}
            </span>
            <span
              className="prs-count"
              data-live={inboxCount > 0}
              data-rs-inbox-count={inboxCount}
            >
              Inbox {inboxCount}
            </span>
            <span
              className="prs-count"
              data-rs-change-count={changeCount}
            >
              Changes {changeCount}
            </span>
          </>
        ) : null}
        <span
          className="prs-spacer"
          title={status || undefined}
        >
          {status}
        </span>
        {ready && anatomy && anatomyReady ? (
          <button
            type="button"
            className="prs-btn"
            data-rs-anatomy-toggle=""
            aria-pressed={anat.settings.enabled}
            title={
              anat.settings.enabled
                ? 'Hide the anatomy on the images'
                : 'Show the anatomy on the images'
            }
            onClick={() => anatomy.setEnabled(!anat.settings.enabled)}
          >
            Anatomy
          </button>
        ) : null}
        {ready ? (
          <button
            type="button"
            className="prs-btn"
            data-rs-copilot-toggle=""
            aria-pressed={snap.copilotOpen}
            title={`Copilot for the selected sentence (${COPILOT_KEY_LABEL})`}
            onClick={() => controller.toggleCopilot()}
          >
            Copilot ({COPILOT_KEY_LABEL})
          </button>
        ) : null}
      </div>
      {ready && !snap.collapsed ? (
        <div className="prs-body">
          {lines.length ? (
            <div
              className="prs-chrome"
              role="status"
              data-rs-chrome=""
            >
              {lines.map(l => (
                <span
                  key={l.key}
                  data-tone={l.tone}
                  title={l.title}
                >
                  {l.text}
                </span>
              ))}
            </div>
          ) : null}
          <div
            className="prs-tabs"
            role="tablist"
            aria-label="CT analysis"
          >
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                className="prs-tab"
                aria-selected={tab === t.id}
                data-rs-tab={t.id}
                onClick={() => controller.setTab(t.id)}
              >
                {t.label}
                {t.id === 'inbox'
                  ? ` (${inboxCount})`
                  : t.id === 'changes'
                    ? ` (${changeCount})`
                    : t.id === 'anatomy' && anatomyReady
                      ? ` (${structureCount})`
                      : ''}
              </button>
            ))}
          </div>
          <div
            className="prs-panel"
            role="tabpanel"
            data-rs-panel={tab}
          >
            {tab === 'anatomy' && anatomy ? (
              <AnatomyTab store={anatomy} />
            ) : tab === 'pathgrade' && pathgrade ? (
              <PathGradeTab
                store={pathgrade}
                evidence={docs?.evidence ?? null}
              />
            ) : tab === 'draft' ? (
              <Draft
                snap={snap}
                controller={controller}
              />
            ) : tab === 'inbox' ? (
              <Inbox
                snap={snap}
                controller={controller}
              />
            ) : (
              <Changes
                snap={snap}
                controller={controller}
              />
            )}
            {snap.copilotOpen ? (
              <Copilot
                snap={snap}
                controller={controller}
              />
            ) : null}
          </div>
          {snap.notice ? (
            <div
              className="prs-notice"
              role="status"
              aria-live="polite"
              data-level={snap.notice.level}
              data-rs-notice={snap.notice.level}
            >
              <span style={{ flex: '1 1 auto' }}>{snap.notice.text}</span>
              {snap.canRetry ? (
                <button
                  type="button"
                  className="prs-btn"
                  data-rs-retry=""
                  disabled={snap.busy}
                  onClick={() => void controller.retry()}
                >
                  Try again
                </button>
              ) : null}
              <button
                type="button"
                className="prs-btn"
                aria-label="Dismiss"
                onClick={() => controller.dismissNotice()}
              >
                ×
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
