/**
 * RS-36: the study's research features side by side, a tab of the pane's own
 * like PathGrade (WeiWei, 27 Nov 2026, the Tau case session's design): the
 * features as rows by family, one column per structure whose radiomics were
 * computed; a search; sorting by the feature's name or by a structure's
 * values; Export CSV, built here from the anatomy document and named by the
 * CT side's study ref, never the UID. Research use only: never a finding, a
 * measurement or report content.
 */
import React, { useMemo, useState, useSyncExternalStore } from 'react';
import {
  displayName,
  type AnatomySnapshot,
  type AnatomyStore,
  type AnatomyStructure,
} from './anatomyStore';
import { RADIOMICS_NOTE } from './RadiomicsSection';
import {
  exactValue,
  featureMatches,
  formatFeature,
  nextSort,
  radiomicsCsv,
  radiomicsTable,
  sortFeatures,
  type RadiomicsSort,
} from './radiomicsView';

/** The structures with research features, in the Anatomy tab's order (series, task, head to feet). */
export function radiomicsStructures(snap: AnatomySnapshot): AnatomyStructure[] {
  const out: AnatomyStructure[] = [];
  for (const series of snap.series) {
    for (const task of series.tasks) {
      for (const key of task.structures) {
        const s = snap.structures[key];
        if (s?.radiomics) {
          out.push(s);
        }
      }
    }
  }
  return out;
}

/** How many structures have computed research features (the tab's count; no tab without any). */
export function computedRadiomicsCount(snap: AnatomySnapshot): number {
  return Object.values(snap.structures).filter(s => s.radiomics?.state === 'computed').length;
}

const STATE_WORDS: Record<string, string> = {
  disabled: 'disabled',
  not_computed: 'not computed',
};

/** Hands the browser a file to save (a Blob URL on a passing link). */
export function saveFile(doc: Document, name: string, text: string, type: string): void {
  const view = doc.defaultView;
  const blob = new Blob([text], { type });
  const url = view?.URL.createObjectURL(blob);
  if (!url) {
    return;
  }
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  view?.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
}

export function RadiomicsTab({ store }: { store: AnatomyStore }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<RadiomicsSort>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);
  const { table, notComputed } = useMemo(() => {
    const all = radiomicsStructures(snap);
    return {
      table: radiomicsTable(
        all
          .filter(s => s.radiomics!.state === 'computed')
          .map(s => ({
            key: s.key,
            name: displayName(s.name),
            featureSet: s.radiomics!.featureSet,
            engine: s.radiomics!.engine,
            groups: s.radiomics!.groups,
          }))
      ),
      notComputed: all.filter(s => s.radiomics!.state !== 'computed'),
    };
  }, [snap]);
  const searching = query.trim() !== '';
  const families = table.families
    .map(fam => ({
      ...fam,
      rows: sortFeatures(
        searching ? fam.features.filter(f => featureMatches(f, query)) : fam.features,
        sort,
        table.columns
      ),
    }))
    .filter(fam => fam.rows.length > 0);
  const ariaSort = (by: string): 'ascending' | 'descending' | 'none' =>
    sort?.by === by ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none';
  const exportCsv = async () => {
    if (!root || saving) {
      return;
    }
    setSaving(true);
    try {
      // (No `??` beside an await: the build's regenerator cannot take it.)
      const found = await store.studyFileRef();
      const ref = found || 'study';
      saveFile(
        root.ownerDocument,
        `${ref}-${table.featureSet}.csv`,
        radiomicsCsv(table),
        'text/csv;charset=utf-8'
      );
    } finally {
      setSaving(false);
    }
  };
  if (!table.columns.length) {
    return (
      <div className="prs-empty">No structure of this study has computed research features.</div>
    );
  }
  return (
    <div
      ref={setRoot}
      className="prs-radiomics-tab"
      data-rs-radiomics-tab=""
    >
      <div
        className="prs-research-banner prs-radiomics-banner"
        data-rs-radiomics-banner=""
      >
        {RADIOMICS_NOTE}
      </div>
      <div className="prs-radiomics-tools">
        <input
          type="search"
          className="prs-radiomics-search"
          placeholder="Search features"
          aria-label="Search the radiomics features"
          value={query}
          data-rs-radiomics-search=""
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
        <button
          type="button"
          className="prs-btn"
          disabled={saving}
          data-rs-radiomics-export=""
          title="Every feature of every structure here, unrounded, as a CSV file named by the study's reference"
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>
      <div className="prs-radiomics-meta">
        {table.featureSet}
        {table.engine ? ` · ${table.engine}` : ''} · {table.columns.length}{' '}
        {table.columns.length === 1 ? 'structure' : 'structures'}
      </div>
      {families.length === 0 ? (
        <div
          className="prs-empty"
          data-rs-radiomics-none=""
        >
          No feature matches “{query.trim()}”.
        </div>
      ) : (
        <div className="prs-radiomics-scroll">
          <table className="prs-radiomics-table">
            <thead>
              <tr>
                <th
                  className="prs-radiomics-feature"
                  aria-sort={ariaSort('name')}
                >
                  <button
                    type="button"
                    className="prs-sort"
                    data-rs-radiomics-sort="name"
                    onClick={() => setSort(nextSort(sort, 'name'))}
                  >
                    Feature{sort?.by === 'name' ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                {table.columns.map(c => (
                  <th
                    key={c.key}
                    className="prs-num"
                    aria-sort={ariaSort(c.key)}
                  >
                    <button
                      type="button"
                      className="prs-sort"
                      data-rs-radiomics-sort={c.key}
                      title={`Sort each family by ${c.name}`}
                      onClick={() => setSort(nextSort(sort, c.key))}
                    >
                      {c.name}
                      {sort?.by === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            {families.map(fam => (
              <tbody
                key={fam.cls}
                data-rs-radiomics-family={fam.cls}
              >
                <tr className="prs-radiomics-family-row">
                  <th
                    scope="colgroup"
                    colSpan={1 + table.columns.length}
                  >
                    {fam.title}{' '}
                    <span className="prs-meta">
                      {searching
                        ? `${fam.rows.length} of ${fam.features.length}`
                        : fam.features.length}
                    </span>
                  </th>
                </tr>
                {fam.rows.map(f => (
                  <tr
                    key={f.key}
                    data-rs-radiomics-row={f.key}
                  >
                    <th
                      scope="row"
                      className="prs-radiomics-feature"
                      title={f.key}
                    >
                      {f.label}
                      {f.unit ? <span className="prs-unit"> {f.unit}</span> : null}
                    </th>
                    {table.columns.map(c => {
                      const v = c.values.get(f.key) ?? null;
                      return (
                        <td
                          key={c.key}
                          className="prs-num"
                          title={exactValue(v, f.unit, f.note)}
                        >
                          {formatFeature(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {notComputed.length ? (
        <ul
          className="prs-radiomics-missing"
          data-rs-radiomics-missing=""
        >
          {notComputed.map(s => (
            <li key={s.key}>
              {displayName(s.name)}: {STATE_WORDS[s.radiomics!.state] ?? s.radiomics!.state}
              {s.radiomics!.reason ? ` (${s.radiomics!.reason.replace(/[.]$/, '')})` : ''}.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
