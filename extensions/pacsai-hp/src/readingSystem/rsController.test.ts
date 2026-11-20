import { RsRefused } from './rsContract';
import { RsHttpError, type RsClient } from './rsClient';
import { POLL_FAILURES_BEFORE_NOTICE, createRsController, type RsControllerDeps } from './rsController';
import type { RsIntakeEvent } from './rsEvents';
import { STUDY, UPDATE_ENTRY, makeEvidence, makeInbox, makeReport, makeSnapshot, makeVersions } from './testDocs';

const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};

type MockClient = {
  base: string;
  mode: 'fixture';
  report: jest.Mock;
  versions: jest.Mock;
  inbox: jest.Mock;
  evidenceView: jest.Mock;
  snapshot: jest.Mock;
  postEvent: jest.Mock;
};

function setup(over: Partial<Record<keyof RsClient, jest.Mock>> = {}, deps: Partial<RsControllerDeps> = {}) {
  const posted: RsIntakeEvent[] = [];
  let versions = makeVersions();
  let report = makeReport();
  let inbox = makeInbox();
  const client = {
    base: '/rs-api',
    mode: 'fixture' as const,
    report: jest.fn(async () => report),
    versions: jest.fn(async () => versions),
    inbox: jest.fn(async () => inbox),
    evidenceView: jest.fn(async () => makeEvidence()),
    snapshot: jest.fn(async () => makeSnapshot()),
    postEvent: jest.fn(async (doc: RsIntakeEvent) => {
      posted.push(doc);
      return { artifact: 'intake_response', eventId: doc.eventId, studyUID: STUDY, status: 'recorded', httpStatus: 200, revision: report.revision, contractVersion: 'x' };
    }),
    ...over,
  } as MockClient;
  const timers: Array<() => void> = [];
  let ids = 0;
  const onSelect = jest.fn();
  const controller = createRsController({
    client: client as unknown as RsClient,
    reader: () => ({ id: 'reader-a', role: 'radiologist' }),
    sessionId: 'session-1',
    newId: () => `id-${++ids}`,
    now: () => new Date('2026-11-20T10:00:00Z'),
    pollMs: 1000,
    setTimer: fn => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => {},
    isHidden: () => false,
    studyRef: uid => `ref:${uid.length}`,
    onSelect,
    ...deps,
  });
  return {
    controller,
    client,
    posted,
    onSelect,
    tick: async () => {
      const fn = timers.pop();
      fn?.();
      await flush();
    },
    set: (o: { versions?: typeof versions; report?: typeof report; inbox?: typeof inbox }) => {
      versions = o.versions ?? versions;
      report = o.report ?? report;
      inbox = o.inbox ?? inbox;
    },
  };
}

describe('the reading-system pane state (RS-36)', () => {
  it('reads the study, then posts `opened` once so later inference reaches the inbox', async () => {
    const t = setup();
    t.controller.enter(STUDY);
    expect(t.controller.getSnapshot().phase).toBe('loading');
    await flush();
    const snap = t.controller.getSnapshot();
    expect(snap.phase).toBe('ready');
    expect(snap.docs?.report.revision).toBe(4);
    expect(t.posted.map(e => e.event)).toEqual([{ type: 'opened' }]);
    expect(t.posted[0].context).toEqual({ patientKey: 'patient-key-under-test' });
    expect(t.posted[0].baseRevision).toBeUndefined();
    // The same study again: nothing read or posted twice.
    t.controller.enter(STUDY);
    await flush();
    expect(t.posted).toHaveLength(1);
    expect(t.client.report).toHaveBeenCalledTimes(2); // the load, and the re-read after `opened`
  });

  it('does not post `opened` for a study already opened', async () => {
    const t = setup();
    t.set({ versions: makeVersions({ opened: true }) });
    t.controller.enter(STUDY);
    await flush();
    expect(t.posted).toHaveLength(0);
  });

  it('is not_served for a study the API does not serve, and refused for a document the rules refuse', async () => {
    const t = setup({ report: jest.fn(async () => { throw new RsHttpError(404, 'report'); }) });
    t.controller.enter(STUDY);
    await flush();
    expect(t.controller.getSnapshot().phase).toBe('not_served');
    const r = setup({ report: jest.fn(async () => { throw new RsRefused('another mode'); }) });
    r.controller.enter(STUDY);
    await flush();
    expect(r.controller.getSnapshot()).toEqual(expect.objectContaining({ phase: 'refused', reason: 'another mode' }));
  });

  it('selects on a click and opens nothing; the Copilot opens on the selected finding only', async () => {
    const t = setup();
    t.controller.enter(STUDY);
    await flush();
    expect(t.controller.openCopilot()).toBe(false);
    expect(t.controller.getSnapshot().notice?.text).toMatch(/Select a sentence first/);
    t.controller.select('p-liver');
    expect(t.controller.getSnapshot().selection).toEqual({ entryId: 'F1', passageId: 'p-liver', sentenceId: 's-liver' });
    expect(t.controller.getSnapshot().copilotOpen).toBe(false);
    expect(t.onSelect).toHaveBeenCalledWith({ entryId: 'F1', passageId: 'p-liver', sentenceId: 's-liver' });
    t.controller.select('p-ind'); // not bound to a finding: not selectable
    expect(t.controller.getSnapshot().selection?.passageId).toBe('p-liver');
    expect(t.controller.toggleCopilot()).toBe(true);
    expect(t.controller.getSnapshot().copilotOpen).toBe(true);
    t.controller.moveSelection(1);
    expect(t.controller.getSnapshot().selection?.passageId).toBe('p-kidney');
    expect(t.controller.getSnapshot().copilotOpen).toBe(true); // it follows the selection
    t.controller.setTab('inbox');
    expect(t.controller.getSnapshot().copilotOpen).toBe(false);
    t.controller.moveSelection(1);
    t.controller.moveSelection(1);
    expect(t.controller.getSnapshot().selection?.passageId).toBe('p-imp');
  });

  it('accepts against the published revision shown, with the capture, and reads the documents again', async () => {
    const t = setup();
    t.set({ versions: makeVersions({ opened: true }), inbox: makeInbox({ entries: [UPDATE_ENTRY] }) });
    t.controller.enter(STUDY);
    await flush();
    t.controller.select('p-liver');
    t.client.postEvent.mockImplementationOnce(async (doc: RsIntakeEvent) => {
      t.posted.push(doc);
      t.set({ report: makeReport({ revision: 5 }), versions: makeVersions({ opened: true, published: { revision: 5, epoch: 1, snapshotId: 'x' } }), inbox: makeInbox() });
      return { artifact: 'intake_response', status: 'applied', httpStatus: 200, revision: 5 };
    });
    await t.controller.accept('inbox-1');
    await flush();
    const event = t.posted[0];
    expect(event.event).toEqual({ type: 'accept', target: { kind: 'inbox_entry', id: 'inbox-1' } });
    expect(event.baseRevision).toBe(4);
    expect(event.capture).toEqual({
      reportRevision: 4,
      selection: { entryId: 'F1', passageId: 'p-liver', sentenceId: 's-liver' },
      currentSection: 'liver_and_biliary',
      alternativesVersion: null,
    });
    const snap = t.controller.getSnapshot();
    expect(snap.docs?.report.revision).toBe(5);
    expect(snap.docs?.inbox.entries).toHaveLength(0);
    expect(snap.notice).toEqual({ level: 'info', text: 'Accepted: the draft is at revision 5.' });
  });

  it('on a 409 applies nothing, reads the current draft and says so', async () => {
    const t = setup();
    t.set({ versions: makeVersions({ opened: true }), inbox: makeInbox({ entries: [UPDATE_ENTRY] }) });
    t.controller.enter(STUDY);
    await flush();
    t.client.postEvent.mockImplementationOnce(async () => {
      t.set({ report: makeReport({ revision: 6 }) });
      return { artifact: 'intake_response', status: 'conflict', httpStatus: 409, revision: 6, currentRevision: 6 };
    });
    await t.controller.reject('inbox-1');
    await flush();
    const snap = t.controller.getSnapshot();
    expect(snap.notice?.level).toBe('warn');
    expect(snap.notice?.text).toMatch(/moved to revision 6 .*nothing was applied/);
    expect(snap.docs?.report.revision).toBe(6);
    expect((t.controller.harnessState().counts as Record<string, number>).conflicts).toBe(1);
  });

  it('says why a refused event was refused', async () => {
    const t = setup();
    t.set({ versions: makeVersions({ opened: true }) });
    t.controller.enter(STUDY);
    await flush();
    t.client.postEvent.mockImplementationOnce(async () => ({ artifact: 'intake_response', status: 'rejected', httpStatus: 422, revision: 4, reason: 'no such revision' }));
    await t.controller.undo('rev-x');
    await flush();
    expect(t.controller.getSnapshot().notice).toEqual({ level: 'error', text: 'Not applied: no such revision' });
  });

  it('offers to try again after a lost answer, and the retry is the same event', async () => {
    const t = setup();
    t.set({ versions: makeVersions({ opened: true }) });
    t.controller.enter(STUDY);
    await flush();
    t.client.postEvent.mockImplementationOnce(async () => {
      throw new TypeError('network');
    });
    await t.controller.undo('rev-1');
    expect(t.controller.getSnapshot().canRetry).toBe(true);
    await t.controller.retry();
    await flush();
    const ids = t.client.postEvent.mock.calls.map(([doc]: [RsIntakeEvent]) => doc.eventId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(t.controller.getSnapshot().canRetry).toBe(false);
  });

  it('reads the documents again only when a version moved, and not while the page is hidden', async () => {
    let hidden = false;
    const t = setup({}, { isHidden: () => hidden });
    t.set({ versions: makeVersions({ opened: true }) });
    t.controller.enter(STUDY);
    await flush();
    const reads = t.client.report.mock.calls.length;
    await t.tick();
    expect(t.client.report.mock.calls.length).toBe(reads);
    t.set({ versions: makeVersions({ opened: true, latest: { revision: 5, epoch: 1, snapshotId: 'fx-test.l5' } }), inbox: makeInbox({ entries: [UPDATE_ENTRY] }) });
    await t.tick();
    expect(t.client.report.mock.calls.length).toBe(reads + 1);
    expect(t.controller.getSnapshot().docs?.inbox.entries).toHaveLength(1);
    hidden = true;
    const polls = t.client.versions.mock.calls.length;
    await t.tick();
    expect(t.client.versions.mock.calls.length).toBe(polls);
  });

  it('says the service is not answering after repeated poll failures, and clears it when it answers', async () => {
    const t = setup();
    t.set({ versions: makeVersions({ opened: true }) });
    t.controller.enter(STUDY);
    await flush();
    t.client.versions.mockImplementation(async () => {
      throw new TypeError('down');
    });
    for (let i = 0; i < POLL_FAILURES_BEFORE_NOTICE; i++) {
      await t.tick();
    }
    expect(t.controller.getSnapshot().notice?.level).toBe('warn');
    t.client.versions.mockImplementation(async () => makeVersions({ opened: true }));
    await t.tick();
    expect(t.controller.getSnapshot().notice).toBeNull();
  });

  it('keeps the selection across a re-read by passage, else by finding, else drops it with the Copilot', async () => {
    const t = setup();
    t.set({ versions: makeVersions({ opened: true }) });
    t.controller.enter(STUDY);
    await flush();
    t.controller.select('p-liver');
    t.controller.openCopilot();
    const moved = makeReport({ revision: 5 });
    moved.passages = moved.passages.map(p => (p.id === 'p-liver' ? { ...p, id: 'p-liver-2' } : p));
    moved.sections.findings[0].passageIds = ['p-liver-2'];
    t.set({ report: moved, versions: makeVersions({ opened: true, published: { revision: 5, epoch: 1, snapshotId: 'x' } }) });
    await t.tick();
    expect(t.controller.getSnapshot().selection).toEqual({ entryId: 'F1', passageId: 'p-liver-2', sentenceId: 's-liver' });
    expect(t.controller.getSnapshot().copilotOpen).toBe(true);
    const gone = makeReport({ revision: 6 });
    gone.passages = gone.passages.filter(p => !(p.boundEntries ?? []).includes('F1'));
    t.set({ report: gone, versions: makeVersions({ opened: true, published: { revision: 6, epoch: 1, snapshotId: 'y' } }) });
    await t.tick();
    expect(t.controller.getSnapshot().selection).toBeNull();
    expect(t.controller.getSnapshot().copilotOpen).toBe(false);
  });

  it('starts over for another study, and a load of the old study that answers late changes nothing', async () => {
    const gate: { release: () => void } = { release: () => {} };
    const t = setup();
    t.client.report.mockImplementationOnce(
      () => new Promise(resolve => (gate.release = () => resolve(makeReport({ revision: 99 }))))
    );
    t.controller.enter('study-old');
    t.controller.enter(STUDY);
    await flush();
    gate.release();
    await flush();
    expect(t.controller.getSnapshot().docs?.report.revision).toBe(4);
    expect(t.controller.harnessState().study).toBe(`ref:${STUDY.length}`);
    expect(JSON.stringify(t.controller.harnessState())).not.toContain(STUDY);
  });

  it('folds to its bar and closes the Copilot when folded; leave forgets the study', async () => {
    const t = setup();
    t.set({ versions: makeVersions({ opened: true }) });
    t.controller.enter(STUDY);
    await flush();
    t.controller.select('p-liver');
    t.controller.openCopilot();
    t.controller.setCollapsed(true);
    expect(t.controller.getSnapshot()).toEqual(expect.objectContaining({ collapsed: true, copilotOpen: false }));
    t.controller.openCopilot();
    expect(t.controller.getSnapshot()).toEqual(expect.objectContaining({ collapsed: false, copilotOpen: true }));
    t.controller.leave();
    expect(t.controller.getSnapshot().phase).toBe('idle');
    expect(t.controller.getSnapshot().docs).toBeNull();
  });
});
