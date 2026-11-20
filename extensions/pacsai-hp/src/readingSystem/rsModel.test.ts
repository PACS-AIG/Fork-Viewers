import {
  canonicalLine,
  changeListView,
  chromeLines,
  claimText,
  claimValue,
  copilotView,
  draftView,
  inboxView,
  revisionsView,
  selectionOf,
} from './rsModel';
import { UPDATE_ENTRY, makeEvidence, makeInbox, makeReport, makeVersions } from './testDocs';

describe('the draft (RS-36)', () => {
  it('keeps the report order, leaves out a Findings section with nothing to say, and keeps the Impression', () => {
    const view = draftView(makeReport());
    expect(view.sections.map(s => [s.id, s.group])).toEqual([
      ['indication', 'meta'],
      ['comparison', 'meta'],
      ['liver_and_biliary', 'findings'],
      ['kidneys_and_ureters', 'findings'],
      ['impression', 'impression'],
    ]);
    expect(view.revision).toBe(4);
  });

  it('makes a passage bound to a finding selectable, and nothing else', () => {
    const view = draftView(makeReport());
    expect(view.selectable.map(p => p.id)).toEqual(['p-liver', 'p-kidney', 'p-imp']);
    expect(view.sections[0].passages[0].selectable).toBe(false);
    expect(selectionOf(view.selectable[0])).toEqual({ entryId: 'F1', passageId: 'p-liver', sentenceId: 's-liver' });
  });

  it('shows an empty Impression as a section with no passage', () => {
    const report = makeReport();
    report.sections.impression.passageIds = [];
    const impression = draftView(report).sections.find(s => s.id === 'impression');
    expect(impression?.passages).toEqual([]);
  });
});

describe('the chrome: pending work and verdicts beside the prose, never in it', () => {
  it('says nothing when there is nothing to say', () => {
    expect(chromeLines(makeReport())).toEqual([]);
  });

  it('names pending tasks (a bare string is pending), the sections waiting and what is held back', () => {
    const report = makeReport();
    report.chrome.pending = {
      tasks: ['segment.mask', { task: 'detect.pe', status: 'running' }, { task: 'anatomy.total', status: 'failed' }],
      sections: ['liver_and_biliary'],
      withheld: [
        { entryId: 'F9', code: 'pending_work', reason: 'waits on segment.mask', status: 'withheld' },
        { entryId: 'F8', code: 'grouped', reason: 'grouped', status: 'grouped' },
      ],
    };
    const lines = chromeLines(report);
    expect(lines.map(l => [l.text, l.tone])).toEqual([
      ['Segment.mask: pending', 'pending'],
      ['Detect.pe: running', 'pending'],
      ['Anatomy.total: failed', 'warn'],
      ['Waiting on pending work: Liver and biliary', 'pending'],
      ['1 statement held back', 'pending'],
    ]);
    expect(lines[4].title).toBe('waits on segment.mask');
  });

  it('says the comparison state, the priors unlinked and the Impression verdicts', () => {
    const report = makeReport();
    report.chrome.comparison = { state: 'pending', label: null, unlinked: ['a', 'b'] };
    report.chrome.impression = {
      complete: false,
      sound: false,
      style: 'unavailable',
      failures: [{ code: 'x', detail: 'unsupported claim', where: 'n1' }],
      withheld: [{ nodeId: 'n2', entryId: 'F2', code: 'c', reason: 'by the reader', critical: true }],
    };
    expect(chromeLines(report).map(l => l.text)).toEqual([
      'Comparison pending',
      '2 priors unlinked',
      'Impression incomplete',
      'Impression failed its check (1 failure)',
      '1 Impression item withheld',
    ]);
    expect(chromeLines(report)[4].tone).toBe('warn');
  });

  it('names a flagged series by its phase, never by its UID', () => {
    const report = makeReport();
    report.chrome.phase = { flagged: [{ phase: 'portal_venous', flags: ['contrast_mismatch'], seriesUID: '1.2.3.4.5' }] };
    const lines = chromeLines(report);
    expect(lines.map(l => l.text)).toEqual(['Check the portal venous series: contrast mismatch']);
    expect(JSON.stringify(lines)).not.toContain('1.2.3.4.5');
  });
});

describe('the inbox and the change list', () => {
  it('shows each entry with its claims, its exact consequence preview and the section of each line', () => {
    const [entry] = inboxView(makeInbox({ entries: [UPDATE_ENTRY] }), makeReport());
    expect(entry.kindLabel).toBe('Update');
    expect(entry.summary).toBe('diameter 12 -> 14 mm');
    expect(entry.claims).toEqual(['Measurement: 12 mm → 14 mm']);
    expect(entry.preview).toEqual([
      {
        passageId: 'p-liver',
        sectionTitle: 'Liver and biliary',
        before: '12 mm low-attenuation lesion in the liver.',
        after: '14 mm low-attenuation lesion in the liver.',
      },
      { passageId: 'p-imp', sectionTitle: 'Impression', before: '12 mm liver lesion.', after: '14 mm liver lesion.' },
    ]);
    expect(entry.acceptable).toBe(true);
  });

  it('keeps a patch of the reader\'s own wording apart, and an unacceptable entry with its reason', () => {
    const entry = {
      ...UPDATE_ENTRY,
      kind: 'alternative_evidence' as const,
      preview: [],
      patches: [
        { target: 'F2', passageId: 'p-kidney', status: 'review' as const, ours: 'Small cyst.', theirs: '9 mm cyst.' },
      ],
      acceptable: false,
      reason: 'waits on another update',
    };
    const [view] = inboxView(makeInbox({ entries: [entry] }), makeReport());
    expect(view.kindLabel).toBe('Alternative evidence');
    expect(view.patches).toEqual([
      { passageId: 'p-kidney', sectionTitle: 'Kidneys and ureters', status: 'review', ours: 'Small cyst.', theirs: '9 mm cyst.' },
    ]);
    expect(view.acceptable).toBe(false);
    expect(view.reason).toBe('waits on another update');
  });

  it('words claim values: a measurement, nothing, a word and a block', () => {
    expect(claimValue({ value: 14, units: 'mm', hu: 15 })).toBe('14 mm');
    expect(claimValue(null)).toBe('none');
    expect(claimValue('left_side')).toBe('left side');
    expect(claimValue({ organ: 'liver', side: null })).toBe('organ liver, side none');
    expect(claimText({ property: 'class', before: null, after: 'Class II' })).toBe('Class: none → Class II');
  });

  it('groups the change list and leaves out empty groups', () => {
    const groups = changeListView(
      {
        added: [{ passageId: 'p-new', section: 'spleen', before: null, after: 'Splenule.' }],
        changed: [UPDATE_ENTRY.preview[0]],
        deleted: [],
        sidesChanged: [{ entryId: 'F2', before: 'left', after: 'right' }],
      },
      makeReport()
    );
    expect(groups.map(g => [g.key, g.label, g.lines.length])).toEqual([
      ['added', 'Lines added', 1],
      ['changed', 'Lines changed', 1],
      ['sides', 'Sides changed', 1],
    ]);
    expect(groups[0].lines[0].sectionTitle).toBe('Spleen');
    expect(changeListView({}, makeReport())).toEqual([]);
  });
});

describe('the revisions, each with Undo', () => {
  it('lists them newest first, offers Undo on an intention not undone, never on an Undo', () => {
    const versions = makeVersions({
      revisions: [
        { revision: 5, revisionId: 'rev-a', origin: 'inbox', readerId: 'r', operation: { op: 'accept_entry' }, undoneBy: 'rev-b' },
        { revision: 6, revisionId: 'rev-b', origin: 'undo', readerId: 'r', operation: { op: 'undo' }, undoes: 'rev-a' },
        { revision: 7, revisionId: 'rev-c', origin: 'inbox', readerId: 'r', operation: { op: 'reject_entry' } },
        { revision: 8, revisionId: 'rev-d', origin: 'reader', readerId: 'r', operation: { op: 'set_value' } },
      ],
    });
    expect(revisionsView(versions)).toEqual([
      { revisionId: 'rev-d', revision: 8, label: 'Set value', undone: false, undoable: true },
      { revisionId: 'rev-c', revision: 7, label: 'Rejected an inbox update', undone: false, undoable: true },
      { revisionId: 'rev-b', revision: 6, label: 'Undid revision 5', undone: false, undoable: false },
      { revisionId: 'rev-a', revision: 5, label: 'Accepted an inbox update', undone: true, undoable: false },
    ]);
  });
});

describe('the Copilot card', () => {
  it('shows the finding: the canonical measurement with its statistic, sources, disagreement and predicates', () => {
    const view = copilotView(makeEvidence(), 'F1');
    expect(view).not.toBeNull();
    expect(view!.heading).toBe('Measured · reportable');
    expect(view!.facts).toEqual([
      { label: 'Section', value: 'Liver and biliary' },
      { label: 'Class', value: 'none (unresolved)' },
      {
        label: 'Measurement',
        value: '12 mm · ROI median 18 HU · portal venous phase · mask from stress policy base · range 11.8–12.6 mm',
      },
      { label: 'Recipe', value: 'segmenter@test' },
    ]);
    expect(view!.sources).toEqual([
      'Lesion task (test:lesions): hypodense_lesion',
      'Detector (test:detector): solid mass, score 0.7',
    ]);
    expect(view!.disagreement).toEqual(['test:detector says solid mass']);
    expect(view!.unresolved).toEqual(['well defined']);
    expect(view!.branches).toEqual([
      'pathway a: unresolved (unresolved: well defined)',
      'pathway b: unresolved (threshold null)',
    ]);
  });

  it('words the comparison form with its numbers and no change claim, and lists alternatives and questions in order', () => {
    const view = copilotView(makeEvidence(), 'F1')!;
    expect(view.comparison).toBe('Paired measurements · 10 mm on 2025-01-02 · 12 mm on this study');
    expect(view.comparison).not.toMatch(/\b(stable|new|growth)\b/i);
    expect(view.alternatives).toEqual([{ proposalId: 'cmd-1', text: 'Class II (reportable, model@test, score 0.6)' }]);
    expect(view.questions).toEqual(['Unresolved predicate: well defined', 'Unresolved predicate: thin wall']);
    expect(view.signing).toEqual(['Needs an acknowledgement against the displayed revision']);
    expect(view.processing).toEqual(['peritoneal cavity assessed']);
  });

  it('has nothing for a finding the evidence view does not describe, or no selection', () => {
    expect(copilotView(makeEvidence(), 'F404')).toBeNull();
    expect(copilotView(makeEvidence(), null)).toBeNull();
  });

  it('words a canonical block with no single value by what it has', () => {
    expect(canonicalLine({ units: 'HU', statistic: 'ROI median', phase: 'unenhanced' })).toBe('ROI median · unenhanced phase');
    expect(canonicalLine({})).toBeNull();
  });
});
