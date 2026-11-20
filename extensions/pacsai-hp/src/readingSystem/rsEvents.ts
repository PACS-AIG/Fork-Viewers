/**
 * RS-36: typed reader events for the reading system's event intake (POST
 * /events, contract `intake_event`).
 *
 * Every event carries a fresh event id (a retry of the same event reuses it,
 * and the system applies it once), the window's session, the reader, the
 * study and its patient key (checked against the study: the system's
 * invariant 21). An event that changes the draft also names the published
 * revision it was made against (`baseRevision`; another reader edit since is
 * answered 409 with the current revision) and its capture: the revision and
 * the selection the reader had when they acted.
 *
 * Pure: the clock and the id source are handed in.
 */
/** The event kinds that change the draft (the contract's DRAFT_CHANGING). */
export const DRAFT_CHANGING = [
  'edit',
  'reader_text',
  'affirm',
  'accept',
  'reject',
  'answer',
  'keep_wording',
  'apply_patch',
  'undo',
] as const;

/** The contract minor the events are written in when no document has been read yet. */
export const DEFAULT_EVENT_CONTRACT = 'pacsai.reading/1.12';

export interface RsSelection {
  entryId: string | null;
  passageId: string | null;
  sentenceId: string | null;
}

export type RsEventBody =
  | { type: 'opened' }
  | { type: 'accept'; target: { kind: 'inbox_entry' | 'proposal'; id: string } }
  | { type: 'reject'; target: { kind: 'inbox_entry' | 'proposal'; id: string } }
  | { type: 'undo'; revisionId: string | null }
  | { type: 'keep_wording'; passageId: string }
  | { type: 'apply_patch'; passageId: string };

export interface RsEventContext {
  studyUID: string;
  patientKey: string;
  reader: { id: string; role: string };
  sessionId: string;
  /** The contract version of the documents read, so the events are in the server's own minor. */
  contractVersion?: string;
}

export interface RsEventOptions {
  /** The published revision displayed; required for an event that changes the draft. */
  baseRevision?: number | null;
  selection?: RsSelection | null;
  currentSection?: string | null;
  eventId: string;
  now: Date;
}

export interface RsIntakeEvent {
  contractVersion: string;
  artifact: 'intake_event';
  eventId: string;
  sessionId: string;
  reader: { id: string; role: string };
  clientTimestamp: string;
  studyUID: string;
  context: { patientKey: string; frameOfReferenceUID?: string | null };
  event: RsEventBody;
  baseRevision?: number;
  capture?: {
    reportRevision: number;
    selection: RsSelection | null;
    currentSection: string | null;
    alternativesVersion: null;
  };
}

export const changesDraft = (body: RsEventBody): boolean =>
  (DRAFT_CHANGING as readonly string[]).includes(body.type);

/**
 * One intake event. An event that changes the draft without a base revision is
 * a programming error here, never a request: the system would refuse it.
 */
export function buildIntakeEvent(
  ctx: RsEventContext,
  body: RsEventBody,
  opts: RsEventOptions
): RsIntakeEvent {
  const doc: RsIntakeEvent = {
    contractVersion: ctx.contractVersion || DEFAULT_EVENT_CONTRACT,
    artifact: 'intake_event',
    eventId: opts.eventId,
    sessionId: ctx.sessionId,
    reader: { id: ctx.reader.id, role: ctx.reader.role },
    clientTimestamp: opts.now.toISOString(),
    studyUID: ctx.studyUID,
    context: { patientKey: ctx.patientKey },
    event: body,
  };
  if (changesDraft(body)) {
    const base = opts.baseRevision;
    if (typeof base !== 'number' || !Number.isInteger(base) || base < 0) {
      throw new Error(`a ${body.type} event names the published revision it was made against`);
    }
    doc.baseRevision = base;
    doc.capture = {
      reportRevision: base,
      selection: opts.selection ?? null,
      currentSection: opts.currentSection ?? null,
      alternativesVersion: null,
    };
  }
  return doc;
}

/** A fresh id for an event or a session: the platform's UUID where there is one. */
export function freshId(
  cryptoLike: { randomUUID?: () => string } | undefined = globalThis.crypto
): string {
  if (cryptoLike && typeof cryptoLike.randomUUID === 'function') {
    return cryptoLike.randomUUID();
  }
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}
