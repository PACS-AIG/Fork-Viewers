/**
 * RS-36: the pane's PathGrade tab: PathGrade's research showcase on public
 * kidney tumours (contract 1.16), never on this patient.
 *
 *   - Its notice first, as a banner, with the cohort's credit.
 *   - This study: each of its findings with a reference-case strip (from the
 *     evidence view the pane reads), as the strip words it; with none, that no
 *     finding has one (the strip appears only from a qualified characterizer,
 *     and none is qualified).
 *   - The showcase's sections in order: a figure is a row of up to three
 *     pictures (each with its alt text and caption, the figure's caption
 *     under the row; a click shows one larger, under its row), facts a list
 *     of labels and values, a table a table, text paragraphs. Every string as
 *     the API words it.
 *
 * Nothing here is a finding, a measurement or report content, and nothing
 * reaches the report or the editor.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RsEvidenceView } from '../rsContract';
import { label } from '../rsModel';
import {
  creditLine,
  type RsShowcase,
  type ShowcaseImage,
  type ShowcaseItem,
} from './showcaseContract';
import type { ShowcasePicture, ShowcaseStore } from './showcaseStore';

/** This study's findings with a reference-case strip, as the tab lists them. */
export function studyStrips(
  evidence: RsEvidenceView | null
): Array<{ finding: string; display: string }> {
  return (evidence?.findings ?? [])
    .filter(f => f.referenceCaseStrip)
    .map(f => ({
      finding: [label(f.kind), f.className].filter(Boolean).join(' · '),
      display: f.referenceCaseStrip!.display,
    }));
}

/** A text item's paragraphs (a blank line apart). */
export const paragraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

function Picture({
  image,
  picture,
  onOpen,
}: {
  image: ShowcaseImage;
  picture: ShowcasePicture | undefined;
  onOpen: () => void;
}) {
  if (picture?.state === 'ready' && picture.url) {
    return (
      <button
        type="button"
        className="prs-pg-picture"
        title="Show it larger"
        aria-label={`${image.alt}: show it larger`}
        onClick={onOpen}
      >
        <img
          src={picture.url}
          alt={image.alt}
          width={image.width}
          height={image.height}
          data-rs-pathgrade-image={image.name}
        />
      </button>
    );
  }
  return (
    <div
      className="prs-pg-placeholder"
      style={{ aspectRatio: `${image.width} / ${image.height}` }}
      data-rs-pathgrade-picture={picture?.state ?? 'waiting'}
      role="img"
      aria-label={image.alt}
    >
      {picture?.state === 'refused' ? picture.reason : 'Loading…'}
    </div>
  );
}

function Item({
  item,
  showcase,
  pictures,
  larger,
  onOpen,
}: {
  item: ShowcaseItem;
  showcase: RsShowcase;
  pictures: Record<string, ShowcasePicture>;
  /** The picture shown larger (null: none). */
  larger: string | null;
  onOpen: (name: string | null) => void;
}) {
  switch (item.kind) {
    case 'text':
      return (
        <div
          className="prs-pg-text"
          data-rs-pathgrade-item="text"
        >
          {paragraphs(item.text).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    case 'facts':
      return (
        <dl
          className="prs-pg-facts"
          data-rs-pathgrade-item="facts"
        >
          {item.facts.map((f, i) => (
            <React.Fragment key={i}>
              <dt>{f.label}</dt>
              <dd>{f.display}</dd>
            </React.Fragment>
          ))}
        </dl>
      );
    case 'table':
      return (
        <div
          className="prs-pg-tablewrap"
          data-rs-pathgrade-item="table"
        >
          <table className="prs-pg-table">
            {item.caption ? <caption>{item.caption}</caption> : null}
            <thead>
              <tr>
                {item.columns.map((c, i) => (
                  <th
                    key={i}
                    scope="col"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {item.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'figure':
      return (
        <figure
          className="prs-pg-figure"
          data-rs-pathgrade-item="figure"
        >
          <div className="prs-pg-row">
            {item.panels.map(p => {
              const image = showcase.images.find(i => i.name === p.image)!;
              return (
                <figure
                  key={p.image}
                  className="prs-pg-panel"
                >
                  <Picture
                    image={image}
                    picture={pictures[p.image]}
                    onOpen={() => onOpen(p.image)}
                  />
                  {p.caption ? <figcaption>{p.caption}</figcaption> : null}
                </figure>
              );
            })}
          </div>
          {larger && item.panels.some(p => p.image === larger) && pictures[larger]?.url ? (
            <Larger
              image={showcase.images.find(i => i.name === larger)!}
              caption={item.panels.find(p => p.image === larger)?.caption ?? ''}
              url={pictures[larger].url as string}
              onClose={() => onOpen(null)}
            />
          ) : null}
          {item.caption ? (
            <figcaption className="prs-pg-figcaption">{item.caption}</figcaption>
          ) : null}
        </figure>
      );
    default:
      return null;
  }
}

/** A picture shown larger, under its figure's row; its Close button (or Escape) closes it. */
function Larger({
  image,
  caption,
  url,
  onClose,
}: {
  image: ShowcaseImage;
  caption: string;
  url: string;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), [url]);
  return (
    <div
      className="prs-pg-larger"
      role="group"
      aria-label={`${image.alt}, larger`}
      data-rs-pathgrade-larger={image.name}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <img
        src={url}
        alt={image.alt}
        width={image.width}
        height={image.height}
      />
      {caption ? <div className="prs-pg-larger-caption">{caption}</div> : null}
      <button
        ref={close}
        type="button"
        className="prs-btn"
        onClick={onClose}
      >
        Close
      </button>
    </div>
  );
}

export function PathGradeTab({
  store,
  evidence,
}: {
  store: ShowcaseStore;
  evidence: RsEvidenceView | null;
}) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [larger, setLarger] = useState<string | null>(null);
  // Read when the tab is first shown (and again after a read that failed, on Try again).
  useEffect(() => store.open(), [store]);

  if (snap.phase !== 'ready' || !snap.showcase) {
    return (
      <div
        className="prs-pathgrade"
        data-rs-pathgrade={snap.phase}
      >
        <div
          className="prs-empty"
          data-rs-pathgrade-reason=""
        >
          {snap.phase === 'idle' || snap.phase === 'loading'
            ? 'Reading PathGrade’s showcase…'
            : snap.reason}
        </div>
        {snap.phase === 'failed' ? (
          <button
            type="button"
            className="prs-btn"
            data-rs-pathgrade-retry=""
            onClick={() => store.open()}
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  const s = snap.showcase;
  const strips = studyStrips(evidence);
  return (
    <div
      className="prs-pathgrade"
      data-rs-pathgrade="ready"
    >
      <div
        className="prs-pg-banner"
        role="note"
        data-rs-pathgrade-notice=""
      >
        {s.notice}
      </div>
      <div
        className="prs-pg-credit"
        data-rs-pathgrade-credit=""
      >
        {creditLine(s.cohort)}
      </div>
      <h3 className="prs-pg-title">{s.title}</h3>
      <section
        className="prs-pg-section"
        data-rs-pathgrade-study=""
      >
        <h4>This study</h4>
        {evidence === null ? (
          <p className="prs-pg-quiet">This study’s evidence view could not be read.</p>
        ) : strips.length ? (
          <ul className="prs-pg-strips">
            {strips.map((x, i) => (
              <li
                key={i}
                data-rs-pathgrade-strip=""
              >
                <span className="prs-pg-finding">{x.finding}</span>
                {x.display}
              </li>
            ))}
          </ul>
        ) : (
          <p className="prs-pg-quiet">No finding in this study has a reference-case strip.</p>
        )}
      </section>
      {s.sections.map(section => (
        <section
          key={section.id}
          className="prs-pg-section"
          data-rs-pathgrade-section={section.id}
        >
          <h4>{section.title}</h4>
          {section.items.map((item, i) => (
            <Item
              key={i}
              item={item}
              showcase={s}
              pictures={snap.pictures}
              larger={larger}
              onOpen={setLarger}
            />
          ))}
          {section.unknownItems ? (
            <p className="prs-pg-quiet">
              {section.unknownItems === 1
                ? 'One item here is of a kind this viewer does not show.'
                : `${section.unknownItems} items here are of a kind this viewer does not show.`}
            </p>
          ) : null}
        </section>
      ))}
      {s.sources.length ? (
        <details
          className="prs-pg-sources"
          data-rs-pathgrade-sources=""
        >
          <summary>Built from</summary>
          <ul>
            {s.sources.map((src, i) => (
              <li key={i}>
                {src.kind}: {src.name}
                {src.sha256 ? ` (sha256 ${src.sha256.slice(0, 12)}…)` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
