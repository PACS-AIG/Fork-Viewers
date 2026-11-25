/**
 * RS-36: the CT analysis pane's Anatomy tab (WeiWei, 24 Nov 2026, through the
 * run session: the pane is "to show the user what we can do by our software,
 * more on the visual side").
 *
 *   - The layers' switch for the images, their opacity, fill or outline.
 *   - Per task (organs, vertebrae, body cavities): shown or hidden, and its
 *     structures from head to feet, each with its colour, a switch, its slice
 *     extent and, for a measurement-eligible structure only (FINAL_SPEC §2.3),
 *     its volume ("≥" when the document says it is only a lower bound). A
 *     click on a structure's name shows it and brings its largest slice into
 *     the viewport; pointing at a row brings the structure out on the images.
 *   - When the document has it (contract 1.14), the whole-mask median and
 *     interquartile range in HU, in a column named for that statistic so it is
 *     never read as the report's ROI median (invariant 9).
 *   - Its research features (contract 1.15's radiomics, WeiWei: "Yes, research
 *     label"), behind a Research button on its row: a section of their own,
 *     marked research use only and not validated for diagnosis, never a
 *     column of the table, a finding, a measurement or report content.
 *   - What its concept record's checks found wrong (contract 1.13), under the
 *     structure's row; a volume outside the record's band in amber.
 *   - Which other series of the acquisition carry the labelmap, resampled
 *     (the scanner's reformats), and how coarse it is there.
 *   - What was not drawn, and why.
 *   - A series' structures in 3D (contract 1.17's display surfaces, WeiWei:
 *     "Yes, build it"), behind a 3D button on its line: in the tab, or
 *     enlarged over the images beside the report column, with the tab's
 *     colours and toggles (Anatomy3DView).
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Anatomy3DView } from './Anatomy3DView';
import { cssColor } from './anatomyColors';
import {
  displayName,
  formatMm,
  type AnatomySeriesView,
  type AnatomySnapshot,
  type AnatomyStore,
  type AnatomyRadiomics,
  type AnatomyStructure,
  type AnatomyTask,
} from './anatomyStore';

/**
 * What a series view says of the other series of its acquisition that carry
 * its labelmap: resampled, so along its slice axis the outlines step by its
 * slice spacing. Null when there are none.
 */
export function resampledNote(s: AnatomySeriesView): string | null {
  if (s.related < 1) {
    return null;
  }
  const step = s.sliceMm > 0 ? formatMm(s.sliceMm) : null;
  const where = s.alongBody ? 'along the body' : 'across its slices';
  return (
    `Also drawn on ${s.related} other series of the same acquisition, resampled from this labelmap` +
    (step ? `: ${where}, their outlines step every ${step} mm.` : '.')
  );
}

/** Whether a series has a 3D view: a surfaces file to read, or a description of one that could not be read. */
export function surfacesOffered(s: AnatomySeriesView): boolean {
  return s.tasks.some(t => t.surfaces.status !== 'none' && t.surfaces.status !== 'withheld');
}

/**
 * Where the enlarged 3D view sits: over the images, on the wider side of the
 * report column and as tall as it, so the tab's toggles stay at hand; over
 * the whole window when neither side has room.
 */
export function overlayRect(
  column: { left: number; right: number; top: number; bottom: number },
  win: { innerWidth: number; innerHeight: number }
): { left: number; top: number; width: number; height: number } {
  const gap = 8;
  const leftRoom = column.left - 2 * gap;
  const rightRoom = win.innerWidth - column.right - 2 * gap;
  const top = Math.max(gap, column.top + gap);
  const height = Math.min(win.innerHeight, column.bottom) - gap - top;
  if (Math.max(leftRoom, rightRoom) < 320 || height < 200) {
    return {
      left: gap,
      top: gap,
      width: Math.max(0, win.innerWidth - 2 * gap),
      height: Math.max(0, win.innerHeight - 2 * gap),
    };
  }
  return leftRoom >= rightRoom
    ? { left: gap, top, width: leftRoom, height }
    : { left: column.right + gap, top, width: rightRoom, height };
}

/** The enlarged view's place now: beside the report column, or the whole window without one. */
function measureOverlay(doc: Document, column: HTMLElement | null) {
  const win = {
    innerWidth: doc.defaultView?.innerWidth ?? 0,
    innerHeight: doc.defaultView?.innerHeight ?? 0,
  };
  const rect = column?.getBoundingClientRect() ?? {
    left: 0,
    right: win.innerWidth,
    top: 0,
    bottom: win.innerHeight,
  };
  return overlayRect(rect, win);
}

/** A series' 3D view enlarged over the images (a portal: the pane is too small for it). */
function Enlarged3D({
  store,
  series,
  doc,
  column,
  onBack,
  onClose,
}: {
  store: AnatomyStore;
  series: number;
  doc: Document;
  column: HTMLElement | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const [rect, setRect] = useState(() => measureOverlay(doc, column));
  const box = useRef<HTMLDivElement>(null);
  // It follows the window and the report column.
  useEffect(() => {
    const win = doc.defaultView;
    if (!win) {
      return;
    }
    const update = () => setRect(measureOverlay(doc, column));
    win.addEventListener('resize', update);
    const RO = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const observer = column && typeof RO === 'function' ? new RO(update) : null;
    observer?.observe(column as HTMLElement);
    return () => {
      win.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [doc, column]);
  // Keys go to it at once: Esc takes it back to the pane.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-rs-anatomy-3d-enlarge]')?.focus();
  }, []);
  return createPortal(
    <div
      ref={box}
      className="prs-3d-overlay"
      role="dialog"
      aria-label="Anatomy in 3D"
      tabIndex={-1}
      data-rs-anatomy-3d-overlay=""
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          // Only back to the pane: neither OHIF's Esc nor the spotlight's.
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
      }}
    >
      <Anatomy3DView
        store={store}
        series={series}
        enlarged
        onEnlarge={onBack}
        onClose={onClose}
      />
    </div>,
    doc.body
  );
}

/** A volume as the table shows it. */
export function formatVolume(ml: number): string {
  if (!Number.isFinite(ml) || ml <= 0) {
    return '—';
  }
  if (ml >= 100) {
    return `${Math.round(ml).toLocaleString('en-US')} mL`;
  }
  if (ml >= 1) {
    return `${ml.toFixed(1)} mL`;
  }
  return `${ml.toFixed(2)} mL`;
}

/** The volume cell's text and title, or empty for a structure that shows no volume. */
export function volumeCell(s: AnatomyStructure): { text: string; title: string | undefined } {
  const v = s.volume;
  if (!v) {
    return { text: '', title: undefined };
  }
  const text = `${v.atLeast ? '≥ ' : ''}${formatVolume(v.ml)}`;
  const parts = [
    v.from === 'document'
      ? 'From the reading system'
      : `From ${s.voxels.toLocaleString('en-US')} voxels`,
    v.atLeast ? 'at least: the structure reaches the scan’s edge' : null,
    s.outOfBand ? 'outside the expected range for this organ' : null,
  ].filter(Boolean);
  return { text, title: `${parts.join('; ')}.` };
}

/** A research feature's value as the section shows it: four significant digits, or an exponent past them. */
export function formatFeature(v: number | null): string {
  if (v === null) {
    return '—';
  }
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) {
    return v.toExponential(2);
  }
  return String(Number(v.toPrecision(4)));
}

const RESEARCH_STATE: Record<string, string> = {
  disabled: 'Disabled',
  not_computed: 'Not computed',
};

/** The research banner's words (WeiWei: clearly labelled research features, not for diagnosis). */
export const RESEARCH_BANNER =
  'Research use only: not validated for diagnosis. Never a finding, a measurement or report content.';

/** A structure's research features (1.15): by class, the first open; or why they were not computed. */
function ResearchFeatures({ r }: { r: AnatomyRadiomics }) {
  return (
    <div
      className="prs-research"
      role="region"
      aria-label={`Research features (${r.featureSet})`}
    >
      <div className="prs-research-head">
        Research features ({r.featureSet}){r.engine ? ` · ${r.engine}` : ''}
      </div>
      <div className="prs-research-banner">{RESEARCH_BANNER}</div>
      {r.state !== 'computed' ? (
        <div
          className="prs-research-reason"
          data-rs-research-reason=""
        >
          {RESEARCH_STATE[r.state] ?? r.state}
          {r.reason ? `: ${r.reason.replace(/[.]$/, '')}` : ''}.
        </div>
      ) : r.groups.length ? (
        r.groups.map((g, i) => (
          <details
            key={g.cls}
            open={i === 0}
            data-rs-research-class={g.cls}
          >
            <summary>
              {g.title} ({g.features.length})
            </summary>
            <dl className="prs-research-grid">
              {g.features.map(([name, value]) => (
                <React.Fragment key={name}>
                  <dt title={name}>{name}</dt>
                  <dd>{formatFeature(value)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        ))
      ) : (
        <div className="prs-empty">No features.</div>
      )}
    </div>
  );
}

/** The attenuation column's header title (invariant 9: the statistic is named). */
export const ATTENUATION_TITLE =
  'The median and interquartile range of HU over every voxel of the mask, on the original CT: partial volume at its edge and its vessels included. Not the report’s ROI median.';

/** The attenuation cell's text ("34 (18)": median and interquartile range, HU) and title. */
export function attenuationCell(s: AnatomyStructure): { text: string; title: string | undefined } {
  const a = s.attenuation;
  if (!a) {
    return { text: '', title: undefined };
  }
  if (!a.supported || a.median === null) {
    return {
      text: '—',
      title: `Not measured${a.reasons.length ? `: ${a.reasons.join('; ')}` : ''}.`,
    };
  }
  const iqr = a.iqr === null ? '' : ` (${Math.round(a.iqr)})`;
  const title = `Whole-mask median ${a.median.toFixed(1)} HU${
    a.iqr === null ? '' : `, interquartile range ${a.iqr.toFixed(1)} HU`
  }: every voxel of the mask, partial volume and vessels included. Not the report’s ROI median.`;
  return { text: `${Math.round(a.median)}${iqr}`, title };
}

/** The extent cell's text and title ("29 sl", "≥ 12 sl" when it runs past the scan's first or last slice). */
export function extentCell(s: AnatomyStructure): { text: string; title: string | undefined } {
  const e = s.extent;
  if (!e) {
    return { text: '', title: undefined };
  }
  const parts = [
    `${e.slices} ${e.slices === 1 ? 'slice' : 'slices'}, about ${Math.round(e.mm)} mm`,
    e.atLeast ? 'it runs past the scan’s first or last slice' : null,
    s.components && s.components > 1 ? `in ${s.components} parts` : null,
  ].filter(Boolean);
  return { text: `${e.atLeast ? '≥ ' : ''}${e.slices} sl`, title: `${parts.join('; ')}.` };
}

function Task({
  snap,
  task,
  store,
}: {
  snap: AnatomySnapshot;
  task: AnatomyTask;
  store: AnatomyStore;
}) {
  const [open, setOpen] = useState(task.visible);
  // The attenuation column is there once the document gives any (contract 1.14).
  const withAttenuation = Object.values(snap.structures).some(x => x.attenuation);
  const columns = withAttenuation ? 6 : 5;
  // The structure whose research features are open (one at a time).
  const [research, setResearch] = useState<string | null>(null);
  const loading = task.status === 'loading' || task.status === 'waiting';
  return (
    <section
      className="prs-anatomy-task"
      data-rs-anatomy-task={task.task}
      data-rs-status={task.status}
    >
      <header>
        <button
          type="button"
          className="prs-fold"
          aria-expanded={open}
          aria-label={open ? `Fold ${task.title}` : `Unfold ${task.title}`}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
        <label>
          <input
            type="checkbox"
            checked={task.visible}
            disabled={task.status === 'refused'}
            data-rs-anatomy-task-toggle={task.task}
            onChange={e => store.setTaskVisible(task.series, task.task, e.target.checked)}
          />
          {task.title}
        </label>
        <span className="prs-meta">{task.structures.length}</span>
        {loading ? <span className="prs-meta">loading…</span> : null}
        {task.status === 'refused' ? (
          <span
            className="prs-reason"
            title={task.reason ?? undefined}
          >
            not drawn
          </span>
        ) : null}
      </header>
      {open ? (
        <table className="prs-structures">
          <thead>
            <tr>
              <th colSpan={3} />
              <th className="prs-num">Extent</th>
              <th className="prs-num">Volume</th>
              {withAttenuation ? (
                <th
                  className="prs-num"
                  title={ATTENUATION_TITLE}
                >
                  Median (IQR)
                  <span className="prs-th-sub">HU, whole mask</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {task.structures.map(key => {
              const s = snap.structures[key];
              if (!s) {
                return null;
              }
              const name = displayName(s.name);
              const volume = volumeCell(s);
              const extent = extentCell(s);
              const rowProps = {
                'data-hidden': !s.visible || !task.visible,
                onMouseEnter: () => store.hover(key),
                onMouseLeave: () => store.hover(null),
              };
              return (
                <React.Fragment key={key}>
                  <tr
                    data-rs-structure={`${s.task}/${s.value}`}
                    aria-selected={snap.selected === key}
                    {...rowProps}
                  >
                    <td className="prs-cell-check">
                      <input
                        type="checkbox"
                        checked={s.visible}
                        disabled={task.status === 'refused'}
                        aria-label={`Show ${name}`}
                        onChange={e => store.setStructureVisible(key, e.target.checked)}
                      />
                    </td>
                    <td className="prs-cell-swatch">
                      <span
                        className="prs-swatch"
                        style={{ background: cssColor(s.color) }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="prs-structure"
                        disabled={task.status !== 'ready'}
                        aria-pressed={snap.selected === key}
                        title={
                          task.status !== 'ready'
                            ? undefined
                            : snap.selected === key
                              ? `${name} is picked out on the images: click again or press Esc to stop`
                              : `Show ${name} on the images`
                        }
                        onClick={() => store.select(key)}
                      >
                        {name}
                      </button>
                      {s.warnings.length ? (
                        <span
                          className="prs-flag"
                          title={s.warnings.join(' ')}
                          aria-label="Its record's checks found something"
                        >
                          !
                        </span>
                      ) : null}
                      {s.radiomics ? (
                        <button
                          type="button"
                          className="prs-research-toggle"
                          aria-expanded={research === key}
                          data-rs-research-toggle={`${s.task}/${s.value}`}
                          title="Research features (radiomics): research use only, not for diagnosis"
                          onClick={() => setResearch(research === key ? null : key)}
                        >
                          Research
                        </button>
                      ) : null}
                    </td>
                    <td
                      className="prs-num"
                      data-rs-extent=""
                      title={extent.title}
                    >
                      {extent.text}
                    </td>
                    <td
                      className="prs-num"
                      data-rs-volume=""
                      data-out-of-band={s.outOfBand || undefined}
                      title={volume.title}
                    >
                      {volume.text}
                    </td>
                    {withAttenuation ? (
                      <td
                        className="prs-num"
                        data-rs-attenuation=""
                        title={attenuationCell(s).title}
                      >
                        {attenuationCell(s).text}
                      </td>
                    ) : null}
                  </tr>
                  {s.warnings.length ? (
                    <tr
                      className="prs-structure-warnings"
                      data-rs-structure-warnings={`${s.task}/${s.value}`}
                      {...rowProps}
                    >
                      <td colSpan={2} />
                      <td colSpan={columns - 2}>{s.warnings.join(' ')}</td>
                    </tr>
                  ) : null}
                  {s.radiomics && research === key ? (
                    <tr
                      className="prs-research-row"
                      data-rs-research={`${s.task}/${s.value}`}
                      {...rowProps}
                    >
                      <td colSpan={columns}>
                        <ResearchFeatures r={s.radiomics} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

export function AnatomyTab({ store }: { store: AnatomyStore }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // The series in 3D (one at a time), in the tab or enlarged over the images.
  const [view3d, setView3d] = useState<{ series: number; enlarged: boolean } | null>(null);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  // Back from enlarged: the keys return to the tab's Enlarge button.
  const refocus = useRef(false);
  useEffect(() => {
    if (refocus.current && view3d && !view3d.enlarged) {
      refocus.current = false;
      rootEl?.querySelector<HTMLElement>('[data-rs-anatomy-3d-enlarge]')?.focus();
    }
  }, [view3d, rootEl]);
  const back = () => {
    refocus.current = true;
    setView3d(v => (v ? { ...v, enlarged: false } : v));
  };
  if (snap.phase === 'loading' || snap.phase === 'idle') {
    return <div className="prs-empty">Loading the anatomy…</div>;
  }
  if (snap.phase === 'refused' || snap.phase === 'failed') {
    return (
      <div
        className="prs-empty"
        data-rs-anatomy-error=""
      >
        {snap.reason ?? 'The anatomy could not be read.'}
      </div>
    );
  }
  if (snap.phase !== 'ready') {
    return <div className="prs-empty">No anatomy is published for this study.</div>;
  }
  const { settings } = snap;
  const percent = Math.round(settings.opacity * 100);
  const shown3d = view3d && snap.series.some(s => s.index === view3d.series) ? view3d : null;
  return (
    <div
      ref={setRootEl}
      className="prs-anatomy"
      data-rs-anatomy=""
    >
      <div className="prs-anatomy-controls">
        <label>
          <input
            type="checkbox"
            checked={settings.enabled}
            data-rs-anatomy-enabled=""
            onChange={e => store.setEnabled(e.target.checked)}
          />
          On the images
        </label>
        <label className="prs-opacity">
          Opacity
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={percent}
            disabled={!settings.enabled}
            aria-label="Layer opacity"
            data-rs-anatomy-opacity=""
            onChange={e => store.setOpacity(Number(e.target.value) / 100)}
          />
          <span className="prs-meta">{percent}%</span>
        </label>
        <div
          className="prs-seg"
          role="group"
          aria-label="Drawn as"
        >
          {(['fill', 'outline'] as const).map(style => (
            <button
              key={style}
              type="button"
              aria-pressed={settings.style === style}
              disabled={!settings.enabled}
              data-rs-anatomy-style={style}
              onClick={() => store.setStyle(style)}
            >
              {style === 'fill' ? 'Fill' : 'Outline'}
            </button>
          ))}
        </div>
      </div>
      {snap.series.map(s => (
        <div
          key={s.index}
          className="prs-anatomy-series"
        >
          <div className="prs-anatomy-desc">
            <span>
              {snap.series.length > 1 ? `Series ${s.index + 1}: ` : ''}
              {s.description}
            </span>
            {surfacesOffered(s) ? (
              <button
                type="button"
                className="prs-btn"
                aria-pressed={shown3d?.series === s.index}
                data-rs-anatomy-3d-open={s.index}
                title={
                  shown3d?.series === s.index
                    ? 'Close the 3D view'
                    : 'These structures in 3D, as the tab colours and switches them'
                }
                onClick={() =>
                  setView3d(
                    shown3d?.series === s.index ? null : { series: s.index, enlarged: false }
                  )
                }
              >
                3D
              </button>
            ) : null}
          </div>
          {resampledNote(s) ? (
            <div
              className="prs-anatomy-resampled"
              data-rs-anatomy-resampled=""
            >
              {resampledNote(s)}
            </div>
          ) : null}
          {shown3d?.series === s.index ? (
            shown3d.enlarged ? (
              <div
                className="prs-3d-away"
                data-rs-anatomy-3d-away=""
              >
                Enlarged over the images.
                <button
                  type="button"
                  className="prs-btn"
                  onClick={back}
                >
                  Back to the pane
                </button>
              </div>
            ) : (
              <Anatomy3DView
                store={store}
                series={s.index}
                onEnlarge={() => setView3d({ series: s.index, enlarged: true })}
                onClose={() => setView3d(null)}
              />
            )
          ) : null}
          {s.tasks.map(t => (
            <Task
              key={t.task}
              snap={snap}
              task={t}
              store={store}
            />
          ))}
          {s.unnamed > 0 ? (
            <div className="prs-empty">
              {s.unnamed} unnamed {s.unnamed === 1 ? 'proposal is' : 'proposals are'} not drawn.
            </div>
          ) : null}
        </div>
      ))}
      {snap.notes.length ? (
        <ul
          className="prs-anatomy-notes"
          data-rs-anatomy-notes=""
        >
          {snap.notes.map(n => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="prs-anatomy-foot">
        TotalSegmentator anatomy, drawn for orientation: not reviewed, never saved as a
        segmentation.
      </div>
      {shown3d?.enlarged && rootEl ? (
        <Enlarged3D
          store={store}
          series={shown3d.series}
          doc={rootEl.ownerDocument}
          column={rootEl.closest<HTMLElement>('[data-pacsai-rs-pane]')?.parentElement ?? null}
          onBack={back}
          onClose={() => setView3d(null)}
        />
      ) : null}
    </div>
  );
}
