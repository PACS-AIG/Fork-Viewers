/**
 * RS-36: the reading-system pane's state, outside React (the pane renders it
 * through `subscribe` / `getSnapshot`).
 *
 *   - `enter(study)` reads the study's published report, versions, inbox and
 *     evidence view, and the snapshot's patient key; a study the API does not
 *     serve (404) is `not_served`, a document the contract's rules refuse is
 *     `refused`. On the first read of a study not yet opened it posts `opened`,
 *     so inference that completes later reaches the inbox instead of moving
 *     the draft (the system's invariant 5). Nothing waits for that answer: the
 *     service republishes the study before it answers, which can outlast the
 *     proxy in front of it. A request without an answer is sent again as the
 *     same event (the service records an event id once) after a growing wait,
 *     and any answer ends it.
 *   - It polls the study's versions and reads the documents again when a
 *     revision moved, so a late result or another reader's edit shows.
 *   - A click selects a sentence and opens nothing; `openCopilot` (one key)
 *     opens the Copilot on the selected finding (invariant 16).
 *   - Accept, Reject and Undo post typed events against the published revision
 *     shown; 409 (the draft moved) reads the documents again and says so, and
 *     nothing is applied twice: a retry re-sends the same event id.
 *
 * The harness reads `harnessState()`, which names the study by reference,
 * never by UID.
 */
import {
  RsRefused,
  type RsEvidenceView,
  type RsInbox,
  type RsIntakeResponse,
  type RsReport,
  type RsVersions,
} from './rsContract';
import { RsHttpError, type RsClient } from './rsClient';
import {
  buildIntakeEvent,
  type RsEventBody,
  type RsIntakeEvent,
  type RsSelection,
} from './rsEvents';
import { draftView, selectionOf, type DraftPassage } from './rsModel';

export type RsPhase = 'idle' | 'loading' | 'ready' | 'not_served' | 'refused' | 'failed';
/**
 * `anatomy`: the study's anatomy layers (anatomy/AnatomyTab), when it has them;
 * `radiomics`: its structures' research features side by side (anatomy/RadiomicsTab),
 * when any were computed;
 * `pathgrade`: its findings with a held reference-case strip (pathgrade/PathGradeTab),
 * when it has any.
 */
export type RsTab = 'anatomy' | 'radiomics' | 'draft' | 'inbox' | 'changes' | 'pathgrade';

export interface RsNotice {
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface RsDocuments {
  report: RsReport;
  versions: RsVersions;
  inbox: RsInbox;
  evidence: RsEvidenceView | null;
}

export interface RsSnapshot {
  phase: RsPhase;
  reason: string | null;
  docs: RsDocuments | null;
  selection: RsSelection | null;
  copilotOpen: boolean;
  tab: RsTab;
  collapsed: boolean;
  busy: boolean;
  notice: RsNotice | null;
  canRetry: boolean;
}

export interface RsCounts {
  reads: number;
  polls: number;
  pollFailures: number;
  /** `opened` requests sent, first or again. */
  openedTries: number;
  /** `opened` requests that got no answer. */
  openedFailures: number;
  /** `opened` requests answered. */
  openedPosts: number;
  events: number;
  applied: number;
  conflicts: number;
  rejected: number;
  failures: number;
  copilotOpens: number;
  selections: number;
}

export interface RsControllerDeps {
  client: RsClient;
  reader: () => { id: string; role: string };
  sessionId: string;
  newId: () => string;
  now: () => Date;
  pollMs: number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHidden: () => boolean;
  /** The study by reference (a digest), for the harness and logs: never the UID. */
  studyRef: (studyUID: string) => string;
  /** Told when the reader selects a finding (RS-38 jumps to its evidence). */
  onSelect?: (selection: RsSelection) => void;
}

export interface RsController {
  enter(study: string | null): void;
  leave(): void;
  getSnapshot(): RsSnapshot;
  subscribe(listener: () => void): () => void;
  select(passageId: string): void;
  moveSelection(delta: 1 | -1): void;
  openCopilot(): boolean;
  closeCopilot(): void;
  toggleCopilot(): boolean;
  setTab(tab: RsTab): void;
  /** Show this tab, unless the reader has picked one since the study opened. */
  offerTab(tab: RsTab): void;
  setCollapsed(collapsed: boolean): void;
  accept(inboxEntryId: string): Promise<void>;
  /**
   * RS-38: keep a refine's outline as the lesion's next one: accept its attempt,
   * a proposal named by its result id (D-347). The intake's answer, or null when
   * nothing was sent (no study, a post already running) or no answer came.
   */
  keepRefine(resultId: string): Promise<RsIntakeResponse | null>;
  /** RS-38: discard it: reject the attempt (optional: an attempt left alone stays recorded). */
  discardRefine(resultId: string): Promise<RsIntakeResponse | null>;
  reject(inboxEntryId: string): Promise<void>;
  undo(revisionId: string): Promise<void>;
  retry(): Promise<void>;
  dismissNotice(): void;
  harnessState(): Record<string, unknown>;
}

/** Consecutive poll failures before the pane says the service is not answering. */
export const POLL_FAILURES_BEFORE_NOTICE = 3;

/**
 * After an `opened` request got no answer, the wait before the same event goes
 * again: the service may still be recording it. The last wait repeats.
 */
export const OPENED_RETRY_MS: readonly number[] = [15_000, 30_000, 60_000, 120_000];

/** A study's `opened` in this window. */
interface OpenedTry {
  /** The one event: sent again as it is, so the service records it once. */
  doc: RsIntakeEvent;
  inFlight: boolean;
  /** Answered: recorded, or refused, which sending it again would only repeat. */
  answered: boolean;
  failures: number;
  /** No try before this time (ms). */
  notBefore: number;
}

const describe = (e: unknown): string => {
  if (e instanceof RsRefused) {
    return e.why;
  }
  if (e instanceof RsHttpError) {
    return `The CT analysis service answered HTTP ${e.status}.`;
  }
  return 'The CT analysis service did not answer.';
};

const INITIAL: RsSnapshot = {
  phase: 'idle',
  reason: null,
  docs: null,
  selection: null,
  copilotOpen: false,
  tab: 'draft',
  collapsed: false,
  busy: false,
  notice: null,
  canRetry: false,
};

export function createRsController(deps: RsControllerDeps): RsController {
  const { client } = deps;
  let state: RsSnapshot = INITIAL;
  let study: string | null = null;
  let generation = 0;
  let patientKey: string | null = null;
  let pollTimer: unknown = null;
  let pollFailures = 0;
  /** The notice on screen is the poll's "not answering" one. */
  let pollNotice = false;
  let lastFailed: { doc: RsIntakeEvent; label: string } | null = null;
  // The reader picked a tab since this study opened (offerTab then leaves it).
  let tabChosen = false;
  /** The `opened` of each study this window posted it for. */
  const openedTries = new Map<string, OpenedTry>();
  const listeners = new Set<() => void>();
  const counts: RsCounts = {
    reads: 0,
    polls: 0,
    pollFailures: 0,
    openedTries: 0,
    openedFailures: 0,
    openedPosts: 0,
    events: 0,
    applied: 0,
    conflicts: 0,
    rejected: 0,
    failures: 0,
    copilotOpens: 0,
    selections: 0,
  };

  const set = (patch: Partial<RsSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach(l => l());
  };

  const stopPolling = () => {
    if (pollTimer !== null) {
      deps.clearTimer(pollTimer);
      pollTimer = null;
    }
  };
  const schedulePoll = (gen: number) => {
    stopPolling();
    pollTimer = deps.setTimer(() => {
      pollTimer = null;
      void poll(gen);
    }, deps.pollMs);
  };

  /** The selection kept across a re-read: the same passage, else the same finding, else none. */
  const keepSelection = (report: RsReport): RsSelection | null => {
    const sel = state.selection;
    if (!sel) {
      return null;
    }
    const passages = draftView(report).selectable;
    const same =
      passages.find(p => p.id === sel.passageId) ??
      (sel.entryId ? passages.find(p => p.entryId === sel.entryId) : undefined);
    return same ? selectionOf(same) : null;
  };

  async function readAll(
    uid: string,
    gen: number,
    versions?: RsVersions
  ): Promise<RsDocuments | null> {
    counts.reads++;
    const report = await client.report(uid, 'published');
    const [v, inbox, evidence] = await Promise.all([
      versions ? Promise.resolve(versions) : client.versions(uid),
      client.inbox(uid),
      client.evidenceView(uid, 'published').catch(() => null),
    ]);
    if (patientKey === null) {
      const snap = await client.snapshot(report.snapshotId);
      patientKey = snap.snapshot?.patientKey ?? null;
    }
    return gen === generation ? { report, versions: v, inbox, evidence } : null;
  }

  async function refresh(gen: number, versions?: RsVersions): Promise<void> {
    if (!study) {
      return;
    }
    try {
      const docs = await readAll(study, gen, versions);
      if (!docs) {
        return;
      }
      const selection = keepSelection(docs.report);
      set({
        docs,
        selection,
        copilotOpen: state.copilotOpen && selection !== null,
      });
    } catch (e) {
      if (gen === generation) {
        set({ notice: { level: 'warn', text: describe(e) } });
      }
    }
  }

  /**
   * Posts the study's `opened` without holding anything up: one request at a
   * time, the same event again after an unanswered one (OPENED_RETRY_MS), and
   * nothing more once it is answered.
   */
  function ensureOpened(gen: number): void {
    const uid = study;
    const docs = state.docs;
    if (gen !== generation || !uid || !docs || docs.versions.opened || patientKey === null) {
      return;
    }
    let attempt = openedTries.get(uid);
    if (
      attempt &&
      (attempt.answered || attempt.inFlight || deps.now().getTime() < attempt.notBefore)
    ) {
      return;
    }
    if (!attempt) {
      attempt = {
        doc: buildIntakeEvent(
          {
            studyUID: uid,
            patientKey,
            reader: deps.reader(),
            sessionId: deps.sessionId,
            contractVersion: docs.report.contractVersion,
          },
          { type: 'opened' },
          { eventId: deps.newId(), now: deps.now() }
        ),
        inFlight: false,
        answered: false,
        failures: 0,
        notBefore: 0,
      };
      openedTries.set(uid, attempt);
    }
    const tried = attempt;
    tried.inFlight = true;
    counts.openedTries++;
    void client.postEvent(tried.doc).then(
      () => {
        tried.inFlight = false;
        tried.answered = true;
        counts.openedPosts++;
        if (gen === generation) {
          void refresh(gen);
        }
      },
      () => {
        tried.inFlight = false;
        tried.failures++;
        counts.openedFailures++;
        const wait = OPENED_RETRY_MS[Math.min(tried.failures, OPENED_RETRY_MS.length) - 1];
        tried.notBefore = deps.now().getTime() + wait;
      }
    );
  }

  async function poll(gen: number): Promise<void> {
    if (gen !== generation || !study || state.phase !== 'ready') {
      return;
    }
    if (deps.isHidden() || state.busy) {
      schedulePoll(gen);
      return;
    }
    counts.polls++;
    try {
      const v = await client.versions(study);
      if (gen !== generation) {
        return;
      }
      pollFailures = 0;
      if (pollNotice) {
        pollNotice = false;
        if (state.notice?.level === 'warn') {
          set({ notice: null });
        }
      }
      const now = state.docs?.versions;
      const moved =
        !now ||
        v.published.revision !== now.published.revision ||
        v.latest.revision !== now.latest.revision ||
        v.opened !== now.opened ||
        v.signed !== now.signed ||
        v.revisions.length !== now.revisions.length;
      if (moved) {
        await refresh(gen, v);
      }
      ensureOpened(gen);
    } catch (e) {
      counts.pollFailures++;
      pollFailures++;
      if (pollFailures === POLL_FAILURES_BEFORE_NOTICE && !state.busy) {
        pollNotice = true;
        set({ notice: { level: 'warn', text: describe(e) } });
      }
    }
    if (gen === generation) {
      schedulePoll(gen);
    }
  }

  async function load(uid: string, gen: number): Promise<void> {
    try {
      const docs = await readAll(uid, gen);
      if (!docs) {
        return;
      }
      set({ phase: 'ready', docs, reason: null });
    } catch (e) {
      if (gen !== generation) {
        return;
      }
      if (e instanceof RsHttpError && e.status === 404) {
        set({ phase: 'not_served', reason: null });
        return;
      }
      set({ phase: e instanceof RsRefused ? 'refused' : 'failed', reason: describe(e) });
      return;
    }
    ensureOpened(gen);
    if (gen === generation) {
      schedulePoll(gen);
    }
  }

  const currentSectionOf = (sel: RsSelection | null): string | null => {
    if (!sel?.passageId || !state.docs) {
      return null;
    }
    return state.docs.report.passages.find(p => p.id === sel.passageId)?.section ?? null;
  };

  async function post(doc: RsIntakeEvent, label: string): Promise<void> {
    await postForAnswer(doc, label);
  }

  async function postForAnswer(
    doc: RsIntakeEvent,
    label: string
  ): Promise<RsIntakeResponse | null> {
    const gen = generation;
    counts.events++;
    set({ busy: true, notice: null, canRetry: false });
    let answer;
    try {
      answer = await client.postEvent(doc);
    } catch (_) {
      counts.failures++;
      lastFailed = { doc, label };
      if (gen === generation) {
        set({
          busy: false,
          canRetry: true,
          notice: {
            level: 'error',
            text: 'The CT analysis service did not answer, so the change may not have reached it. Try again: it is applied once.',
          },
        });
      }
      return null;
    }
    lastFailed = null;
    if (gen !== generation) {
      return answer;
    }
    let notice: RsNotice;
    if (answer.status === 'applied') {
      counts.applied++;
      notice = { level: 'info', text: `${label}: the draft is at revision ${answer.revision}.` };
    } else if (answer.status === 'conflict') {
      counts.conflicts++;
      const current = answer.currentRevision ?? answer.revision;
      notice = {
        level: 'warn',
        text: `The draft moved to revision ${current} before this reached it, so nothing was applied. It shows revision ${current} now.`,
      };
    } else if (answer.status === 'rejected') {
      counts.rejected++;
      notice = {
        level: 'error',
        text: `Not applied: ${answer.reason ?? 'the service refused it.'}`,
      };
    } else {
      notice = { level: 'info', text: `${label}: ${answer.status}.` };
    }
    set({ busy: false, notice });
    await refresh(gen);
    return answer;
  }

  function send(body: RsEventBody, label: string): Promise<void> {
    return sendForAnswer(body, label).then(() => undefined);
  }

  function sendForAnswer(body: RsEventBody, label: string): Promise<RsIntakeResponse | null> {
    const docs = state.docs;
    if (!study || !docs || state.busy || patientKey === null) {
      return Promise.resolve(null);
    }
    const doc = buildIntakeEvent(
      {
        studyUID: study,
        patientKey,
        reader: deps.reader(),
        sessionId: deps.sessionId,
        contractVersion: docs.report.contractVersion,
      },
      body,
      {
        baseRevision: docs.report.revision,
        selection: state.selection,
        currentSection: currentSectionOf(state.selection),
        eventId: deps.newId(),
        now: deps.now(),
      }
    );
    return postForAnswer(doc, label);
  }

  const selectable = (): DraftPassage[] =>
    state.docs ? draftView(state.docs.report).selectable : [];

  function openCopilot(): boolean {
    if (state.phase !== 'ready') {
      return false;
    }
    if (!state.selection?.entryId) {
      set({
        notice: {
          level: 'info',
          text: 'Select a sentence first: the Copilot opens on the selected finding.',
        },
      });
      return false;
    }
    counts.copilotOpens++;
    set({ copilotOpen: true, collapsed: false, notice: null });
    return true;
  }

  function select(passageId: string): void {
    const p = selectable().find(x => x.id === passageId);
    if (!p) {
      return;
    }
    const selection = selectionOf(p);
    counts.selections++;
    // A click selects and opens nothing (invariant 16); an open Copilot follows the selection.
    set({ selection });
    deps.onSelect?.(selection);
  }

  return {
    enter(next) {
      if (!next) {
        return;
      }
      if (next === study && state.phase !== 'idle' && state.phase !== 'failed') {
        return;
      }
      generation++;
      stopPolling();
      study = next;
      patientKey = null;
      pollFailures = 0;
      pollNotice = false;
      lastFailed = null;
      tabChosen = false;
      state = { ...INITIAL, collapsed: state.collapsed, phase: 'loading' };
      listeners.forEach(l => l());
      void load(next, generation);
    },
    leave() {
      generation++;
      stopPolling();
      study = null;
      patientKey = null;
      tabChosen = false;
      state = { ...INITIAL, collapsed: state.collapsed };
      listeners.forEach(l => l());
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select,
    moveSelection(delta) {
      const list = selectable();
      if (!list.length) {
        return;
      }
      const at = list.findIndex(p => p.id === state.selection?.passageId);
      const next =
        at < 0
          ? delta > 0
            ? 0
            : list.length - 1
          : Math.min(list.length - 1, Math.max(0, at + delta));
      select(list[next].id);
    },
    openCopilot,
    closeCopilot() {
      if (state.copilotOpen) {
        set({ copilotOpen: false });
      }
    },
    toggleCopilot() {
      if (state.copilotOpen) {
        set({ copilotOpen: false });
        return true;
      }
      return openCopilot();
    },
    setTab(tab) {
      tabChosen = true;
      if (tab !== state.tab) {
        set({ tab, copilotOpen: false });
      }
    },
    offerTab(tab) {
      if (!tabChosen && tab !== state.tab && study !== null) {
        set({ tab });
      }
    },
    setCollapsed(collapsed) {
      if (collapsed !== state.collapsed) {
        set({ collapsed, copilotOpen: collapsed ? false : state.copilotOpen });
      }
    },
    accept: id => send({ type: 'accept', target: { kind: 'inbox_entry', id } }, 'Accepted'),
    reject: id => send({ type: 'reject', target: { kind: 'inbox_entry', id } }, 'Rejected'),
    undo: revisionId => send({ type: 'undo', revisionId }, 'Undone'),
    keepRefine: resultId =>
      sendForAnswer(
        { type: 'accept', target: { kind: 'proposal', id: resultId } },
        'Kept the new outline'
      ),
    discardRefine: resultId =>
      sendForAnswer(
        { type: 'reject', target: { kind: 'proposal', id: resultId } },
        'Discarded SAM2CT’s outline'
      ),
    retry() {
      if (!lastFailed || state.busy) {
        return Promise.resolve();
      }
      const { doc, label } = lastFailed;
      return post(doc, label);
    },
    dismissNotice() {
      if (state.notice) {
        set({ notice: null, canRetry: false });
      }
    },
    harnessState() {
      const docs = state.docs;
      return {
        phase: state.phase,
        study: study ? deps.studyRef(study) : null,
        published: docs?.versions.published.revision ?? null,
        latest: docs?.versions.latest.revision ?? null,
        reportRevision: docs?.report.revision ?? null,
        opened: docs?.versions.opened ?? null,
        inbox: docs?.inbox.entries.length ?? null,
        revisions: docs?.versions.revisions.length ?? null,
        selection: state.selection
          ? { entryId: state.selection.entryId, passageId: state.selection.passageId }
          : null,
        copilotOpen: state.copilotOpen,
        collapsed: state.collapsed,
        tab: state.tab,
        busy: state.busy,
        notice: state.notice?.level ?? null,
        counts: { ...counts },
      };
    },
  };
}
