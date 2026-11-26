import { createHash, webcrypto } from 'crypto';
import {
  CSV_NOTE,
  exactValue,
  featureLabel,
  featureMatches,
  featureNote,
  featureOf,
  featureUnit,
  finiteCount,
  formatFeature,
  nextSort,
  radiomicsCsv,
  radiomicsTable,
  RADIOMICS_FAMILIES,
  sortFeatures,
  studyFileRef,
} from './radiomicsView';

/** ct-analysis-system's registry/features/radiomics_v1.yaml (main 85e2a914): its 80 features. */
const REGISTRY: Record<string, string[]> = {
  firstorder: [
    '10Percentile',
    '90Percentile',
    'Energy',
    'Entropy',
    'InterquartileRange',
    'Kurtosis',
    'Maximum',
    'Mean',
    'MeanAbsoluteDeviation',
    'Median',
    'Minimum',
    'Range',
    'RobustMeanAbsoluteDeviation',
    'RootMeanSquared',
    'Skewness',
    'Uniformity',
    'Variance',
  ],
  shape: [
    'Elongation',
    'Flatness',
    'LeastAxisLength',
    'MajorAxisLength',
    'Maximum3DDiameter',
    'MeshVolume',
    'MinorAxisLength',
    'Sphericity',
    'SurfaceArea',
    'SurfaceVolumeRatio',
    'VoxelVolume',
  ],
  glcm: [
    'ClusterProminence',
    'ClusterShade',
    'ClusterTendency',
    'Contrast',
    'Correlation',
    'DifferenceAverage',
    'DifferenceEntropy',
    'DifferenceVariance',
    'Id',
    'Idm',
    'Idmn',
    'Idn',
    'Imc1',
    'Imc2',
    'InverseVariance',
    'JointEnergy',
    'JointEntropy',
    'MaximumProbability',
    'SumEntropy',
    'SumSquares',
  ],
  glrlm: [
    'GrayLevelNonUniformity',
    'GrayLevelNonUniformityNormalized',
    'GrayLevelVariance',
    'LongRunEmphasis',
    'RunEntropy',
    'RunLengthNonUniformity',
    'RunLengthNonUniformityNormalized',
    'RunPercentage',
    'RunVariance',
    'ShortRunEmphasis',
  ],
  glszm: [
    'GrayLevelNonUniformity',
    'GrayLevelNonUniformityNormalized',
    'GrayLevelVariance',
    'LargeAreaEmphasis',
    'SizeZoneNonUniformity',
    'SizeZoneNonUniformityNormalized',
    'SmallAreaEmphasis',
    'ZoneEntropy',
    'ZonePercentage',
    'ZoneVariance',
  ],
  gldm: [
    'DependenceEntropy',
    'DependenceNonUniformity',
    'DependenceNonUniformityNormalized',
    'DependenceVariance',
    'GrayLevelNonUniformity',
    'GrayLevelVariance',
    'LargeDependenceEmphasis',
    'SmallDependenceEmphasis',
  ],
  ngtdm: ['Coarseness', 'Complexity', 'Contrast', 'Strength'],
};

describe("the Anatomy tab's radiomics, as a reader reads them (RS-36)", () => {
  it("lists the registry's 7 families in its order, 80 features in all", () => {
    expect(RADIOMICS_FAMILIES.map(([cls]) => cls)).toEqual(Object.keys(REGISTRY));
    expect(Object.values(REGISTRY).map(f => f.length)).toEqual([17, 11, 20, 10, 10, 8, 4]);
  });

  it('gives every registry feature a readable name: words, not CamelCase; the abbreviations spelt out', () => {
    for (const [cls, names] of Object.entries(REGISTRY)) {
      const labels = names.map(featureLabel);
      expect(new Set(labels).size).toBe(names.length);
      for (const label of labels) {
        expect(label).toMatch(/^[0-9A-Z]/);
        // No word run together, no capital past the first word but 2D/3D.
        expect(label.replace(/\b[23]D\b/g, '')).not.toMatch(/[a-z][A-Z]|\s[A-Z][a-z]/);
      }
      expect(featureOf(cls, names[0]).key).toBe(`${cls}_${names[0]}`);
    }
    expect(
      [
        '10Percentile',
        'InterquartileRange',
        'RobustMeanAbsoluteDeviation',
        'LeastAxisLength',
        'Maximum3DDiameter',
        'SurfaceVolumeRatio',
        'Id',
        'Idmn',
        'Imc2',
        'SumSquares',
        'GrayLevelNonUniformityNormalized',
        'SizeZoneNonUniformity',
        'Coarseness',
        'Foo3DBar',
      ].map(featureLabel)
    ).toEqual([
      '10th percentile',
      'Interquartile range',
      'Robust mean absolute deviation',
      'Least axis length',
      'Maximum 3D diameter',
      'Surface to volume ratio',
      'Inverse difference',
      'Inverse difference moment normalized',
      'Informational measure of correlation 2',
      'Sum of squares',
      'Gray level non-uniformity normalized',
      'Size zone non-uniformity',
      'Coarseness',
      'Foo 3D bar',
    ]);
  });

  it('gives units from the registry: HU and HU² in first order, mm, mm², mm³ and mm⁻¹ in shape, none in texture', () => {
    const units = (cls: string) =>
      Object.fromEntries(
        REGISTRY[cls].map(n => [n, featureUnit(cls, n)]).filter(([, u]) => u !== null)
      );
    expect(units('firstorder')).toEqual({
      '10Percentile': 'HU',
      '90Percentile': 'HU',
      Energy: 'HU²',
      InterquartileRange: 'HU',
      Maximum: 'HU',
      Mean: 'HU',
      MeanAbsoluteDeviation: 'HU',
      Median: 'HU',
      Minimum: 'HU',
      Range: 'HU',
      RobustMeanAbsoluteDeviation: 'HU',
      RootMeanSquared: 'HU',
      Variance: 'HU²',
    });
    expect(units('shape')).toEqual({
      LeastAxisLength: 'mm',
      MajorAxisLength: 'mm',
      Maximum3DDiameter: 'mm',
      MeshVolume: 'mm³',
      MinorAxisLength: 'mm',
      SurfaceArea: 'mm²',
      SurfaceVolumeRatio: 'mm⁻¹',
      VoxelVolume: 'mm³',
    });
    for (const cls of ['glcm', 'glrlm', 'glszm', 'gldm', 'ngtdm']) {
      expect(units(cls)).toEqual({});
    }
    // Energy and RootMeanSquared are of HU + 1000 (voxelArrayShift); the tooltip says so.
    expect(featureNote('firstorder', 'Energy')).toMatch(/HU \+ 1000/);
    expect(featureNote('firstorder', 'RootMeanSquared')).toMatch(/HU \+ 1000/);
    expect(featureNote('firstorder', 'Median')).toBeNull();
  });

  it('shows a value to about three significant digits, an exponent past 10,000 or under 0.001, a dash for none', () => {
    expect(
      [
        41.537,
        0.123456,
        1234.6,
        999.95,
        12345.6,
        123456.7,
        0.0001234,
        -2.5,
        -12345,
        0.001,
        0,
        null,
      ].map(formatFeature)
    ).toEqual([
      '41.5',
      '0.123',
      '1,235',
      '1,000',
      '1.23 × 10⁴',
      '1.23 × 10⁵',
      '1.23 × 10⁻⁴',
      '-2.5',
      '-1.23 × 10⁴',
      '0.001',
      '0',
      '—',
    ]);
    expect(exactValue(180.29846191406, 'HU', null)).toBe('180.29846191406 HU');
    expect(exactValue(0.25, null, null)).toBe('0.25');
    expect(exactValue(null, 'HU', null)).toBe('No finite value.');
    expect(exactValue(12, 'HU²', 'of HU + 1000')).toBe('12 HU², of HU + 1000');
  });

  it('finds features by their readable name or their key, and counts the finite values', () => {
    const f = featureOf('shape', 'LeastAxisLength');
    expect([
      featureMatches(f, 'axis'),
      featureMatches(f, 'SHAPE_least'),
      featureMatches(f, ' '),
    ]).toEqual([true, true, true]);
    expect(featureMatches(f, 'kurtosis')).toBe(false);
    expect(
      finiteCount([
        {
          features: [
            ['Median', 1],
            ['Mean', null],
          ],
        },
        { features: [['Contrast', 0]] },
      ])
    ).toBe(2);
  });

  it('builds the study table: every feature by family in the registry order, a column per structure', () => {
    const t = radiomicsTable([
      {
        key: '0/total/5',
        name: 'Kidney',
        featureSet: 'radiomics_v1',
        engine: 'pyradiomics 3.0.1',
        groups: [
          { cls: 'shape', features: [['Sphericity', 0.8]] },
          {
            cls: 'firstorder',
            features: [
              ['Median', 31.5],
              ['Mean', null],
            ],
          },
        ],
      },
      {
        key: '0/total/6',
        name: 'Kidney',
        featureSet: 'radiomics_v1',
        engine: 'pyradiomics 3.0.1',
        groups: [
          {
            cls: 'firstorder',
            features: [
              ['Median', 29],
              ['Kurtosis', 2.1],
            ],
          },
        ],
      },
    ]);
    expect(t.families.map(f => [f.cls, f.title, f.features.map(x => x.name)])).toEqual([
      ['firstorder', 'First order', ['Median', 'Mean', 'Kurtosis']],
      ['shape', 'Shape', ['Sphericity']],
    ]);
    expect(t.columns.map(c => [c.key, c.name])).toEqual([
      ['0/total/5', 'Kidney'],
      ['0/total/6', 'Kidney (2)'],
    ]);
    expect(t.columns[1].values.get('shape_Sphericity')).toBeUndefined();
    expect([t.featureSet, t.engine]).toEqual(['radiomics_v1', 'pyradiomics 3.0.1']);
  });

  it('sorts each family by name or by a column (its nulls last), then back to the registry order', () => {
    expect(nextSort(null, 'name')).toEqual({ by: 'name', dir: 1 });
    expect(nextSort({ by: 'name', dir: 1 }, 'name')).toEqual({ by: 'name', dir: -1 });
    expect(nextSort({ by: 'name', dir: -1 }, 'name')).toBeNull();
    expect(nextSort({ by: 'name', dir: -1 }, 'k')).toEqual({ by: 'k', dir: 1 });
    const fs = ['Median', 'Mean', 'Kurtosis', 'Skewness'].map(n => featureOf('firstorder', n));
    const columns = [
      {
        key: 'k',
        name: 'Kidney',
        values: new Map<string, number | null>([
          ['firstorder_Median', 30],
          ['firstorder_Mean', null],
          ['firstorder_Kurtosis', 2],
          ['firstorder_Skewness', -1],
        ]),
      },
    ];
    const names = (sort: Parameters<typeof sortFeatures>[1]) =>
      sortFeatures(fs, sort, columns).map(f => f.name);
    expect(names(null)).toEqual(['Median', 'Mean', 'Kurtosis', 'Skewness']);
    expect(names({ by: 'name', dir: 1 })).toEqual(['Kurtosis', 'Mean', 'Median', 'Skewness']);
    expect(names({ by: 'name', dir: -1 })).toEqual(['Skewness', 'Median', 'Mean', 'Kurtosis']);
    expect(names({ by: 'k', dir: 1 })).toEqual(['Skewness', 'Kurtosis', 'Median', 'Mean']);
    expect(names({ by: 'k', dir: -1 })).toEqual(['Median', 'Kurtosis', 'Skewness', 'Mean']);
  });

  it('writes the CSV: its research note first, then unrounded values, empty for none, cells quoted when they must be', () => {
    const csv = radiomicsCsv(
      radiomicsTable([
        {
          key: 'a',
          name: 'Kidney, left',
          featureSet: 'radiomics_v1',
          engine: 'pyradiomics 3.0.1',
          groups: [
            {
              cls: 'firstorder',
              features: [
                ['Median', 31.123456789],
                ['Mean', null],
              ],
            },
            { cls: 'shape', features: [['VoxelVolume', 123456.5]] },
          ],
        },
      ])
    );
    expect(csv.split('\r\n')).toEqual([
      `${CSV_NOTE} radiomics_v1 by pyradiomics 3.0.1`,
      'family,feature,name,unit,"Kidney, left"',
      'firstorder,firstorder_Median,Median,HU,31.123456789',
      'firstorder,firstorder_Mean,Mean,HU,',
      'shape,shape_VoxelVolume,Voxel volume,mm³,123456.5',
      '',
    ]);
    expect(CSV_NOTE).not.toMatch(/[,;]/);
  });

  it("names the study's file by the CT side's study ref (the UID's SHA-256, 12 hex), never the UID", async () => {
    const uid = '1.2.840.113619.2.55.3.1234';
    const want = `study-${createHash('sha256').update(uid).digest('hex').slice(0, 12)}`;
    await expect(
      studyFileRef(uid, { subtle: webcrypto.subtle as unknown as SubtleCrypto })
    ).resolves.toBe(want);
    // Without Web Crypto, the viewer's own ref, made safe for a file name.
    await expect(
      studyFileRef(uid, { subtle: null, fallback: () => 'fnv1a64:0a1b2c' })
    ).resolves.toBe('fnv1a64-0a1b2c');
    await expect(studyFileRef(uid, { subtle: null })).resolves.toBe('study');
  });
});
