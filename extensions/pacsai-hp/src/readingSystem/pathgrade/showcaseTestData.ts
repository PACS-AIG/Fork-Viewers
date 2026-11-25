/**
 * RS-36: a PathGrade showcase document for the tests, shaped as the API's
 * contract 1.16 publishes it (its own test's document(), with the wording
 * pathgrade.showcase uses). The pictures are made-up bytes, listed by their
 * sha256.
 */
import { createHash } from 'crypto';

export const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export const PICTURES: Record<string, Uint8Array> = {
  'outline_KiTS-00001.png': new Uint8Array([137, 80, 78, 71, 1]),
  'outline_KiTS-00002.png': new Uint8Array([137, 80, 78, 71, 2]),
  'growth_KiTS-00003.png': new Uint8Array([137, 80, 78, 71, 3]),
};

export const NOTICE =
  'Research only. These are public kidney tumours from C4KC-KiTS, not this patient. Nothing here is a finding ' +
  'or a measurement of this study. No PathGrade model is enabled: the reference-case strip appears on a read ' +
  'only from a qualified characterizer, and none is qualified.';

export const COHORT = {
  dataset: 'c4kc_kits',
  release: '2019-07',
  title: 'C4KC-KiTS',
  licence: 'CC BY 3.0',
  credit: 'The Cancer Imaging Archive (TCIA)',
  doi: '10.7937/TCIA.2019.IX49E8NX',
  permittedUse: 'retrieval_and_display',
};

export function makeShowcase(
  over: Record<string, unknown> = {},
  pictures: Record<string, Uint8Array> = PICTURES
): Record<string, unknown> {
  const images = Object.keys(pictures)
    .sort()
    .map(name => ({
      name,
      sha256: sha(pictures[name]),
      width: 9,
      height: 6,
      alt: `Axial slice of ${name.replace(/\.png$/, '')}`,
    }));
  return {
    contractVersion: 'pacsai.reading/1.16',
    artifact: 'pathgrade_showcase',
    snapshotId: null,
    studyUID: null,
    bundleHash: 'a'.repeat(64),
    mode: 'fixture',
    id: `pgs:${'0123456789abcdef'.repeat(2)}`,
    use: 'research',
    task: 'renal_subtype_grade',
    title: 'PathGrade on public kidney tumours',
    notice: NOTICE,
    cohort: { ...COHORT },
    sources: [
      { kind: 'code', name: 'pathgrade.showcase', sha256: null },
      { kind: 'model', name: 'subtype model', sha256: 'b'.repeat(64) },
    ],
    sections: [
      {
        id: 'outlines',
        title: 'The machine’s outline and size beside the expert’s',
        items: [
          { kind: 'text', text: 'Yellow is the expert’s outline.\n\nRed is the machine’s.' },
          {
            kind: 'facts',
            facts: [
              { label: 'Tumours', display: '75', value: 75, unit: null },
              { label: 'Dice, median', display: '0.90', value: 0.9, unit: null },
            ],
          },
          {
            kind: 'figure',
            panels: [
              { image: 'outline_KiTS-00001.png', caption: 'KiTS-00001: clear cell' },
              { image: 'outline_KiTS-00002.png', caption: 'KiTS-00002: papillary' },
            ],
            caption: 'Axial slices through each tumour’s widest part.',
          },
        ],
      },
      {
        id: 'standing',
        title: 'Where PathGrade stands',
        items: [
          {
            kind: 'table',
            caption: 'From public cases to a usable mask',
            columns: ['Dataset', 'Cases', 'Usable'],
            rows: [
              ['C4KC-KiTS', '300', '75'],
              ['CPTAC-CCRCC', '222', '26'],
            ],
          },
          { kind: 'figure', panels: [{ image: 'growth_KiTS-00003.png' }] },
        ],
      },
    ],
    images,
    ...over,
  };
}
