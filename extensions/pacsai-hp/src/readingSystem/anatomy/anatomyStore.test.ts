import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { RsRefused } from '../rsContract';
import { RsHttpError } from '../rsClient';
import { readAnatomy } from './anatomyContract';
import type { Mat4 } from './anatomyGeometry';
import {
  AFFINE,
  CAVITIES,
  GRID,
  ORGANS,
  SERIES,
  STUDY,
  VERTEBRAE,
  countOf,
  gridVolume,
  makeAnatomyDoc,
  makeNifti,
} from './anatomyTestData';
import { vertebraColor } from './anatomyColors';
import {
  alphasFor,
  createAnatomyStore,
  readSettings,
  taskTitle,
  type AnatomyTarget,
} from './anatomyStore';

const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const dims: [number, number, number] = [GRID.nx, GRID.ny, GRID.nz];

interface Setup {
  /** Per task: the labelmap's voxels, sform and qform. */
  voxels?: Partial<Record<string, number[]>>;
  sform?: Partial<Record<string, Mat4>>;
  qform?: Partial<
    Record<
      string,
      {
        b: number;
        c: number;
        d: number;
        offset: [number, number, number];
        pixdim: [number, number, number];
        qfac: number;
      }
    >
  >;
  /** Per task: the sha256 the document names (default: the file's). */
  docSha?: Partial<Record<string, string>>;
  /** Per task: the voxel counts the document gives, by label value. */
  docVoxels?: Partial<Record<string, Record<number, number>>>;
  fileDims?: [number, number, number];
  anatomy?: () => Promise<unknown>;
  storage?: { value: string | null };
  /** Changes to the document before the test reads it (its sha256 values are set after). */
  mutate?: (raw: ReturnType<typeof makeAnatomyDoc>) => void;
}

function setup(o: Setup = {}) {
  const base: Record<string, number[]> = {
    trunk_cavities: CAVITIES,
    total: ORGANS,
    vertebrae_pp: VERTEBRAE,
  };
  const files: Record<string, Uint8Array> = {};
  for (const task of Object.keys(base)) {
    files[`0.${task}.labels.nii.gz`] = new Uint8Array(
      gzipSync(
        makeNifti({
          dims: o.fileDims ?? dims,
          data: o.voxels?.[task] ?? base[task],
          sform: o.sform?.[task] ?? AFFINE,
          qform: o.qform?.[task] ?? null,
        })
      )
    );
  }
  const raw = makeAnatomyDoc();
  o.mutate?.(raw);
  for (const lm of raw.series[0].labelmaps as Array<{
    task: string;
    sha256: string;
    labels: Array<{ value: number; voxels: number }>;
  }>) {
    lm.sha256 = o.docSha?.[lm.task] ?? sha(files[`0.${lm.task}.labels.nii.gz`]);
    const counts = o.docVoxels?.[lm.task];
    if (counts) {
      lm.labels.forEach(l => (l.voxels = counts[l.value] ?? l.voxels));
    }
  }
  const navigations: AnatomyTarget[] = [];
  const client = {
    anatomy: jest.fn(o.anatomy ?? (async () => readAnatomy(raw, 'clinical'))),
    anatomyFile: jest.fn(async (_study: string, basename: string) => {
      const f = files[basename];
      if (!f) {
        throw new RsHttpError(404, 'labelmap');
      }
      return f;
    }),
  };
  const storage = o.storage ?? { value: null };
  const store = createAnatomyStore({
    client: client as never,
    digest: async b => sha(b),
    gunzip: async b => new Uint8Array(gunzipSync(b)),
    storage: { get: () => storage.value, set: v => (storage.value = v) },
    studyRef: uid => `ref-${uid.length}`,
  });
  store.setNavigator(t => {
    navigations.push(t);
    return true;
  });
  return { store, client, storage, navigations };
}

const keyOf = (task: string, value: number) => `0/${task}/${value}`;

describe('the anatomy layers’ state (RS-36)', () => {
  it('has no anatomy for a study the reading system publishes none for (404), and says why when refused or failed', async () => {
    const none = setup({ anatomy: async () => Promise.reject(new RsHttpError(404, 'anatomy')) });
    none.store.enter(STUDY);
    expect(none.store.getSnapshot().phase).toBe('loading');
    await flush();
    expect(none.store.getSnapshot()).toMatchObject({ phase: 'none', reason: null });
    const refused = setup({ anatomy: async () => Promise.reject(new RsRefused('wrong major')) });
    refused.store.enter(STUDY);
    await flush();
    expect(refused.store.getSnapshot()).toMatchObject({ phase: 'refused', reason: 'wrong major' });
    const failed = setup({ anatomy: async () => Promise.reject(new RsHttpError(502, 'anatomy')) });
    failed.store.enter(STUDY);
    await flush();
    expect(failed.store.getSnapshot()).toMatchObject({
      phase: 'failed',
      reason: expect.stringMatching(/HTTP 502/),
    });
  });

  it('reads every labelmap, the shown tasks first, the body cavities last and hidden; structures head to feet with their volumes', async () => {
    const { store, client } = setup();
    store.enter(STUDY);
    await flush();
    const snap = store.getSnapshot();
    expect(snap.phase).toBe('ready');
    expect(snap.notes).toEqual([]);
    const tasks = snap.series[0].tasks;
    expect(tasks.map(t => [t.task, t.title, t.visible, t.status])).toEqual([
      ['total', 'Organs and structures', true, 'ready'],
      ['vertebrae_pp', 'Vertebrae', true, 'ready'],
      ['trunk_cavities', 'Body cavities', false, 'ready'],
    ]);
    expect(client.anatomyFile.mock.calls.map(c => c[1])).toEqual([
      '0.total.labels.nii.gz',
      '0.vertebrae_pp.labels.nii.gz',
      '0.trunk_cavities.labels.nii.gz',
    ]);
    // The spleen (slice 3) sits above the liver (slices 1-3, centroid at slice 2): superior first.
    expect(tasks[0].structures).toEqual([keyOf('total', 2), keyOf('total', 1)]);
    const liver = snap.structures[keyOf('total', 1)];
    expect(liver).toMatchObject({ name: 'liver', voxels: 27, slices: [1, 3], visible: true });
    expect(liver.volume).toEqual({ ml: expect.any(Number), atLeast: false, from: 'voxels' });
    expect(liver.volume!.ml).toBeCloseTo((27 * 12) / 1000, 9);
    // Its slice extent from its labelmap: slices 1-3 of 0-4, so not past the scan's ends.
    expect(liver.extent).toEqual({ slices: 3, atLeast: false, mm: 9 });
    // §2.3: only a measurement-eligible structure shows a volume.
    expect(snap.structures[keyOf('vertebrae_pp', 1)].volume).toBeNull();
    expect(snap.structures[keyOf('trunk_cavities', 1)].volume).toBeNull();
    // The cavity runs to the scan's last slice: its extent is at least what is seen.
    expect(snap.structures[keyOf('trunk_cavities', 1)].extent).toEqual({
      slices: 4,
      atLeast: true,
      mm: 12,
    });
    expect(liver.superior).toBeCloseTo(16, 9);
    expect(snap.series[0].description).toBe('5 slices, 2 × 2 × 3 mm');
    expect(snap.series[0].unnamed).toBe(3);
  });

  it('refuses a labelmap that is not the file the document names, its grid, its voxel type or its counts, and draws the rest', async () => {
    const cases: Array<[Setup, RegExp]> = [
      [{ docSha: { total: 'e'.repeat(64) } }, /sha256/],
      [
        { sform: { total: AFFINE.map((r, i) => (i === 0 ? [r[0], r[1], r[2], r[3] + 0.01] : r)) } },
        /affine is not the series' grid/,
      ],
      [{ docVoxels: { total: { 1: 28 } } }, /do not hold the voxels the document counts/],
    ];
    for (let n = 0; n < cases.length; n++) {
      const [o, why] = cases[n];
      const { store } = setup(o);
      store.enter(STUDY);
      await flush();
      const snap = store.getSnapshot();
      const total = snap.series[0].tasks.find(t => t.task === 'total')!;
      expect(total.status).toBe('refused');
      expect(total.reason).toMatch(why);
      expect(snap.notes.join(' ')).toMatch(why);
      expect(snap.series[0].tasks.find(t => t.task === 'vertebrae_pp')!.status).toBe('ready');
      expect(store.renderSetFor(SERIES)!.tasks).toEqual(['vertebrae_pp']);
    }
    const wrongSize = setup({
      fileDims: [GRID.nx, GRID.ny, GRID.nz - 1],
      voxels: {
        total: ORGANS.slice(0, 8 * 6 * 4),
        vertebrae_pp: VERTEBRAE.slice(0, 192),
        trunk_cavities: CAVITIES.slice(0, 192),
      },
    });
    wrongSize.store.enter(STUDY);
    await flush();
    expect(wrongSize.store.getSnapshot().series[0].tasks.every(t => t.status === 'refused')).toBe(
      true
    );
    expect(wrongSize.store.getSnapshot().notes[0]).toMatch(/size is not the series' grid/);
  });

  it('notes a qform that differs from the sform and draws by the sform, and notes values the document does not name', async () => {
    const { store } = setup({
      qform: { total: { b: 0, c: 0, d: 0, offset: [0, 0, 0], pixdim: [2, 2, 3], qfac: 1 } },
      voxels: { vertebrae_pp: VERTEBRAE.map((v, n) => (n === 0 ? 7 : v)) },
    });
    store.enter(STUDY);
    await flush();
    const snap = store.getSnapshot();
    expect(snap.series[0].tasks.every(t => t.status === 'ready')).toBe(true);
    expect(snap.notes).toEqual([
      expect.stringMatching(/^Organs and structures: the header's qform differs from its sform/),
      expect.stringMatching(/^Vertebrae: 1 voxels hold a value the document does not name/),
    ]);
  });

  it("reads contract 1.13's numbers where the document gives them: the volume (eligible only, at least when bounded), extent, parts and the record's checks", async () => {
    const { store } = setup({
      mutate: raw => {
        const total = raw.series[0].labelmaps[1] as { labels: Array<Record<string, unknown>> };
        Object.assign(total.labels[0], {
          volumeMl: 1464.23,
          volumeLowerBound: true,
          slices: 3,
          indexBox: [
            [1, 0, 0],
            [4, 3, 3],
          ],
          components: 2,
          touchesVolumeEdge: ['last_slice', 'first_row', 'nonsense'],
          checks: {
            degraded: true,
            degradedBy: ['volume_outside_band', 'motion'],
            volumeInBand: false,
            relations: [
              {
                kind: 'laterality_from_midline',
                status: 'inconsistent',
                reason: 'it lies left of the midline',
              },
              { kind: 'adjacency', status: 'inconsistent', reason: '' },
              { kind: 'adjacency', status: 'consistent', reason: 'It touches the right kidney.' },
              {
                kind: 'vertebral_level',
                status: 'unevaluable',
                reason: 'No vertebra is labelled.',
              },
              { kind: 'odd', status: 'maybe', reason: 'dropped' },
            ],
          },
        });
        // A volume on a structure that is not measurement eligible is never shown.
        const spine = raw.series[0].labelmaps[2] as { labels: Array<Record<string, unknown>> };
        Object.assign(spine.labels[0], { volumeMl: 30 });
      },
    });
    store.enter(STUDY);
    await flush();
    const snap = store.getSnapshot();
    const liver = snap.structures[keyOf('total', 1)];
    expect(liver.volume).toEqual({ ml: 1464.23, atLeast: true, from: 'document' });
    expect(liver.extent).toEqual({ slices: 3, atLeast: true, mm: 9 });
    expect(liver.components).toBe(2);
    expect(liver.outOfBand).toBe(true);
    expect(liver.warnings).toEqual([
      'Degraded: its volume lies outside the expected band; motion.',
      'Laterality from midline: it lies left of the midline.',
      'Adjacency: inconsistent with its record.',
    ]);
    expect(snap.structures[keyOf('vertebrae_pp', 1)].volume).toBeNull();
    // A structure without 1.13's extent takes its labelmap's.
    expect(snap.structures[keyOf('total', 2)].extent).toEqual({ slices: 1, atLeast: false, mm: 3 });
  });

  it("keeps 1.14's whole-mask median for the tab, and never another statistic in its place", async () => {
    const { store } = setup({
      mutate: raw => {
        const total = raw.series[0].labelmaps[1] as { labels: Array<Record<string, unknown>> };
        total.labels[0].attenuation = {
          statistic: 'whole-mask median',
          medianHU: 57.4,
          iqrHU: 12.6,
          supported: true,
          reasons: [],
        };
        total.labels[1].attenuation = {
          statistic: 'ROI median',
          medianHU: 50,
          iqrHU: 5,
          supported: true,
          reasons: [],
        };
      },
    });
    store.enter(STUDY);
    await flush();
    const snap = store.getSnapshot();
    expect(snap.structures[keyOf('total', 1)].attenuation).toEqual({
      median: 57.4,
      iqr: 12.6,
      supported: true,
      reasons: [],
    });
    expect(snap.structures[keyOf('total', 2)].attenuation).toBeNull();
    expect(snap.structures[keyOf('vertebrae_pp', 1)].attenuation).toBeNull();
  });

  it("groups 1.15's research features by class in pyradiomics' order, a class it does not know last", async () => {
    const { store } = setup({
      mutate: raw => {
        const total = raw.series[0].labelmaps[1] as { labels: Array<Record<string, unknown>> };
        total.labels[0].radiomics = {
          use: 'research',
          featureSet: 'radiomics_v1',
          engine: 'pyradiomics 3.0.1',
          state: 'computed',
          reason: '',
          features: {
            ngtdm_Busyness: 0.5,
            firstorder_Median: 41.5,
            zzz_Extra: 1,
            shape_Sphericity: 0.8,
            firstorder_Mean: null,
          },
        };
      },
    });
    store.enter(STUDY);
    await flush();
    const r = store.getSnapshot().structures[keyOf('total', 1)].radiomics!;
    expect(r).toMatchObject({
      featureSet: 'radiomics_v1',
      engine: 'pyradiomics 3.0.1',
      state: 'computed',
      reason: '',
    });
    expect(r.groups.map(g => [g.cls, g.title, g.features])).toEqual([
      [
        'firstorder',
        'First order',
        [
          ['Median', 41.5],
          ['Mean', null],
        ],
      ],
      ['shape', 'Shape', [['Sphericity', 0.8]]],
      ['ngtdm', 'NGTDM (neighbourhood tone difference)', [['Busyness', 0.5]]],
      ['zzz', 'zzz', [['Extra', 1]]],
    ]);
    expect(store.getSnapshot().structures[keyOf('total', 2)].radiomics).toBeNull();
  });

  it("keeps the reader's settings in the browser: on or off, opacity (10 to 100 %), fill or outline", async () => {
    const storage = { value: JSON.stringify({ enabled: false, opacity: 0.6, style: 'outline' }) };
    const { store } = setup({ storage });
    expect(store.getSnapshot().settings).toEqual({
      enabled: false,
      opacity: 0.6,
      style: 'outline',
    });
    store.setEnabled(true);
    store.setOpacity(2);
    store.setStyle('fill');
    expect(JSON.parse(storage.value!)).toEqual({ enabled: true, opacity: 1, style: 'fill' });
    store.setOpacity(0);
    expect(store.getSnapshot().settings.opacity).toBe(0.1);
    expect(readSettings('not json')).toEqual({ enabled: true, opacity: 0.35, style: 'fill' });
    expect(readSettings(JSON.stringify({ opacity: 'x', style: 'glow' }))).toEqual({
      enabled: true,
      opacity: 0.35,
      style: 'fill',
    });
    const fill = alphasFor({ enabled: true, opacity: 0.35, style: 'fill' });
    expect(fill.fill).toBeCloseTo(0.35, 9);
    expect(fill.edge).toBeCloseTo(0.7, 9);
    const outline = alphasFor({ enabled: true, opacity: 0.35, style: 'outline' });
    expect(outline.fill).toBe(0);
    expect(outline.edge).toBeCloseTo(0.8, 9);
  });

  it('draws the shown tasks and structures of a series with anatomy, nothing when off, and nothing on a series that does not fit', async () => {
    const { store } = setup();
    store.enter(STUDY);
    await flush();
    expect(store.seriesOf(SERIES)).toBe(0);
    expect(store.seriesOf('2.25.9')).toBeNull();
    expect(store.renderSetFor('2.25.9')).toBeNull();
    let rs = store.renderSetFor(SERIES)!;
    expect(rs.tasks).toEqual(['total', 'vertebrae_pp']);
    expect(rs.layers[0].colors[1]).not.toBe(0);
    store.setStructureVisible(keyOf('total', 1), false);
    rs = store.renderSetFor(SERIES)!;
    expect(rs.layers[0].colors[1]).toBe(0);
    expect(rs.layers[0].colors[2]).not.toBe(0);
    store.setTaskVisible(0, 'trunk_cavities', true);
    // The cavities draw under the organs they contain.
    expect(store.renderSetFor(SERIES)!.tasks).toEqual(['trunk_cavities', 'total', 'vertebrae_pp']);
    store.hover(keyOf('total', 2));
    expect(store.renderSetFor(SERIES)!.highlight).toEqual({ layer: 1, value: 2 });
    store.hover(null);
    expect(store.renderSetFor(SERIES)!.highlight).toBeNull();
    store.setEnabled(false);
    expect(store.renderSetFor(SERIES)).toBeNull();
    store.setEnabled(true);
    store.reportFit(SERIES, {
      fits: false,
      worst: 0.5,
      reason: "an image's pixels sit between the labelmap's voxels",
    });
    expect(store.renderSetFor(SERIES)).toBeNull();
    expect(store.getSnapshot().notes).toEqual([
      expect.stringMatching(/^Not drawn on one series: an image's pixels sit between/),
    ]);
  });

  it('names the visible structures under a viewer point, topmost first', async () => {
    const { store } = setup();
    store.enter(STUDY);
    await flush();
    // LPS of voxel (1, 1, 3): (-8 + 2, -6 + 2, 10 + 9).
    const names = () => store.structuresAt(SERIES, [-6, -4, 19]).map(s => s.name);
    expect(names()).toEqual(['liver']);
    store.setTaskVisible(0, 'trunk_cavities', true);
    expect(names()).toEqual(['liver', 'abdominal cavity']);
    expect(store.structuresAt(SERIES, [100, 100, 100])).toEqual([]);
  });

  it('selecting a structure shows it, its task and the layers, and asks the navigator for its largest slice (LPS)', async () => {
    const { store, navigations, storage } = setup();
    store.enter(STUDY);
    await flush();
    store.setEnabled(false);
    store.setStructureVisible(keyOf('trunk_cavities', 1), false);
    store.select(keyOf('trunk_cavities', 1));
    const snap = store.getSnapshot();
    expect(snap.selected).toBe(keyOf('trunk_cavities', 1));
    expect(snap.settings.enabled).toBe(true);
    expect(JSON.parse(storage.value!).enabled).toBe(true);
    expect(snap.structures[keyOf('trunk_cavities', 1)].visible).toBe(true);
    expect(snap.series[0].tasks.find(t => t.task === 'trunk_cavities')!.visible).toBe(true);
    // The cavity's slices 1-4 hold 48 voxels each: its largest is the first, centred at voxel (3.5, 2.5, 1).
    expect(navigations).toEqual([
      { key: keyOf('trunk_cavities', 1), seriesUID: SERIES, point: [-1, -1, 13] },
    ]);
    store.select(keyOf('total', 1));
    expect(navigations[1].point).toEqual([-6, -4, 13]); // the liver's first full slice, voxel (1, 1, 1)
    expect(store.renderSetFor(SERIES)!.highlight).toEqual({ layer: 1, value: 1 });
    store.select(null);
    expect(store.getSnapshot().selected).toBeNull();
  });

  it('colours vertebrae in their head-to-feet order, so neighbours never share a colour whatever their values', async () => {
    // L1 holds value 1 in slices 0-1 and T12 value 2 in slices 3-4: T12 is the upper one.
    const spine = gridVolume((i, j, k) =>
      i >= 3 && i <= 4 && j >= 4 ? (k <= 1 ? 1 : k >= 3 ? 2 : 0) : 0
    );
    const { store } = setup({
      voxels: { vertebrae_pp: spine },
      mutate: raw => {
        const lm = raw.series[0].labelmaps[2] as { labels: Array<Record<string, unknown>> };
        lm.labels = [
          {
            value: 1,
            concept: 'vertebra_L1',
            name: null,
            rawClass: 'vertebrae_L1',
            voxels: countOf(spine, 1),
          },
          {
            value: 2,
            concept: 'vertebra_T12',
            name: null,
            rawClass: 'vertebrae_T12',
            voxels: countOf(spine, 2),
          },
        ];
      },
    });
    store.enter(STUDY);
    await flush();
    const snap = store.getSnapshot();
    const task = snap.series[0].tasks.find(t => t.task === 'vertebrae_pp')!;
    expect(task.structures.map(k => snap.structures[k].name)).toEqual([
      'T12 vertebra',
      'L1 vertebra',
    ]);
    expect(snap.structures[keyOf('vertebrae_pp', 2)].color).toEqual(vertebraColor(0));
    expect(snap.structures[keyOf('vertebrae_pp', 1)].color).toEqual(vertebraColor(1));
    expect(vertebraColor(0)).not.toEqual(vertebraColor(1));
  });

  it('names nothing by UID in the harness state, and lets go of a study it leaves', async () => {
    const { store } = setup();
    store.enter(STUDY);
    await flush();
    store.select(keyOf('total', 1));
    const state = store.harnessState();
    expect(JSON.stringify(state)).not.toMatch(/2\.25\./);
    expect(state).toMatchObject({
      phase: 'ready',
      series: 1,
      labelmaps: { ready: 3, loading: 0, refused: 0 },
      structures: 4,
      selected: 'total/1',
    });
    store.leave();
    expect(store.getSnapshot()).toMatchObject({
      phase: 'idle',
      series: [],
      structures: {},
      selected: null,
    });
    expect(store.renderSetFor(SERIES)).toBeNull();
  });

  it('drops a study left while its labelmaps load', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => (release = r));
    const { store, client } = setup();
    const original = client.anatomyFile.getMockImplementation()!;
    client.anatomyFile.mockImplementation(async (s: string, b: string) => {
      await gate;
      return original(s, b);
    });
    store.enter(STUDY);
    await flush();
    store.leave();
    release();
    await flush();
    expect(store.getSnapshot().phase).toBe('idle');
    expect(store.getSnapshot().series).toEqual([]);
    expect(taskTitle('lung_vessels')).toBe('Lung vessels');
  });
});
