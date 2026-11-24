import { RsRefused } from '../rsContract';
import { phraseOf, readAffine, readAnatomy } from './anatomyContract';
import { AFFINE, SERIES, makeAnatomyDoc } from './anatomyTestData';

const series = (over: Record<string, unknown> = {}) =>
  readAnatomy(makeAnatomyDoc({}, over), 'clinical').series[0];

describe('the anatomy artifact as the pane reads it (RS-36, contract 1.10)', () => {
  it('reads each series: its grid, its labelmaps with their file names and labels, and what was left undrawn', () => {
    const doc = readAnatomy(makeAnatomyDoc(), 'clinical');
    expect(doc.artifact).toBe('anatomy');
    expect(doc.series).toHaveLength(1);
    const s = doc.series[0];
    expect(s.seriesUID).toBe(SERIES);
    expect(s.invalid).toBeNull();
    expect(s.grid?.shape).toEqual([5, 6, 8]);
    expect(s.grid?.affineRAS).toEqual(AFFINE);
    expect(s.unnamed).toBe(3);
    expect(s.labelmaps.map(l => [l.task, l.basename, l.datatype])).toEqual([
      ['trunk_cavities', '0.trunk_cavities.labels.nii.gz', 'uint8'],
      ['total', '0.total.labels.nii.gz', 'uint8'],
      ['vertebrae_pp', '0.vertebrae_pp.labels.nii.gz', 'uint8'],
    ]);
    expect(s.labelmaps[1].labels.map(l => [l.value, l.name, l.rawClass])).toEqual([
      [1, 'liver', 'liver'],
      [2, 'spleen', 'spleen'],
    ]);
  });

  it("refuses another major, the other mode's documents and another artifact, as every document is", () => {
    expect(() =>
      readAnatomy(makeAnatomyDoc({ contractVersion: 'pacsai.reading/2.0' }), 'clinical')
    ).toThrow(RsRefused);
    expect(() => readAnatomy(makeAnatomyDoc({ mode: 'fixture' }), 'clinical')).toThrow(
      /fixture documents/
    );
    expect(() => readAnatomy(makeAnatomyDoc({ artifact: 'report' }), 'clinical')).toThrow(
      /Expected a anatomy document/
    );
    // A newer minor is read, its unknown fields ignored.
    expect(
      readAnatomy(
        makeAnatomyDoc({ contractVersion: 'pacsai.reading/1.11', newField: 1 }),
        'clinical'
      ).series
    ).toHaveLength(1);
  });

  it('keeps a malformed series with the reason and no labelmaps: never part of a set', () => {
    const lm = makeAnatomyDoc().series[0].labelmaps as Array<Record<string, unknown>>;
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ seriesUID: 'not a uid' }, /names no series/],
      [{ grid: { shape: [5, 6], affineRAS: AFFINE } }, /grid/],
      [
        {
          grid: {
            shape: [5, 6, 8],
            affineRAS: [
              [1, 0, 0, 0],
              [0, 1, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 1],
            ],
          },
        },
        /grid/,
      ],
      [{ grid: null }, /labelmaps but no grid/],
      [{ labelmaps: 'none' }, /not a list/],
      [{ labelmaps: [{ ...lm[1], file: '../../etc/passwd' }] }, /anatomy\/<n>\.<task>/],
      [
        { labelmaps: [{ ...lm[1], file: 'anatomy/0.total.labels.nii.gz?x=1' }] },
        /anatomy\/<n>\.<task>/,
      ],
      [{ labelmaps: [{ ...lm[1], sha256: 'xyz' }] }, /sha256/],
      [{ labelmaps: [{ ...lm[1], datatype: 'float32' }] }, /uint8 or uint16/],
      [
        {
          labelmaps: [
            {
              ...lm[1],
              labels: [
                { value: 1, name: 'a', voxels: 1 },
                { value: 1, name: 'b', voxels: 1 },
              ],
            },
          ],
        },
        /share a value/,
      ],
      [{ labelmaps: [{ ...lm[1], labels: [{ value: 300, name: 'a', voxels: 1 }] }] }, /1 to 255/],
      [{ labelmaps: [{ ...lm[1], labels: [{ value: 1, name: 'a', voxels: -1 }] }] }, /voxel count/],
      [{ labelmaps: [lm[1], lm[1]] }, /both total/],
    ];
    for (const [over, why] of cases) {
      const s = series(over);
      expect(s.invalid).toMatch(why);
      expect(s.labelmaps).toEqual([]);
    }
  });

  it('reads a series whose labelmaps were withheld, and counts unnamed proposals however they are given', () => {
    const s = series({ labelmaps: [], labelmapsWithheld: 'the mask store lacks a label' });
    expect(s.invalid).toBeNull();
    expect(s.labelmaps).toEqual([]);
    expect(s.withheld).toBe('the mask store lacks a label');
    expect(series({ unnamed: [1, 2] }).unnamed).toBe(2);
    expect(series({ unnamed: { total: 2, vertebrae_pp: 1 } }).unnamed).toBe(3);
    expect(series({ unnamed: 'many' }).unnamed).toBe(0);
  });

  it('makes a phrase from the concept or class where the document gives none (null on dev for the vertebrae, the cavities, the hips)', () => {
    const lm = makeAnatomyDoc().series[0].labelmaps as Array<Record<string, unknown>>;
    const s = series({
      labelmaps: [
        {
          ...lm[1],
          labels: [
            { value: 1, name: null, concept: 'hip_left', rawClass: 'hip_left', voxels: 1 },
            { value: 2, name: '  ', concept: 'vertebra_L1', rawClass: 'vertebrae_L1', voxels: 1 },
            { value: 3, concept: null, rawClass: 'abdominal_cavity', voxels: 1 },
            { value: 4, name: null, voxels: 1 },
            { value: 5, name: 'liver', concept: 'liver', rawClass: 'liver', voxels: 1 },
          ],
        },
      ],
    });
    expect(s.invalid).toBeNull();
    expect(s.labelmaps[0].labels.map(l => [l.name, l.phraseGiven])).toEqual([
      ['left hip', false],
      ['L1 vertebra', false],
      ['abdominal cavity', false],
      ['label 4', false],
      ['liver', true],
    ]);
    expect(phraseOf('iliopsoas_right')).toBe('right iliopsoas');
    expect(phraseOf('vertebrae_T12')).toBe('T12 vertebra');
    expect(phraseOf('sternum')).toBe('sternum');
    expect(phraseOf('2.25.1')).toBe('');
    expect(phraseOf(null)).toBe('');
  });

  it("reads contract 1.13's per-label numbers leniently: what is malformed is left out, never the series", () => {
    const lm = makeAnatomyDoc().series[0].labelmaps as Array<Record<string, unknown>>;
    const labels = series({
      labelmaps: [
        {
          ...lm[1],
          labels: [
            {
              value: 1,
              name: 'liver',
              voxels: 1,
              measurementEligible: true,
              volumeMl: 12.5,
              volumeLowerBound: true,
              slices: 4,
              indexBox: [
                [2, 0, 0],
                [6, 9, 9],
              ],
              components: 1,
              touchesVolumeEdge: ['first_slice', 'elsewhere'],
              checks: {
                degraded: false,
                degradedBy: [],
                volumeInBand: null,
                relations: [
                  { kind: 'adjacency', status: 'consistent', reason: 'It touches the stomach.' },
                  { kind: 'vertebral_level', status: 'inconsistent', reason: '' },
                ],
              },
            },
            {
              value: 2,
              name: 'spleen',
              voxels: 1,
              measurementEligible: false,
              volumeMl: 9,
              volumeLowerBound: true,
              slices: -1,
              indexBox: [
                [6, 0, 0],
                [2, 9, 9],
              ],
              components: 'two',
              touchesVolumeEdge: 'first_slice',
              checks: {
                degraded: 'yes',
                relations: [{ kind: 'x', status: 'odd', reason: 'r' }, 'bad'],
              },
            },
            { value: 3, name: 'aorta', voxels: 1 },
          ],
        },
      ],
    });
    expect(labels.invalid).toBeNull();
    const [liver, spleen, aorta] = labels.labelmaps[0].labels;
    expect(liver).toMatchObject({
      measurementEligible: true,
      volumeMl: 12.5,
      volumeLowerBound: true,
      slices: 4,
      indexBox: [
        [2, 0, 0],
        [6, 9, 9],
      ],
      components: 1,
      touchesVolumeEdge: ['first_slice'],
      checks: {
        degraded: false,
        degradedBy: [],
        volumeInBand: null,
        relations: [
          { kind: 'adjacency', status: 'consistent', reason: 'It touches the stomach.' },
          // The contract's reason defaults to an empty string: kept, without one.
          { kind: 'vertebral_level', status: 'inconsistent', reason: null },
        ],
      },
    });
    // Not measurement eligible: no volume, whatever the document says; malformed numbers left out.
    expect(spleen).toMatchObject({
      measurementEligible: false,
      volumeMl: null,
      volumeLowerBound: false,
      slices: null,
      indexBox: null,
      components: null,
      touchesVolumeEdge: [],
      // The contract types a status as text: another one is kept (never shown); a non-object is left out.
      checks: {
        degraded: false,
        degradedBy: [],
        volumeInBand: null,
        relations: [{ kind: 'x', status: 'odd', reason: 'r' }],
      },
    });
    // A 1.10-shaped label: none of 1.13's numbers.
    expect(aorta).toMatchObject({
      measurementEligible: false,
      volumeMl: null,
      slices: null,
      checks: null,
    });
  });

  it("reads contract 1.14's attenuation for a measurement-eligible label only, and never without its statistic", () => {
    const lm = makeAnatomyDoc().series[0].labelmaps as Array<Record<string, unknown>>;
    const att = {
      statistic: 'whole-mask median',
      medianHU: 57.4,
      iqrHU: 12.6,
      supported: true,
      reasons: ['', 'ok'],
    };
    const labels = series({
      labelmaps: [
        {
          ...lm[1],
          labels: [
            {
              value: 1,
              name: 'liver',
              voxels: 1,
              measurementEligible: true,
              featureBundle: 'fb:' + 'a'.repeat(32),
              attenuation: att,
            },
            { value: 2, name: 'spleen', voxels: 1, measurementEligible: false, attenuation: att },
            {
              value: 3,
              name: 'aorta',
              voxels: 1,
              measurementEligible: true,
              attenuation: { ...att, statistic: '' },
            },
            {
              value: 4,
              name: 'right kidney',
              voxels: 1,
              measurementEligible: true,
              attenuation: {
                statistic: 'whole-mask median',
                medianHU: 'x',
                iqrHU: -3,
                supported: 'yes',
              },
            },
          ],
        },
      ],
    }).labelmaps[0].labels;
    expect(labels[0].attenuation).toEqual({ ...att, reasons: ['ok'] });
    expect(labels[1].attenuation).toBeNull(); // not measurement eligible
    expect(labels[2].attenuation).toBeNull(); // no statistic: never shown unnamed
    expect(labels[3].attenuation).toEqual({
      statistic: 'whole-mask median',
      medianHU: null,
      iqrHU: null,
      supported: false,
      reasons: [],
    });
  });

  it("reads contract 1.15's research radiomics on a measurement-eligible label only, and only as research", () => {
    const lm = makeAnatomyDoc().series[0].labelmaps as Array<Record<string, unknown>>;
    const computed = {
      use: 'research',
      featureSet: 'radiomics_v1',
      engine: 'pyradiomics 3.0.1',
      state: 'computed',
      reason: '',
      features: {
        firstorder_Median: 41.5,
        glcm_Contrast: null,
        'bad key': 1,
        shape_Sphericity: 'x',
        glrlm_RunEntropy: Infinity,
      },
    };
    const labels = series({
      labelmaps: [
        {
          ...lm[1],
          labels: [
            { value: 1, name: 'liver', voxels: 1, measurementEligible: true, radiomics: computed },
            {
              value: 2,
              name: 'spleen',
              voxels: 1,
              measurementEligible: false,
              radiomics: computed,
            },
            {
              value: 3,
              name: 'aorta',
              voxels: 1,
              measurementEligible: true,
              radiomics: { ...computed, use: 'clinical' },
            },
            {
              value: 4,
              name: 'right kidney',
              voxels: 1,
              measurementEligible: true,
              radiomics: {
                use: 'research',
                featureSet: 'radiomics_v1',
                engine: null,
                state: 'not_computed',
                reason: 'no radiomics engine is installed in this build',
                features: {},
              },
            },
            {
              value: 5,
              name: 'left kidney',
              voxels: 1,
              measurementEligible: true,
              radiomics: { use: 'research' },
            },
          ],
        },
      ],
    }).labelmaps[0].labels;
    expect(labels[0].radiomics).toEqual({
      use: 'research',
      featureSet: 'radiomics_v1',
      engine: 'pyradiomics 3.0.1',
      state: 'computed',
      reason: '',
      features: { firstorder_Median: 41.5, glcm_Contrast: null },
    });
    expect(labels[1].radiomics).toBeNull(); // not measurement eligible
    expect(labels[2].radiomics).toBeNull(); // not research: never shown as research features
    expect(labels[3].radiomics).toMatchObject({
      engine: null,
      state: 'not_computed',
      features: {},
    });
    expect(labels[4].radiomics).toBeNull(); // no state
  });

  it('takes an affine only as a 4 x 4 whose last row is 0 0 0 1 and whose 3 x 3 is invertible', () => {
    expect(readAffine(AFFINE)).toEqual(AFFINE);
    expect(
      readAffine([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ])
    ).toBeNull();
    expect(
      readAffine([
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 1, 1],
      ])
    ).toBeNull();
    expect(
      readAffine([
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, Infinity],
        [0, 0, 0, 1],
      ])
    ).toBeNull();
  });
});
