/**
 * RS-36: what the reading-system pane shows, from the contract's documents.
 *
 *   - the draft: the published report's sections and passages, in the
 *     report's own order; a passage bound to a finding is selectable (a click
 *     selects it and opens nothing: the system's invariant 16);
 *   - the chrome: pending work, the comparison state, the Impression's
 *     verdicts and flagged phases, as short lines beside the draft, never in
 *     its prose (invariant 1);
 *   - the inbox: one entry per material change, its claims and its exact
 *     consequence preview (sentence before and after), and any three-way patch
 *     of the reader's own wording;
 *   - the change list: the published draft against the latest evidence;
 *   - the revisions of the published draft, newest first, each with Undo;
 *   - the Copilot's card for one finding: the canonical measurement, its
 *     sources and their disagreement, the pathway branches and the predicates
 *     still unresolved, the comparison form, the class alternatives and the
 *     fixed-order questions.
 *
 * Every word here is the pane's chrome, never report prose; numbers and class
 * names are the documents' own. Pure: no window, React or OHIF here.
 */
import type {
  RsCanonical,
  RsChangeList,
  RsClaimDelta,
  RsEvidenceView,
  RsInbox,
  RsPassage,
  RsReport,
  RsSection,
  RsTextChange,
  RsVersions,
} from './rsContract';
import type { RsSelection } from './rsEvents';

/** snake_case ids as words ('portal_venous' -> 'portal venous'). */
export const words = (id: unknown): string =>
  String(id ?? '')
    .replace(/_/g, ' ')
    .trim();
/** As words, the first letter capitalized, for a label. */
export const label = (id: unknown): string => {
  const w = words(id);
  return w ? w[0].toUpperCase() + w.slice(1) : w;
};

// ---- the draft --------------------------------------------------------------------

export interface DraftPassage {
  id: string;
  text: string;
  owner: 'machine' | 'clinician';
  section: string;
  sentenceId: string | null;
  entryId: string | null;
  selectable: boolean;
}

export interface DraftSection {
  id: string;
  title: string;
  group: 'meta' | 'findings' | 'impression';
  passages: DraftPassage[];
}

export interface DraftView {
  revision: number;
  epoch: number;
  sections: DraftSection[];
  /** The selectable passages in reading order, for the arrow keys. */
  selectable: DraftPassage[];
}

const toDraftPassage = (p: RsPassage): DraftPassage => {
  const entryId = p.boundEntries?.[0] ?? null;
  const sentenceId = p.sentenceIds?.[0] ?? null;
  return {
    id: p.id,
    text: p.text,
    owner: p.owner,
    section: p.section,
    sentenceId,
    entryId,
    selectable: entryId !== null || sentenceId !== null,
  };
};

export function draftView(report: RsReport): DraftView {
  const byId = new Map(report.passages.map(p => [p.id, p]));
  const sectionOf = (s: RsSection, group: DraftSection['group']): DraftSection => ({
    id: s.id,
    title: s.title,
    group,
    passages: s.passageIds
      .map(id => byId.get(id))
      .filter((p): p is RsPassage => Boolean(p))
      .map(toDraftPassage),
  });
  const sections: DraftSection[] = [
    ...report.sections.meta.map(s => sectionOf(s, 'meta')),
    // As the report's own text: a Findings section with nothing to say is left out.
    ...report.sections.findings.map(s => sectionOf(s, 'findings')).filter(s => s.passages.length),
    sectionOf(report.sections.impression, 'impression'),
  ];
  return {
    revision: report.revision,
    epoch: report.epoch,
    sections,
    selectable: sections.flatMap(s => s.passages).filter(p => p.selectable),
  };
}

export const selectionOf = (p: DraftPassage): RsSelection => ({
  entryId: p.entryId,
  passageId: p.id,
  sentenceId: p.sentenceId,
});

/** The section titles of a report by id, for change lines. */
export function sectionTitles(report: RsReport | null): Map<string, string> {
  const titles = new Map<string, string>();
  if (!report) {
    return titles;
  }
  for (const s of [
    ...report.sections.meta,
    ...report.sections.findings,
    report.sections.impression,
  ]) {
    titles.set(s.id, s.title);
  }
  return titles;
}

// ---- the chrome ---------------------------------------------------------------------

export interface ChromeLine {
  key: string;
  text: string;
  tone: 'muted' | 'pending' | 'warn';
  title?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function chromeLines(report: RsReport): ChromeLine[] {
  const lines: ChromeLine[] = [];
  const { pending, comparison, impression, phase } = report.chrome;
  const titles = sectionTitles(report);
  for (const t of pending.tasks ?? []) {
    const task = typeof t === 'string' ? t : t.task;
    const status = typeof t === 'string' ? 'pending' : (t.status ?? 'pending');
    lines.push({
      key: `task:${task}`,
      text: `${label(task)}: ${words(status)}`,
      tone: status === 'failed' || status === 'unavailable' ? 'warn' : 'pending',
    });
  }
  if (pending.sections?.length) {
    lines.push({
      key: 'sections',
      text: `Waiting on pending work: ${pending.sections.map(s => titles.get(s) ?? words(s)).join(', ')}`,
      tone: 'pending',
    });
  }
  const withheld = (pending.withheld ?? []).filter(e => e.status === 'withheld');
  if (withheld.length) {
    lines.push({
      key: 'withheld',
      text: `${plural(withheld.length, 'statement', 'statements')} held back`,
      tone: 'pending',
      title: withheld.map(e => e.reason).join('\n'),
    });
  }
  if (comparison.state && comparison.state !== 'complete') {
    lines.push({
      key: 'comparison',
      text: `Comparison ${words(comparison.state)}`,
      tone: 'pending',
    });
  }
  if (comparison.unlinked?.length) {
    lines.push({
      key: 'unlinked',
      text: `${plural(comparison.unlinked.length, 'prior', 'priors')} unlinked`,
      tone: 'muted',
    });
  }
  if (comparison.label) {
    lines.push({ key: 'comparison-label', text: comparison.label, tone: 'muted' });
  }
  if (!impression.complete) {
    lines.push({ key: 'impression-incomplete', text: 'Impression incomplete', tone: 'warn' });
  }
  if (!impression.sound) {
    const failures = impression.failures?.length ?? 0;
    lines.push({
      key: 'impression-unsound',
      text: failures
        ? `Impression failed its check (${plural(failures, 'failure', 'failures')})`
        : 'Impression failed its check',
      tone: 'warn',
      title: (impression.failures ?? []).map(f => f.detail).join('\n') || undefined,
    });
  }
  const withheldNodes = impression.withheld ?? [];
  if (withheldNodes.length) {
    lines.push({
      key: 'impression-withheld',
      text: `${plural(withheldNodes.length, 'Impression item', 'Impression items')} withheld`,
      tone: withheldNodes.some(n => n.critical) ? 'warn' : 'muted',
      title: withheldNodes.map(n => n.reason).join('\n'),
    });
  }
  for (const [i, f] of (phase?.flagged ?? []).entries()) {
    // The series is named by its phase, never by its UID.
    lines.push({
      key: `phase:${i}`,
      text: `Check the ${words(f.phase)} series${f.flags?.length ? `: ${f.flags.map(words).join(', ')}` : ''}`,
      tone: 'warn',
    });
  }
  return lines;
}

// ---- the inbox and the change list --------------------------------------------------

export interface ChangeLine {
  passageId: string;
  sectionTitle: string;
  before: string | null;
  after: string | null;
}

export interface PatchView {
  passageId: string;
  sectionTitle: string;
  status: string;
  ours: string;
  theirs: string;
}

export interface InboxEntryView {
  id: string;
  kindLabel: string;
  summary: string;
  claims: string[];
  preview: ChangeLine[];
  patches: PatchView[];
  acceptable: boolean;
  reason: string | null;
}

const changeLine = (c: RsTextChange, titles: Map<string, string>): ChangeLine => ({
  passageId: c.passageId,
  sectionTitle: c.section ? (titles.get(c.section) ?? label(c.section)) : '',
  before: c.before ?? null,
  after: c.after ?? null,
});

/** A claim's value in words: a measurement as its number and units, nothing as "none". */
export function claimValue(v: unknown): string {
  if (v === null || v === undefined) {
    return 'none';
  }
  if (typeof v !== 'object') {
    return words(v);
  }
  const o = v as Record<string, unknown>;
  if ('value' in o) {
    const units = typeof o.units === 'string' ? ` ${o.units}` : '';
    return `${String(o.value)}${units}`;
  }
  return Object.entries(o)
    .map(([k, x]) => `${words(k)} ${claimValue(x)}`)
    .join(', ');
}

export const claimText = (c: RsClaimDelta): string =>
  `${label(c.property)}: ${claimValue(c.before)} → ${claimValue(c.after)}`;

const KIND_LABEL: Record<string, string> = {
  update: 'Update',
  alternative_evidence: 'Alternative evidence',
};

export function inboxView(inbox: RsInbox, report: RsReport | null): InboxEntryView[] {
  const titles = sectionTitles(report);
  return inbox.entries.map(e => ({
    id: e.id,
    kindLabel: KIND_LABEL[e.kind] ?? label(e.kind),
    summary: e.summary,
    claims: (e.claims ?? []).map(claimText),
    preview: (e.preview ?? []).map(c => changeLine(c, titles)),
    patches: (e.patches ?? []).map(p => ({
      passageId: p.passageId,
      sectionTitle:
        titles.get(report?.passages.find(x => x.id === p.passageId)?.section ?? '') ?? '',
      status: p.status,
      ours: p.ours,
      theirs: p.theirs,
    })),
    acceptable: e.acceptable !== false,
    reason: e.reason ?? null,
  }));
}

export interface ChangeGroup {
  key: 'added' | 'changed' | 'deleted' | 'sides';
  label: string;
  lines: ChangeLine[];
}

export function changeListView(cl: RsChangeList, report: RsReport | null): ChangeGroup[] {
  const titles = sectionTitles(report);
  const groups: ChangeGroup[] = [
    { key: 'added', label: 'Lines added', lines: (cl.added ?? []).map(c => changeLine(c, titles)) },
    {
      key: 'changed',
      label: 'Lines changed',
      lines: (cl.changed ?? []).map(c => changeLine(c, titles)),
    },
    {
      key: 'deleted',
      label: 'Lines deleted',
      lines: (cl.deleted ?? []).map(c => changeLine(c, titles)),
    },
    {
      key: 'sides',
      label: 'Sides changed',
      lines: (cl.sidesChanged ?? []).map(s => ({
        passageId: s.entryId,
        sectionTitle: '',
        before: s.before ?? null,
        after: s.after ?? null,
      })),
    },
  ];
  return groups.filter(g => g.lines.length);
}

// ---- the revisions ------------------------------------------------------------------------

export interface RevisionView {
  revisionId: string;
  revision: number;
  label: string;
  undone: boolean;
  /** The reader may undo it: an intention not undone, and not itself an Undo. */
  undoable: boolean;
}

const OPERATION_LABEL: Record<string, string> = {
  accept_entry: 'Accepted an inbox update',
  reject_entry: 'Rejected an inbox update',
};

export function revisionsView(versions: RsVersions): RevisionView[] {
  const byId = new Map(versions.revisions.map(r => [r.revisionId, r]));
  return [...versions.revisions]
    .sort((a, b) => b.revision - a.revision)
    .map(r => {
      const op = String(r.operation?.op ?? r.origin ?? '');
      const isUndo = op === 'undo' || Boolean(r.undoes);
      const target = r.undoes ? byId.get(r.undoes) : undefined;
      return {
        revisionId: r.revisionId,
        revision: r.revision,
        label: isUndo
          ? `Undid revision ${target ? target.revision : ''}`.trim()
          : (OPERATION_LABEL[op] ?? label(op || 'edit')),
        undone: Boolean(r.undoneBy),
        undoable: !isUndo && !r.undoneBy,
      };
    });
}

// ---- the Copilot ----------------------------------------------------------------------

export interface CopilotView {
  entryId: string;
  heading: string;
  facts: Array<{ label: string; value: string }>;
  sources: string[];
  disagreement: string[];
  branches: string[];
  unresolved: string[];
  comparison: string | null;
  alternatives: Array<{ proposalId: string; text: string }>;
  questions: string[];
  signing: string[];
  processing: string[];
}

const fmtNumber = (n: unknown): string =>
  typeof n === 'number' && Number.isFinite(n) ? String(n) : String(n ?? '');

/** The canonical measurement as one line: the number, its statistic and phase, and how it was made. */
export function canonicalLine(c: RsCanonical): string | null {
  const value = c.display ?? c.value;
  const parts: string[] = [];
  if (value !== null && value !== undefined) {
    parts.push(`${fmtNumber(value)}${c.units ? ` ${c.units}` : ''}`);
  }
  const hu = c.huDisplay ?? c.hu;
  if (hu !== null && hu !== undefined) {
    parts.push(`${c.statistic ? `${c.statistic} ` : ''}${fmtNumber(hu)} HU`);
  } else if (c.statistic) {
    parts.push(c.statistic);
  }
  if (c.phase) {
    parts.push(`${words(c.phase)} phase`);
  }
  if (c.kind) {
    parts.push(words(c.kind));
  }
  if (Array.isArray(c.range) && c.range.length === 2) {
    parts.push(
      `range ${fmtNumber(c.range[0])}–${fmtNumber(c.range[1])}${c.units ? ` ${c.units}` : ''}`
    );
  }
  return parts.length ? parts.join(' · ') : null;
}

export function copilotView(ev: RsEvidenceView, entryId: string | null): CopilotView | null {
  if (!entryId) {
    return null;
  }
  const f = ev.findings.find(x => x.entryId === entryId);
  if (!f) {
    return null;
  }
  const facts: CopilotView['facts'] = [{ label: 'Section', value: label(f.section) }];
  facts.push({
    label: 'Class',
    value: f.className ? f.className : f.classState ? `none (${words(f.classState)})` : 'none',
  });
  const measured = f.canonical ? canonicalLine(f.canonical) : null;
  if (measured) {
    facts.push({ label: 'Measurement', value: measured });
  }
  if (f.canonical?.recipeId) {
    facts.push({ label: 'Recipe', value: f.canonical.recipeId });
  }
  const comparison = f.comparison?.form
    ? [
        label(f.comparison.form),
        f.comparison.priorValue_mm !== null && f.comparison.priorValue_mm !== undefined
          ? `${f.comparison.priorValue_mm} mm on ${f.comparison.priorDate ?? 'the prior'}`
          : null,
        f.comparison.currentValue_mm !== null && f.comparison.currentValue_mm !== undefined
          ? `${f.comparison.currentValue_mm} mm on this study`
          : null,
        f.comparison.rendered === false && f.comparison.refusedReason
          ? `not rendered: ${words(f.comparison.refusedReason)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const signing: string[] = [];
  if (f.signing?.requiresAcknowledgementAgainstDisplayedRevision) {
    signing.push('Needs an acknowledgement against the displayed revision');
  }
  if (f.signing?.requiresDisposition) {
    signing.push('Needs a disposition');
  }
  return {
    entryId: f.entryId,
    heading: [label(f.kind), words(f.tier), f.critical ? 'critical' : null]
      .filter(Boolean)
      .join(' · '),
    facts,
    sources: (f.sources ?? []).map(s =>
      [
        `${label(s.type)}${s.producer ? ` (${s.producer})` : ''}`,
        s.classHypothesis ? `: ${s.classHypothesis}` : '',
        s.score !== null && s.score !== undefined ? `, score ${fmtNumber(s.score)}` : '',
      ].join('')
    ),
    disagreement: (f.disagreement ?? []).map(
      d => `${d.source ?? 'a source'} says ${d.classHypothesis ?? 'otherwise'}`
    ),
    branches: Object.entries(f.branches ?? {}).map(([id, b]) =>
      [
        `${words(id)}: ${words(b.state ?? 'unknown')}`,
        b.unresolved?.length ? ` (unresolved: ${b.unresolved.map(words).join(', ')})` : '',
        b.reason ? ` (${words(b.reason)})` : '',
      ].join('')
    ),
    unresolved: (f.unresolvedPredicates ?? []).map(words),
    comparison: comparison || null,
    alternatives: (f.classAlternatives ?? []).map(a => ({
      proposalId: a.proposalId,
      text: [
        a.className,
        ` (${words(a.reportedAs)}`,
        a.model ? `, ${a.model}` : '',
        a.score !== null && a.score !== undefined ? `, score ${fmtNumber(a.score)}` : '',
        ')',
      ].join(''),
    })),
    questions: [...(f.questions ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(q => `${label(q.kind)}${q.predicate ? `: ${words(q.predicate)}` : ''}`),
    signing,
    processing: (ev.study?.processingPanel ?? []).map(p => p.text),
  };
}
