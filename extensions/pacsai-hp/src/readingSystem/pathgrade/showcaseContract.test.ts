import { RsRefused } from '../rsContract';
import { creditLine, picturesShown, readShowcase } from './showcaseContract';
import { COHORT, NOTICE, makeShowcase } from './showcaseTestData';

const sections = (doc: Record<string, unknown>) =>
  doc.sections as Array<{ id: string; title: string; items: Array<Record<string, unknown>> }>;

describe("PathGrade's research showcase, as the pane reads it (contract 1.16)", () => {
  it('reads the sections, the cohort and the pictures as the API words them', () => {
    const s = readShowcase(makeShowcase(), 'fixture');
    expect(s).toMatchObject({
      artifact: 'pathgrade_showcase',
      snapshotId: null,
      studyUID: null,
      use: 'research',
      task: 'renal_subtype_grade',
      title: 'PathGrade on public kidney tumours',
      notice: NOTICE,
      cohort: COHORT,
    });
    expect(s.sections.map(x => [x.id, x.items.map(i => i.kind), x.unknownItems])).toEqual([
      ['outlines', ['text', 'facts', 'figure'], 0],
      ['standing', ['table', 'figure'], 0],
    ]);
    expect(s.sections[0].items[1]).toEqual({
      kind: 'facts',
      facts: [
        { label: 'Tumours', display: '75' },
        { label: 'Dice, median', display: '0.90' },
      ],
    });
    // A figure's caption and a picture's default to nothing.
    expect(s.sections[1].items[1]).toEqual({
      kind: 'figure',
      caption: '',
      panels: [{ image: 'growth_KiTS-00003.png', caption: '' }],
    });
    expect(s.images.map(i => [i.name, i.width, i.height])).toEqual([
      ['growth_KiTS-00003.png', 9, 6],
      ['outline_KiTS-00001.png', 9, 6],
      ['outline_KiTS-00002.png', 9, 6],
    ]);
    expect(s.sources).toEqual([
      { kind: 'code', name: 'pathgrade.showcase', sha256: null },
      { kind: 'model', name: 'subtype model', sha256: 'b'.repeat(64) },
    ]);
    expect(creditLine(s.cohort)).toBe(
      'Images: The Cancer Imaging Archive (TCIA), C4KC-KiTS, DOI 10.7937/TCIA.2019.IX49E8NX, CC BY 3.0'
    );
    // The pictures in the order the sections show them.
    expect(picturesShown(s)).toEqual([
      'outline_KiTS-00001.png',
      'outline_KiTS-00002.png',
      'growth_KiTS-00003.png',
    ]);
  });

  it('leaves out an item of a kind it does not know (a later minor’s), and counts it', () => {
    const doc = makeShowcase();
    sections(doc)[1].items.push({ kind: 'video', src: 'x' });
    sections(doc).push({ id: 'later', title: 'Later', items: [{ kind: 'chart', data: [] }] });
    const s = readShowcase(doc, 'fixture');
    expect(s.sections[1].items.map(i => i.kind)).toEqual(['table', 'figure']);
    expect(s.sections.map(x => x.unknownItems)).toEqual([0, 1, 1]);
  });

  it.each([
    [
      'another artifact',
      { artifact: 'pathgrade.model_report' },
      /Expected a pathgrade_showcase document/,
    ],
    ['another major', { contractVersion: 'pacsai.reading/2.0' }, /reads pacsai\.reading\/1\.x/],
    ['another mode', { mode: 'clinical' }, /publishes clinical documents/],
    ['a study', { studyUID: 'study-ref' }, /names a study, and a showcase belongs to none/],
    ['another use', { use: 'clinical' }, /its use is not research/],
    ['a malformed id', { id: 'pgs:xyz' }, /its id is malformed/],
    ['no notice', { notice: ' ' }, /its notice is missing/],
    [
      'a cohort not permitted for display',
      { cohort: { ...COHORT, permittedUse: 'internal_eval' } },
      /not permitted for display/,
    ],
    [
      'a cohort without its credit',
      { cohort: { ...COHORT, credit: '' } },
      /cohort's credit is missing/,
    ],
    ['no sections', { sections: [] }, /it has no sections/],
  ])('refuses a showcase with %s', (_why, over, message) => {
    expect(() => readShowcase(makeShowcase(over), 'fixture')).toThrow(message);
  });

  it('refuses a figure with a picture it does not list, a picture outside the contract, a broken table', () => {
    const unlisted = makeShowcase();
    (sections(unlisted)[0].items[2].panels as Array<{ image: string }>)[0].image = 'other.png';
    expect(() => readShowcase(unlisted, 'fixture')).toThrow(/a picture it does not list/);
    const traversal = makeShowcase();
    (sections(traversal)[0].items[2].panels as Array<{ image: string }>)[0].image = '../x.png';
    expect(() => readShowcase(traversal, 'fixture')).toThrow(/outside the contract/);
    const badImage = makeShowcase();
    (badImage.images as Array<{ name: string }>)[0].name = 'growth.gif';
    expect(() => readShowcase(badImage, 'fixture')).toThrow(/a picture is malformed/);
    const twice = makeShowcase();
    (twice.images as unknown[]).push((twice.images as unknown[])[0]);
    expect(() => readShowcase(twice, 'fixture')).toThrow(/listed twice/);
    const table = makeShowcase();
    (sections(table)[1].items[0].rows as string[][])[1] = ['CPTAC-CCRCC', '222'];
    expect(() => readShowcase(table, 'fixture')).toThrow(/one cell per column/);
  });

  it('refuses a string shaped like a DICOM UID without quoting it', () => {
    const doc = makeShowcase({ notice: 'From series 1.2.840.113619.2.55 only.' });
    let message = '';
    try {
      readShowcase(doc, 'fixture');
    } catch (e) {
      expect(e).toBeInstanceOf(RsRefused);
      message = (e as RsRefused).why;
    }
    expect(message).toMatch(/shaped like a DICOM UID/);
    expect(message).not.toMatch(/1\.2\.840/);
    // The DOI and the contract version are not UID-shaped.
    expect(() => readShowcase(makeShowcase(), 'fixture')).not.toThrow();
  });

  it('keeps only well-formed sources', () => {
    const s = readShowcase(
      makeShowcase({
        sources: [{ kind: 'code', name: 'x', sha256: 'not-a-hash' }, { kind: '', name: 'y' }, 'z'],
      }),
      'fixture'
    );
    expect(s.sources).toEqual([{ kind: 'code', name: 'x', sha256: null }]);
  });
});
