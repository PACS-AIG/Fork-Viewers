/**
 * RS-36: the CT reading system's output contract, as the viewer reads it.
 *
 * PACS-AIG/ct-analysis-system compiles each CT's complete report and publishes
 * it through a versioned contract (`pacsai.reading/1.x`): the report in two
 * versions (the published draft and the latest evidence), the inbox and its
 * change list, the revisions with their Undo records, and the per-finding
 * evidence a Copilot shows. The viewer reads those documents and posts typed
 * reader events back (POST /events). It imports nothing from that repository:
 * these are only the fields the reading-system pane uses, typed from the
 * contract's published schemas, and a reader of an older minor ignores fields
 * it does not know.
 *
 * The contract's rules for a consumer, enforced by `checkDocument`:
 *   - refuse a document whose `contractVersion` names another major;
 *   - refuse a document whose `mode` is not the viewer's (a clinical viewer
 *     never shows a fixture document, and the other way round);
 *   - a document must be the artifact the route serves.
 *
 * Pure: no window, React or OHIF here.
 */

export const CONTRACT_PREFIX = 'pacsai.reading/';
export const CONTRACT_MAJOR = 1;

export type RsMode = 'clinical' | 'fixture';
export type ReportVersion = 'published' | 'latest';
export type Owner = 'machine' | 'clinician';

/** The envelope every published document carries. */
export interface RsEnvelope {
  contractVersion: string;
  artifact: string;
  snapshotId: string | null;
  studyUID: string | null;
  bundleHash: string;
  mode: RsMode;
}

// ---- report ---------------------------------------------------------------------

export interface RsPassage {
  id: string;
  section: string;
  owner: Owner;
  text: string;
  sentenceIds?: string[];
  boundEntries?: string[];
}

export interface RsSection {
  id: string;
  title: string;
  passageIds: string[];
}

/** One entry of the chrome's pending tasks: a bare string names a pending task. */
export type RsPendingTask =
  | string
  | { task: string; status?: 'pending' | 'running' | 'failed' | 'unavailable' };

export interface RsUnrenderedEntry {
  entryId: string;
  code: string;
  reason: string;
  status: 'withheld' | 'available' | 'grouped';
}

export interface RsWithheldNode {
  nodeId: string;
  entryId: string;
  code: string;
  reason: string;
  critical: boolean;
}

export interface RsFailure {
  code: string;
  detail: string;
  where: string;
}

/** Pending work, the comparison state, the Impression verdicts and the flagged
 *  phases: shown in the chrome, never in prose (the system's invariant 1). */
export interface RsChrome {
  pending: { sections?: string[]; tasks?: RsPendingTask[]; withheld?: RsUnrenderedEntry[] };
  comparison: { state: string; label?: string | null; unlinked?: string[] };
  impression: {
    complete: boolean;
    sound: boolean;
    style: 'not_requested' | 'unavailable' | 'proposed' | 'rejected';
    withheld?: RsWithheldNode[];
    failures?: RsFailure[];
  };
  phase?: { flagged?: Array<{ phase: string; flags: string[]; seriesUID?: string }> };
}

export interface RsReport extends RsEnvelope {
  artifact: 'report';
  /** A report always belongs to a study and the snapshot it was compiled from. */
  snapshotId: string;
  studyUID: string;
  version: ReportVersion;
  revision: number;
  epoch: number;
  protocol: string;
  sections: { meta: RsSection[]; findings: RsSection[]; impression: RsSection };
  passages: RsPassage[];
  chrome: RsChrome;
  text: string;
}

// ---- inbox ----------------------------------------------------------------------

export interface RsTextChange {
  passageId: string;
  section?: string | null;
  before?: string | null;
  after?: string | null;
  ownerBefore?: string | null;
  ownerAfter?: string | null;
}

export interface RsSideChange {
  entryId: string;
  before?: string | null;
  after?: string | null;
}

export interface RsClaimDelta {
  entryId?: string | null;
  property:
    | 'presence'
    | 'measurement'
    | 'class'
    | 'location'
    | 'sentence'
    | 'required'
    | 'impression';
  before?: unknown;
  after?: unknown;
}

/** A three-way patch for a reader-owned passage: base is the machine text the
 *  reader's wording came from, ours the reader's text, theirs the new machine
 *  text. Never applied without an explicit reader action. */
export interface RsPatchProposal {
  target: string;
  passageId: string;
  status: 'no_change' | 'clean' | 'conflict' | 'review';
  base?: string | null;
  ours: string;
  theirs: string;
  proposed?: string | null;
}

export interface RsInboxEntry {
  id: string;
  kind: 'update' | 'alternative_evidence';
  entryIds: string[];
  updates: string[];
  claims: RsClaimDelta[];
  summary: string;
  preview?: RsTextChange[];
  patches?: RsPatchProposal[];
  acceptable?: boolean;
  reason?: string | null;
}

export interface RsChangeList {
  added?: RsTextChange[];
  changed?: RsTextChange[];
  deleted?: RsTextChange[];
  sidesChanged?: RsSideChange[];
}

export interface RsInbox extends RsEnvelope {
  artifact: 'inbox';
  entries: RsInboxEntry[];
  rejected: string[];
  changeList: RsChangeList;
}

// ---- versions -------------------------------------------------------------------

export interface RsVersionPointer {
  revision: number;
  epoch: number;
  snapshotId: string;
}

/** One intention as the record holds it, with its inverse (the Undo record). */
export interface RsRevisionRecord {
  revision: number;
  revisionId: string;
  origin: string;
  readerId: string;
  operation: { op?: string; [key: string]: unknown };
  texts?: RsTextChange[];
  undoes?: string | null;
  undoneBy?: string | null;
}

export interface RsVersions extends RsEnvelope {
  artifact: 'versions';
  opened: boolean;
  signed: boolean;
  published: RsVersionPointer;
  latest: RsVersionPointer;
  revisions: RsRevisionRecord[];
  pendingUpdates: string[];
  patches: RsPatchProposal[];
}

// ---- evidence view (what the Copilot shows) ----------------------------------------

export interface RsCanonical {
  kind?: string | null;
  value?: number | null;
  display?: number | null;
  units?: string | null;
  range?: number[] | null;
  recipeId?: string | null;
  statistic?: string | null;
  hu?: number | null;
  huDisplay?: number | null;
  phase?: string | null;
  direction?: string | null;
}

export interface RsSource {
  type?: string;
  producer?: string;
  classHypothesis?: string | null;
  score?: number | null;
}

export interface RsClassAlternative {
  className: string;
  detectorClass: string;
  proposalId: string;
  reportedAs: 'critical' | 'reportable';
  gate?: string;
  model?: string | null;
  score?: number | null;
}

export interface RsQuestion {
  order?: number;
  group?: string;
  id?: string;
  kind?: string;
  entryId?: string;
  sentenceId?: string;
  predicate?: string;
}

export interface RsFindingEvidence {
  entryId: string;
  sentenceId: string;
  kind: string;
  section: string;
  tier: string;
  critical: boolean;
  sources?: RsSource[];
  disagreement?: Array<{ source?: string; classHypothesis?: string | null }>;
  canonical?: RsCanonical | null;
  classState?: string | null;
  className?: string | null;
  branches?: Record<string, { state?: string; unresolved?: string[]; reason?: string }>;
  unresolvedPredicates?: string[];
  comparison?: {
    form?: string | null;
    rendered?: boolean;
    refusedReason?: string | null;
    priorValue_mm?: number | null;
    priorDate?: string | null;
    currentValue_mm?: number | null;
  } | null;
  classAlternatives?: RsClassAlternative[];
  questions?: RsQuestion[];
  pending?: unknown[];
  signing?: {
    requiresAcknowledgementAgainstDisplayedRevision?: boolean;
    requiresDisposition?: boolean;
  };
}

export interface RsEvidenceView extends RsEnvelope {
  artifact: 'evidence_view';
  findings: RsFindingEvidence[];
  study: {
    processingPanel: Array<{
      region: string;
      methodFamily: string;
      adequate: boolean;
      text: string;
    }>;
    questions?: unknown;
  };
}

/** The snapshot document, read only for the patient key the events carry. */
export interface RsSnapshotDocument extends RsEnvelope {
  artifact: 'snapshot';
  snapshot: { patientKey: string };
}

// ---- event intake -----------------------------------------------------------------

export type IntakeStatus =
  | 'applied'
  | 'question'
  | 'proposal'
  | 'recorded'
  | 'ignored'
  | 'rejected'
  | 'conflict'
  | 'signed';

export interface RsIntakeResponse {
  contractVersion: string;
  artifact: 'intake_response';
  eventId: string;
  studyUID: string;
  status: IntakeStatus;
  httpStatus: 200 | 409 | 422;
  revision: number;
  revisionIds?: string[];
  currentRevision?: number | null;
  reason?: string | null;
}

// ---- the consumer's rules --------------------------------------------------------

/** A document this viewer will not use; the message says why, in words a reader can act on. */
export class RsRefused extends Error {
  readonly why: string;
  constructor(why: string) {
    super(why);
    this.name = 'RsRefused';
    this.why = why;
  }
}

/** The major of a `pacsai.reading/<major>.<minor>` version, or null when it is not one. */
export function contractMajor(version: unknown): number | null {
  if (typeof version !== 'string' || !version.startsWith(CONTRACT_PREFIX)) {
    return null;
  }
  const m = /^(\d+)\.(\d+)$/.exec(version.slice(CONTRACT_PREFIX.length));
  return m ? Number(m[1]) : null;
}

/**
 * The document, checked against the contract's rules for a consumer: this
 * major, this viewer's mode and the expected artifact. Throws RsRefused.
 */
export function checkDocument<T extends RsEnvelope>(
  doc: unknown,
  artifact: string,
  mode: RsMode
): T {
  if (!doc || typeof doc !== 'object') {
    throw new RsRefused(
      `The CT analysis service sent something that is not a ${artifact} document.`
    );
  }
  const d = doc as Partial<RsEnvelope>;
  const major = contractMajor(d.contractVersion);
  if (major !== CONTRACT_MAJOR) {
    throw new RsRefused(
      `The CT analysis service publishes contract ${String(d.contractVersion)}; this viewer reads ${CONTRACT_PREFIX}${CONTRACT_MAJOR}.x.`
    );
  }
  if (d.mode !== mode) {
    throw new RsRefused(
      `The CT analysis service publishes ${String(d.mode)} documents; this viewer reads ${mode} ones.`
    );
  }
  if (d.artifact !== artifact) {
    throw new RsRefused(`Expected a ${artifact} document, received ${String(d.artifact)}.`);
  }
  return doc as T;
}
