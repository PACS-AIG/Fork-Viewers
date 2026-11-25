/**
 * RS-36: the pane's PathGrade tab: this study's PathGrade results, and
 * nothing else (WeiWei, 25 Nov 2026: "it only needs to show data related to
 * the current case"; the reading system's D-344).
 *
 * A finding's reference-case strip (the evidence view, FINAL_SPEC §2.14) is
 * held when a qualified characterizer exists for the finding's class: that
 * is a PathGrade result. The tab is there only when at least one finding has
 * one (hidden otherwise: "Yes, hide it"), and lists those findings with the
 * strip as the evidence view words it. An empty strip ("empty: no licensed
 * cohort") is no PathGrade result, and neither is none.
 *
 * Nothing here is report content, and nothing reaches the report or the
 * editor.
 */
import React from 'react';
import type { RsEvidenceView } from '../rsContract';
import { label } from '../rsModel';

/** A strip in this state is a PathGrade result: a qualified characterizer exists for the class. */
export const HELD = 'held';

/** This study's findings with a held reference-case strip, as the tab lists them. */
export function heldStrips(
  evidence: RsEvidenceView | null | undefined
): Array<{ finding: string; display: string }> {
  return (evidence?.findings ?? [])
    .filter(f => f.referenceCaseStrip?.state === HELD)
    .map(f => ({
      finding: [label(f.kind), f.className].filter(Boolean).join(' · '),
      display: f.referenceCaseStrip!.display,
    }));
}

export function PathGradeTab({ evidence }: { evidence: RsEvidenceView | null | undefined }) {
  const held = heldStrips(evidence);
  return (
    <div
      className="prs-pathgrade"
      data-rs-pathgrade=""
    >
      <ul className="prs-pg-strips">
        {held.map((x, i) => (
          <li
            key={i}
            data-rs-pathgrade-strip=""
          >
            <span className="prs-pg-finding">{x.finding}</span>
            {x.display}
          </li>
        ))}
      </ul>
    </div>
  );
}
