import { readStripState, stripSnapshot, stripView, type StripState } from './readingStrip';

// Rev 11 milestone 6, approach C (F55): the Images strip's viewer half.

const strip = (over: Partial<StripState> = {}): StripState => ({
  studyInstanceUid: '1.2.840.1.1',
  accession: 'ACC-7',
  exam: 'CT HEAD WO',
  linked: 'linked',
  lastPlaced: 'Small left effusion.',
  sign: 'sign',
  blocker: null,
  line: null,
  ...over,
});

describe('readStripState', () => {
  it('takes a strip as the island tells it', () => {
    expect(readStripState(strip())).toEqual(strip());
    const line = {
      code: 'NEXT_CASE',
      text: 'Signed. Next: CT CHEST',
      actions: [
        { id: 'open', label: 'Open' },
        { id: 'skip', label: 'Skip' },
      ],
    };
    expect(readStripState(strip({ line, sign: 'held' }))).toEqual(strip({ line, sign: 'held' }));
    expect(
      readStripState(strip({ blocker: { text: '2 sentences waiting for placement', fix: 'show' } }))
    ).toEqual(strip({ blocker: { text: '2 sentences waiting for placement', fix: 'show' } }));
    expect(readStripState(strip({ lastPlaced: null }))).toEqual(strip({ lastPlaced: null }));
  });

  it('refuses anything else, so nothing is shown', () => {
    for (const bad of [
      null,
      'x',
      { ...strip(), studyInstanceUid: 'x.y' },
      { ...strip(), linked: 'maybe' },
      { ...strip(), sign: 'go' },
      { ...strip(), accession: 7 },
      { ...strip(), lastPlaced: 'x'.repeat(201) },
      { ...strip(), blocker: { text: '', fix: null } },
      { ...strip(), blocker: { text: 'x', fix: 'open' } },
      {
        ...strip(),
        line: { code: 'NEXT_CASE', text: 'x', actions: [{ id: 'Open!', label: 'Open' }] },
      },
      { ...strip(), line: { code: 'NEXT_CASE', text: 'x', actions: 'open' } },
    ]) {
      expect([bad, readStripState(bad)]).toEqual([bad, null]);
    }
  });
});

describe('stripView', () => {
  it('Case linked, the case by its accession and exam, the last sentence, Sign', () => {
    expect(stripView(strip())).toEqual({
      linkText: 'Case linked',
      caseText: 'ACC ACC-7 · CT HEAD WO',
      mainText: 'Small left effusion.',
      blockerText: '',
      actions: [{ id: 'sign', label: 'Sign', disabled: false, primary: true }],
    });
  });

  it('a revision not seen: Review (shows the report first)', () => {
    const v = stripView(strip({ sign: 'review' }));
    expect(v.actions).toEqual([{ id: 'review', label: 'Review', disabled: false, primary: true }]);
    expect(v.blockerText).toBe('Changed since you last saw the report');
  });

  it('sentences waiting: Show report, and Sign off; the Impression being written: Sign off', () => {
    const waiting = stripView(
      strip({
        sign: 'waiting',
        blocker: { text: '2 sentences waiting for placement', fix: 'show' },
      })
    );
    expect(waiting.blockerText).toBe('2 sentences waiting for placement');
    expect(waiting.actions.map(a => [a.id, a.disabled])).toEqual([
      ['show', false],
      ['sign', true],
    ]);
    const impression = stripView(
      strip({ sign: 'waiting', blocker: { text: 'The Impression is being written', fix: null } })
    );
    expect(impression.actions.map(a => [a.id, a.disabled])).toEqual([['sign', true]]);
  });

  it('not linked: held, and it says so; signing: Signing… off', () => {
    const held = stripView(
      strip({
        linked: 'not-linked',
        sign: 'held',
        blocker: { text: 'The viewer shows another study than this report', fix: null },
      })
    );
    expect(held.linkText).toBe('Not linked');
    expect(held.blockerText).toMatch(/another study/);
    expect(held.actions).toEqual([{ id: 'sign', label: 'Sign', disabled: true, primary: true }]);
    expect(stripView(strip({ sign: 'signing' })).actions[0]).toEqual({
      id: 'sign',
      label: 'Signing…',
      disabled: true,
      primary: true,
    });
    expect(stripView(strip({ linked: 'unknown' })).linkText).toBe('');
    expect(stripView(strip({ accession: '' })).caseText).toBe('CT HEAD WO');
  });

  it("after Sign, the island's line and its actions in place of Sign", () => {
    const v = stripView(
      strip({
        sign: 'held',
        line: {
          code: 'NEXT_CASE',
          text: 'Signed. Next: CT CHEST · STAT',
          actions: [
            { id: 'open', label: 'Open' },
            { id: 'skip', label: 'Skip' },
          ],
        },
      })
    );
    expect(v.mainText).toBe('Signed. Next: CT CHEST · STAT');
    expect(v.actions.map(a => [a.id, a.primary])).toEqual([
      ['line:open', true],
      ['line:skip', false],
    ]);
  });
});

describe('stripSnapshot', () => {
  it('carries no report text and no study', () => {
    const s = stripSnapshot(strip(), true);
    expect(s).toEqual({
      shown: true,
      linked: 'linked',
      sign: 'sign',
      blocker: false,
      lastChars: 20,
      line: null,
      actions: ['sign'],
    });
    expect(JSON.stringify(s)).not.toMatch(/effusion|1\.2\.840|ACC-7|CT HEAD/);
    expect(stripSnapshot(null, false)).toBeNull();
    expect(stripSnapshot(strip({ sign: 'held' }), false)?.actions).toEqual(['sign(off)']);
  });
});
