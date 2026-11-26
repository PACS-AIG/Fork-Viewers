/**
 * RS-36: the CT analysis pane's Anatomy tab (WeiWei, 24 Nov 2026, through the
 * run session: the pane is "to show the user what we can do by our software,
 * more on the visual side").
 *
 *   - The layers' switch for the images, their opacity, fill or outline; and,
 *     while a structure is picked out (the others faded on the images and in
 *     3D), Show all, which lets it go.
 *   - Per task (organs, vertebrae, body cavities): shown or hidden, and its
 *     structures from head to feet, each with its colour, a switch, its slice
 *     extent and, for a measurement-eligible structure only (FINAL_SPEC §2.3),
 *     its volume ("≥" and "touches the scan edge" when the document says it is
 *     only a lower bound); any other structure says it is for localization
 *     only (invariant 8). A click on a structure's name shows it and brings its
 *     largest slice into the viewport; pointing at a row brings the structure
 *     out on the images; a structure clicked on the images (the overlay's pick)
 *     has its task unfolded and its row scrolled into view.
 *   - When the document has it (contract 1.14), the whole-mask median and
 *     interquartile range in HU, in a column named for that statistic so it is
 *     never read as the report's ROI median (invariant 9).
 *   - Its research features (contract 1.15's radiomics; WeiWei, 27 Nov 2026,
 *     the Tau case session's design): a "Radiomics · 80" chip on its row when
 *     they were computed, which opens them under it (RadiomicsSection), marked
 *     research use only, never a column of the table, a finding, a measurement
 *     or report content. The study's side by side: the Radiomics tab.
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
import type { Anatomy3dCell } from './anatomy3dCell';
import { cssColor } from './anatomyColors';
import {
  displayName,
  formatMm,
  type AnatomySeriesView,
  type AnatomySnapshot,
  type AnatomyStore,
  type AnatomyStructure,
  type AnatomyTask,
} from './anatomyStore';
import { RadiomicsSection } from './RadiomicsSection';

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

/** A volume as the table shows it: whole mL from 1,000, one decimal from 1, two below. */
export function formatVolume(ml: number): string {
  if (!Number.isFinite(ml) || ml <= 0) {
    return '—';
  }
  if (Math.round(ml * 10) / 10 >= 1000) {
    return `${Math.round(ml).toLocaleString('en-US')} mL`;
  }
  if (ml >= 1) {
    return `${ml.toFixed(1)} mL`;
  }
  return `${ml.toFixed(2)} mL`;
}

/** The volume cell's text, whether it is a lower bound at the scan's edge, and its title; empty for no volume. */
export function volumeCell(s: AnatomyStructure): {
  text: string;
  edge: boolean;
  title: string | undefined;
} {
  const v = s.volume;
  if (!v) {
    return { text: '', edge: false, title: undefined };
  }
  const text = `${v.atLeast ? '≥ ' : ''}${formatVolume(v.ml)}`;
  const parts = [
    v.from === 'document'
      ? 'From the reading system'
      : `From ${s.voxels.toLocaleString('en-US')} voxels`,
    v.atLeast
      ? 'at least: the structure touches the scan’s edge, so its volume is a minimum'
      : null,
    s.outOfBand ? 'outside the expected range for this organ' : null,
  ].filter(Boolean);
  return { text, edge: v.atLeast, title: `${parts.join('; ')}.` };
}

/** What a structure that is not measurement eligible says instead of numbers (invariant 8). */
export const LOCALIZATION_ONLY = 'localization only';
export const LOCALIZATION_TITLE =
  'Drawn and named; this structure is not qualified for measurement.';

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
  const [radiomics, setRadiomics] = useState<string | null>(null);
  const loading = task.status === 'loading' || task.status === 'waiting';
  // A structure selected here or picked on the images: its task unfolds and its row comes into view.
  const selectedHere =
    snap.selected !== null && task.structures.includes(snap.selected) ? snap.selected : null;
  useEffect(() => {
    if (selectedHere) {
      setOpen(true);
    }
  }, [selectedHere]);
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    if (!selectedHere || !open) {
      return;
    }
    const row = body.current?.querySelector<HTMLElement>(
      `tr[data-rs-structure-key="${selectedHere}"]`
    );
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedHere, open]);
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
          <tbody ref={body}>
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
                    data-rs-structure-key={key}
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
                      {s.radiomics?.state === 'computed' ? (
                        <button
                          type="button"
                          className="prs-chip"
                          aria-expanded={radiomics === key}
                          data-rs-radiomics-chip={`${s.task}/${s.value}`}
                          title={`${name}'s research features (radiomics): research use only, not part of the report`}
                          onClick={() => setRadiomics(radiomics === key ? null : key)}
                        >
                          Radiomics · {s.radiomics.finite}
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
                    {s.eligible ? (
                      <>
                        <td
                          className="prs-num"
                          data-rs-volume=""
                          data-out-of-band={s.outOfBand || undefined}
                          title={volume.title}
                        >
                          {volume.text}
                          {volume.edge ? (
                            <span
                              className="prs-cell-sub"
                              data-rs-volume-edge=""
                            >
                              touches the scan edge
                            </span>
                          ) : null}
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
                      </>
                    ) : (
                      <td
                        className="prs-num prs-localization"
                        colSpan={withAttenuation ? 2 : 1}
                        data-rs-volume=""
                        data-rs-localization-only=""
                        title={LOCALIZATION_TITLE}
                      >
                        {LOCALIZATION_ONLY}
                      </td>
                    )}
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
                  {s.radiomics?.state === 'computed' && radiomics === key ? (
                    <tr
                      className="prs-radiomics-row"
                      data-rs-radiomics={`${s.task}/${s.value}`}
                      {...rowProps}
                    >
                      <td colSpan={columns}>
                        <RadiomicsSection r={s.radiomics} />
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

const noCell = { subscribe: () => () => {}, version: () => 0 };

export function AnatomyTab({
  store,
  cell = null,
}: {
  store: AnatomyStore;
  /** The 3D anatomy cell in the viewer's grid: while it is on, the 3D button works it. */
  cell?: Anatomy3dCell | null;
}) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const cellSource = cell ?? noCell;
  useSyncExternalStore(cellSource.subscribe, cellSource.version, cellSource.version);
  // On (the gear menu's setting) and drawable: the model is in the viewports, not in the tab.
  const inGrid = Boolean(cell?.inGrid());
  // The series in 3D (one at a time), in the tab or enlarged over the images.
  const [view3d, setView3d] = useState<{ series: number; enlarged: boolean } | null>(null);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  // Back from enlarged: the keys return to the tab's Enlarge button.
  const refocus = useRef(false);
  // Where the keys go when Show all, gone with the selection, had them.
  const enabledBox = useRef<HTMLInputElement>(null);
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
  const shown3d =
    !inGrid && view3d && snap.series.some(s => s.index === view3d.series) ? view3d : null;
  // The structure picked out: selected and shown, so the others fade on the images and in 3D.
  const sel = snap.selected ? snap.structures[snap.selected] : undefined;
  const picked =
    sel && sel.visible && snap.series[sel.series]?.tasks.some(t => t.task === sel.task && t.visible)
      ? sel
      : null;
  return (
    <div
      ref={setRootEl}
      className="prs-anatomy"
      data-rs-anatomy=""
    >
      <div className="prs-anatomy-controls">
        <label>
          <input
            ref={enabledBox}
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
        {picked ? (
          <button
            type="button"
            className="prs-btn prs-show-all"
            data-rs-anatomy-show-all=""
            title={`Stop picking out ${displayName(picked.name)}: every structure in full again, on the images and in 3D`}
            onClick={() => {
              store.select(null);
              // The button goes with the selection: the keys stay in this row.
              enabledBox.current?.focus();
            }}
          >
            Show all
          </button>
        ) : null}
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
            {surfacesOffered(s) && inGrid && cell ? (
              <button
                type="button"
                className="prs-btn"
                aria-pressed={cell.shown()}
                data-rs-anatomy-3d-open={s.index}
                data-rs-anatomy-3d-grid=""
                title={
                  cell.shown()
                    ? 'Take the 3D model out of the viewports'
                    : 'The 3D model in the viewports, as the tab colours and switches it'
                }
                onClick={() => cell.toggle()}
              >
                3D
              </button>
            ) : surfacesOffered(s) ? (
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
