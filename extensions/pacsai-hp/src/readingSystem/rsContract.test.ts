import { RsRefused, checkDocument, contractMajor } from './rsContract';
import { DRAFT_CHANGING, buildIntakeEvent, changesDraft, freshId } from './rsEvents';
import { makeReport } from './testDocs';

describe('the contract rules a consumer keeps (RS-36)', () => {
  it('reads the major of a contract version, and nothing else as one', () => {
    expect(contractMajor('pacsai.reading/1.12')).toBe(1);
    expect(contractMajor('pacsai.reading/2.0')).toBe(2);
    expect(contractMajor('pacsai.reading/1')).toBeNull();
    expect(contractMajor('other/1.2')).toBeNull();
    expect(contractMajor(undefined)).toBeNull();
  });

  it('takes a document of this major, this mode and the expected artifact', () => {
    const report = makeReport();
    expect(checkDocument(report, 'report', 'fixture')).toBe(report);
  });

  it('refuses another major, another mode or another artifact, saying why', () => {
    expect(() => checkDocument({ ...makeReport(), contractVersion: 'pacsai.reading/2.0' }, 'report', 'fixture')).toThrow(
      /publishes contract pacsai\.reading\/2\.0; this viewer reads pacsai\.reading\/1\.x/
    );
    // A clinical viewer never shows a fixture document, and the other way round.
    expect(() => checkDocument(makeReport(), 'report', 'clinical')).toThrow(RsRefused);
    expect(() => checkDocument(makeReport(), 'report', 'clinical')).toThrow(/fixture documents; this viewer reads clinical/);
    expect(() => checkDocument(makeReport(), 'inbox', 'fixture')).toThrow(/Expected a inbox document, received report/);
    expect(() => checkDocument('text', 'report', 'fixture')).toThrow(RsRefused);
  });
});

describe('typed reader events (POST /events)', () => {
  const ctx = {
    studyUID: 'study-under-test',
    patientKey: 'patient-key',
    reader: { id: 'reader-a', role: 'radiologist' },
    sessionId: 'session-1',
    contractVersion: 'pacsai.reading/1.12',
  };
  const now = new Date('2026-11-20T10:00:00.000Z');

  it('names the draft-changing kinds exactly as the contract does', () => {
    expect([...DRAFT_CHANGING]).toEqual([
      'edit',
      'reader_text',
      'affirm',
      'accept',
      'reject',
      'answer',
      'keep_wording',
      'apply_patch',
      'undo',
    ]);
    expect(changesDraft({ type: 'opened' })).toBe(false);
    expect(changesDraft({ type: 'undo', revisionId: 'r' })).toBe(true);
  });

  it('writes `opened` with the envelope only: no base revision and no capture', () => {
    const doc = buildIntakeEvent(ctx, { type: 'opened' }, { eventId: 'e-1', now });
    expect(doc).toEqual({
      contractVersion: 'pacsai.reading/1.12',
      artifact: 'intake_event',
      eventId: 'e-1',
      sessionId: 'session-1',
      reader: { id: 'reader-a', role: 'radiologist' },
      clientTimestamp: '2026-11-20T10:00:00.000Z',
      studyUID: 'study-under-test',
      context: { patientKey: 'patient-key' },
      event: { type: 'opened' },
    });
  });

  it('writes a draft-changing event against the published revision shown, with its capture', () => {
    const selection = { entryId: 'F1', passageId: 'p-liver', sentenceId: 's-liver' };
    const doc = buildIntakeEvent(
      ctx,
      { type: 'accept', target: { kind: 'inbox_entry', id: 'inbox-1' } },
      { eventId: 'e-2', now, baseRevision: 7, selection, currentSection: 'liver_and_biliary' }
    );
    expect(doc.baseRevision).toBe(7);
    expect(doc.capture).toEqual({
      reportRevision: 7,
      selection,
      currentSection: 'liver_and_biliary',
      alternativesVersion: null,
    });
    expect(doc.event).toEqual({ type: 'accept', target: { kind: 'inbox_entry', id: 'inbox-1' } });
  });

  it('never writes a draft-changing event without its base revision', () => {
    expect(() => buildIntakeEvent(ctx, { type: 'undo', revisionId: 'r-1' }, { eventId: 'e', now })).toThrow(
      /names the published revision/
    );
    expect(() =>
      buildIntakeEvent(ctx, { type: 'undo', revisionId: 'r-1' }, { eventId: 'e', now, baseRevision: -1 })
    ).toThrow();
  });

  it('writes the events in the minor of the documents read, and in 1.12 before any was read', () => {
    const { contractVersion: _unused, ...noVersion } = ctx;
    expect(buildIntakeEvent(noVersion, { type: 'opened' }, { eventId: 'e', now }).contractVersion).toBe(
      'pacsai.reading/1.12'
    );
    expect(
      buildIntakeEvent({ ...ctx, contractVersion: 'pacsai.reading/1.13' }, { type: 'opened' }, { eventId: 'e', now })
        .contractVersion
    ).toBe('pacsai.reading/1.13');
  });

  it('mints ids from the platform UUID, or a UUID-shaped one without it', () => {
    expect(freshId({ randomUUID: () => 'fixed-id' })).toBe('fixed-id');
    expect(freshId({})).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
