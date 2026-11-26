/**
 * RS-36: one structure's research features (contract 1.15's radiomics) under
 * its row of the Anatomy tab (WeiWei, 27 Nov 2026, the Tau case session's
 * design): a search over them; their families as groups that fold, Shape open
 * and First order open on its key features; readable names, units and about
 * three significant digits, the unrounded value in each tooltip. Research use
 * only: never a finding, a measurement or report content.
 */
import React, { useState } from 'react';
import type { AnatomyRadiomics } from './anatomyStore';
import {
  exactValue,
  featureMatches,
  featureOf,
  formatFeature,
  KEY_FIRST_ORDER,
  type RadiomicsFeature,
} from './radiomicsView';

/** The research label, wherever the features are shown. */
export const RADIOMICS_NOTE = 'Research use only, not part of the report.';

/** The families open before the reader folds or unfolds any. */
const OPEN_AT_FIRST = ['shape', 'firstorder'];

/** One feature's name and value, its unit beside the value. */
export function FeatureRow({ f, value }: { f: RadiomicsFeature; value: number | null }) {
  return (
    <>
      <dt
        title={f.key}
        data-rs-radiomics-feature={f.key}
      >
        {f.label}
      </dt>
      <dd title={exactValue(value, f.unit, f.note)}>
        {formatFeature(value)}
        {f.unit && value !== null ? <span className="prs-unit"> {f.unit}</span> : null}
      </dd>
    </>
  );
}

export function RadiomicsSection({ r }: { r: AnatomyRadiomics }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set(OPEN_AT_FIRST));
  const [allFirstOrder, setAllFirstOrder] = useState(false);
  const searching = query.trim() !== '';
  const families = r.groups.map(g => ({
    cls: g.cls,
    title: g.title,
    rows: g.features.map(([name, value]) => ({ f: featureOf(g.cls, name), value })),
  }));
  const toggle = (cls: string) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(cls)) {
        next.delete(cls);
      } else {
        next.add(cls);
      }
      return next;
    });
  const shownFamilies = families
    .map(fam => ({
      ...fam,
      matching: searching ? fam.rows.filter(x => featureMatches(x.f, query)) : fam.rows,
    }))
    .filter(fam => !searching || fam.matching.length > 0);
  return (
    <div
      className="prs-radiomics"
      role="region"
      aria-label={`Radiomics (${r.featureSet})`}
      data-rs-radiomics-section=""
    >
      <div className="prs-radiomics-head">
        Radiomics ({r.featureSet}
        {r.engine ? ` · ${r.engine}` : ''}).{' '}
        <span className="prs-research-banner">{RADIOMICS_NOTE}</span>
      </div>
      <input
        type="search"
        className="prs-radiomics-search"
        placeholder="Search features"
        aria-label="Search the radiomics features"
        value={query}
        data-rs-radiomics-search=""
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          // Esc empties the search here, not the spotlight or OHIF's.
          if (e.key === 'Escape' && query) {
            e.preventDefault();
            e.stopPropagation();
            setQuery('');
          }
        }}
      />
      {shownFamilies.length === 0 ? (
        <div
          className="prs-empty"
          data-rs-radiomics-none=""
        >
          No feature matches “{query.trim()}”.
        </div>
      ) : null}
      {shownFamilies.map(fam => {
        const isOpen = searching || open.has(fam.cls);
        const keyOnly = fam.cls === 'firstorder' && !allFirstOrder && !searching;
        const keyRows = keyOnly
          ? KEY_FIRST_ORDER.map(n => fam.rows.find(x => x.f.name === n)).filter(
              (x): x is (typeof fam.rows)[number] => Boolean(x)
            )
          : [];
        const rows = keyOnly && keyRows.length ? keyRows : fam.matching;
        return (
          <div
            key={fam.cls}
            className="prs-radiomics-family"
            data-rs-radiomics-family={fam.cls}
          >
            <button
              type="button"
              className="prs-family-toggle"
              aria-expanded={isOpen}
              disabled={searching}
              onClick={() => toggle(fam.cls)}
            >
              <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span> {fam.title}{' '}
              <span className="prs-meta">
                {searching ? `${fam.matching.length} of ${fam.rows.length}` : fam.rows.length}
              </span>
            </button>
            {isOpen ? (
              <>
                <dl className="prs-radiomics-grid">
                  {rows.map(x => (
                    <FeatureRow
                      key={x.f.key}
                      f={x.f}
                      value={x.value}
                    />
                  ))}
                </dl>
                {keyOnly && rows.length < fam.rows.length ? (
                  <button
                    type="button"
                    className="prs-link"
                    data-rs-radiomics-more=""
                    onClick={() => setAllFirstOrder(true)}
                  >
                    Show all {fam.rows.length}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
