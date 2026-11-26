import { act, fireEvent } from '@testing-library/react';
import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import type { RsController, RsSnapshot } from '../rsController';
import { createRsHost } from '../rsHost';
import { makeEvidence, makeInbox, makeReport, makeVersions } from '../testDocs';
import { RsHttpError } from '../rsClient';
import { RsRefused } from '../rsContract';
import { readAnatomy } from './anatomyContract';
import { createAnatomyStore, type AnatomyClient, type AnatomyTarget } from './anatomyStore';
import { formatVolume, LOCALIZATION_TITLE, resampledNote } from './AnatomyTab';
import {
  AFFINE,
  CAVITIES,
  GRID,
  ORGANS,
  STUDY,
  VERTEBRAE,
  makeAnatomyDoc,
  makeNifti,
} from './anatomyTestData';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function fakeController() {
  let state: RsSnapshot = {
    phase: 'ready',
    reason: null,
    docs: {
      report: makeReport(),
      versions: makeVersions(),
      inbox: makeInbox(),
      evidence: makeEvidence(),
    },
    selection: null,
    copilotOpen: false,
    tab: 'draft',
    collapsed: false,
    busy: false,
    notice: null,
    canRetry: false,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<RsSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach(l => l());
  };
  const c = {
    getSnapshot: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setTab: jest.fn((tab: RsSnapshot['tab']) => set({ tab })),
    offerTab: jest.fn((tab: RsSnapshot['tab']) => set({ tab })),
    setCollapsed: jest.fn((collapsed: boolean) => set({ collapsed })),
    toggleCopilot: jest.fn(() => true),
    closeCopilot: jest.fn(),
    select: jest.fn(),
    moveSelection: jest.fn(),
    dismissNotice: jest.fn(),
    harnessState: () => ({}),
  };
  return c as unknown as RsController & typeof c;
}

async function store(
  anatomy?: () => Promise<unknown>,
  mutate?: (raw: ReturnType<typeof makeAnatomyDoc>) => void
) {
  const base: Record<string, number[]> = {
    trunk_cavities: CAVITIES,
    total: ORGANS,
    vertebrae_pp: VERTEBRAE,
  };
  const files: Record<string, Uint8Array> = {};
  const raw = makeAnatomyDoc();
  mutate?.(raw);
  for (const lm of raw.series[0].labelmaps as Array<{ task: string; sha256: string }>) {
    const f = new Uint8Array(
      gzipSync(makeNifti({ dims: [GRID.nx, GRID.ny, GRID.nz], data: base[lm.task], sform: AFFINE }))
    );
    files[`0.${lm.task}.labels.nii.gz`] = f;
    lm.sha256 = sha(f);
  }
  const s = createAnatomyStore({
    client: {
      anatomy: (anatomy ?? (async () => readAnatomy(raw, 'clinical'))) as AnatomyClient['anatomy'],
      anatomyFile: async (_s: string, b: string) => files[b],
    },
    digest: async b => sha(b),
    gunzip: async b => new Uint8Array(gunzipSync(b)),
    studyRef: () => 'ref',
  });
  const navigations: AnatomyTarget[] = [];
  s.setNavigator(t => {
    navigations.push(t);
    return true;
  });
  return { s, navigations };
}

function mount(controller: RsController, anatomy: ReturnType<typeof createAnatomyStore> | null) {
  const column = document.createElement('section');
  document.body.append(column);
  column.getBoundingClientRect = () =>
    ({
      height: 1000,
      width: 600,
      top: 0,
      left: 0,
      right: 600,
      bottom: 1000,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
  let host: ReturnType<typeof createRsHost> | null = null;
  act(() => {
    host = createRsHost({ win: window, column, controller, anatomy, setInset: () => {} });
  });
  return { column, destroy: () => act(() => host?.destroy()) };
}

const tabs = (column: HTMLElement) =>
  Array.from(column.querySelectorAll('[role="tab"]')).map(t => t.textContent);

afterEach(() => {
  document.body.innerHTML = '';
});

describe("the pane's Anatomy tab (RS-36)", () => {
  it('comes first once the anatomy is read and is offered at the study; lists each task head to feet with volumes', async () => {
    const controller = fakeController();
    const { s } = await store();
    const { column, destroy } = mount(controller, s);
    expect(tabs(column)).toEqual(['Draft', 'Inbox (0)', 'Changes (0)']);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    expect(controller.offerTab).toHaveBeenCalledWith('anatomy');
    expect(tabs(column)).toEqual(['Anatomy (4)', 'Draft', 'Inbox (0)', 'Changes (0)']);
    expect(column.querySelector('[data-rs-panel]')?.getAttribute('data-rs-panel')).toBe('anatomy');
    const groups = Array.from(column.querySelectorAll('[data-rs-anatomy-task]'));
    expect(groups.map(g => g.getAttribute('data-rs-anatomy-task'))).toEqual([
      'total',
      'vertebrae_pp',
      'trunk_cavities',
    ]);
    const rows = (g: Element) =>
      Array.from(g.querySelectorAll('tr[data-rs-structure]')).map(r => [
        r.getAttribute('data-rs-structure'),
        r.querySelector('.prs-structure')?.textContent,
        r.querySelector('[data-rs-extent]')?.textContent,
        r.querySelector('[data-rs-volume]')?.textContent,
      ]);
    expect(Array.from(groups[0].querySelectorAll('th')).map(th => th.textContent)).toEqual([
      '',
      'Extent',
      'Volume',
    ]);
    expect(rows(groups[0])).toEqual([
      ['total/2', 'Spleen', '1 sl', '0.11 mL'],
      ['total/1', 'Liver', '3 sl', '0.32 mL'],
    ]);
    // §2.3: a structure that is not measurement eligible shows no number; it says it is for
    // localization only (invariant 8).
    expect(rows(groups[1])).toEqual([
      ['vertebrae_pp/1', 'L1 vertebra', '≥ 2 sl', 'localization only'],
    ]);
    expect(groups[1].querySelector('[data-rs-localization-only]')?.getAttribute('title')).toBe(
      LOCALIZATION_TITLE
    );
    // The body cavities start hidden, folded.
    expect(groups[2].querySelectorAll('tr')).toHaveLength(0);
    expect(
      (groups[2].querySelector('[data-rs-anatomy-task-toggle]') as HTMLInputElement).checked
    ).toBe(false);
    expect(column.textContent).toMatch(/3 unnamed proposals are not drawn/);
    expect(column.textContent).toMatch(/not reviewed, never saved as a segmentation/);
    // No other series of the acquisition carries it (yet): no word of resampling.
    expect(column.querySelector('[data-rs-anatomy-resampled]')).toBeNull();
    destroy();
  });

  it('says which other series of the acquisition carry the labelmap, resampled, and how coarse it is there', async () => {
    const controller = fakeController();
    const { s } = await store();
    const { column, destroy } = mount(controller, s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    act(() => s.reportRelated(s.anatomySeries()[0], 2));
    expect(column.querySelector('[data-rs-anatomy-resampled]')?.textContent).toBe(
      'Also drawn on 2 other series of the same acquisition, resampled from this labelmap: along the body, their outlines step every 3 mm.'
    );
    act(() => s.reportRelated(s.anatomySeries()[0], 0));
    expect(column.querySelector('[data-rs-anatomy-resampled]')).toBeNull();
    // A grid whose slices do not run along the body says so plainly.
    expect(
      resampledNote({
        index: 0,
        description: '',
        withheld: null,
        unnamed: 0,
        invalid: null,
        tasks: [],
        related: 1,
        sliceMm: 0.75,
        alongBody: false,
      })
    ).toBe(
      'Also drawn on 1 other series of the same acquisition, resampled from this labelmap: across its slices, their outlines step every 0.75 mm.'
    );
    destroy();
  });

  it("brings a structure into view from its name, shows and hides it from its box, and sets the layers' look", async () => {
    const controller = fakeController();
    const { s, navigations } = await store();
    const { column, destroy } = mount(controller, s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    const row = () => column.querySelector('[data-rs-structure="total/1"]') as HTMLElement;
    act(() => {
      fireEvent.click(row().querySelector('.prs-structure')!);
    });
    expect(navigations.map(n => n.key)).toEqual(['0/total/1']);
    expect(row().getAttribute('aria-selected')).toBe('true');
    const button = () => row().querySelector('.prs-structure') as HTMLButtonElement;
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().getAttribute('title')).toBe(
      'Liver is picked out on the images: click again or press Esc to stop'
    );
    // Its name again clears it, without a second jump, and the row under the pointer stops
    // showing it.
    act(() => {
      fireEvent.mouseEnter(row());
    });
    expect(s.getSnapshot().hovered).toBe('0/total/1');
    act(() => {
      fireEvent.click(button());
    });
    expect(s.getSnapshot().hovered).toBeNull();
    expect(row().getAttribute('aria-selected')).toBe('false');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(button().getAttribute('title')).toBe('Show Liver on the images');
    expect(navigations.map(n => n.key)).toEqual(['0/total/1']);
    act(() => {
      fireEvent.click(row().querySelector('input[type="checkbox"]')!);
    });
    expect(s.getSnapshot().structures['0/total/1'].visible).toBe(false);
    expect(row().getAttribute('data-hidden')).toBe('true');
    act(() => {
      fireEvent.mouseEnter(column.querySelector('[data-rs-structure="total/2"]')!);
    });
    expect(s.getSnapshot().hovered).toBe('0/total/2');
    act(() => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-style="outline"]')!);
      fireEvent.change(column.querySelector('[data-rs-anatomy-opacity]')!, {
        target: { value: '60' },
      });
    });
    expect(s.getSnapshot().settings).toEqual({ enabled: true, opacity: 0.6, style: 'outline' });
    act(() => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-enabled]')!);
    });
    expect(s.getSnapshot().settings.enabled).toBe(false);
    // The bar's Anatomy button turns them on again from any tab.
    act(() => {
      fireEvent.click(column.querySelector('[data-rs-tab="draft"]')!);
    });
    const toggle = column.querySelector('[data-rs-anatomy-toggle]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      fireEvent.click(toggle);
    });
    expect(s.getSnapshot().settings.enabled).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    destroy();
  });

  it("lets a picked-out structure go with Show all, in the layers' row", async () => {
    const { s } = await store();
    const { column, destroy } = mount(fakeController(), s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    const row = (k: string) => column.querySelector(`[data-rs-structure="${k}"]`) as HTMLElement;
    const showAll = () =>
      column.querySelector(
        '.prs-anatomy-controls [data-rs-anatomy-show-all]'
      ) as HTMLButtonElement | null;
    expect(showAll()).toBeNull();
    // Pointing at a row brings its structure out, but picks nothing out.
    act(() => {
      fireEvent.mouseEnter(row('total/1'));
    });
    expect(showAll()).toBeNull();
    act(() => {
      fireEvent.mouseLeave(row('total/1'));
    });
    // Its name clicked, the liver is picked out: Show all, whose title names it.
    act(() => {
      fireEvent.click(row('total/1').querySelector('.prs-structure')!);
    });
    expect(showAll()?.textContent).toBe('Show all');
    expect(showAll()?.title).toBe(
      'Stop picking out Liver: every structure in full again, on the images and in 3D'
    );
    // Show all lets it go; the button goes with it, the keys staying in the row.
    act(() => {
      showAll()!.focus();
      fireEvent.click(showAll()!);
    });
    expect(s.getSnapshot().selected).toBeNull();
    expect(row('total/1').getAttribute('aria-selected')).toBe('false');
    expect(showAll()).toBeNull();
    expect(document.activeElement?.hasAttribute('data-rs-anatomy-enabled')).toBe(true);
    // A selected structure switched off, or its task, is picked out no more: no button.
    act(() => {
      fireEvent.click(row('total/2').querySelector('.prs-structure')!);
    });
    expect(showAll()).not.toBeNull();
    const box = () => row('total/2').querySelector('input[type="checkbox"]')!;
    act(() => {
      fireEvent.click(box());
    });
    expect(s.getSnapshot().selected).toBe('0/total/2');
    expect(showAll()).toBeNull();
    act(() => {
      fireEvent.click(box());
    });
    expect(showAll()).not.toBeNull();
    act(() => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-task-toggle="total"]')!);
    });
    expect(showAll()).toBeNull();
    destroy();
  });

  it('has no Anatomy tab for a study without anatomy, and says why when its anatomy is refused', async () => {
    const none = await store(async () => Promise.reject(new RsHttpError(404, 'anatomy')));
    const a = mount(fakeController(), none.s);
    await act(async () => {
      none.s.enter(STUDY);
      await flush();
    });
    expect(tabs(a.column)).toEqual(['Draft', 'Inbox (0)', 'Changes (0)']);
    expect(a.column.querySelector('[data-rs-anatomy-toggle]')).toBeNull();
    a.destroy();

    const refused = await store(async () =>
      Promise.reject(new RsRefused('This viewer reads pacsai.reading/1.x.'))
    );
    const controller = fakeController();
    const b = mount(controller, refused.s);
    await act(async () => {
      refused.s.enter(STUDY);
      await flush();
    });
    expect(tabs(b.column)).toEqual(['Anatomy', 'Draft', 'Inbox (0)', 'Changes (0)']);
    expect(controller.offerTab).not.toHaveBeenCalled();
    act(() => {
      fireEvent.click(b.column.querySelector('[data-rs-tab="anatomy"]')!);
    });
    expect(b.column.querySelector('[data-rs-anatomy-error]')?.textContent).toBe(
      'This viewer reads pacsai.reading/1.x.'
    );
    b.destroy();
  });

  it("shows contract 1.13's numbers: a bounded volume as at least, an out-of-band one in amber, and the record's findings under the row", async () => {
    const { s } = await store(undefined, raw => {
      const total = raw.series[0].labelmaps[1] as { labels: Array<Record<string, unknown>> };
      Object.assign(total.labels[0], {
        volumeMl: 1464.23,
        volumeLowerBound: true,
        slices: 29,
        touchesVolumeEdge: ['first_slice'],
        components: 2,
        checks: {
          degraded: false,
          degradedBy: [],
          volumeInBand: false,
          relations: [
            {
              kind: 'laterality_from_midline',
              status: 'inconsistent',
              reason: 'it lies left of the midline',
            },
          ],
        },
      });
    });
    const { column, destroy } = mount(fakeController(), s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    const liver = column.querySelector('[data-rs-structure="total/1"]') as HTMLElement;
    const volume = liver.querySelector('[data-rs-volume]') as HTMLElement;
    expect(volume.firstChild?.textContent).toBe('≥ 1,464 mL');
    expect(volume.querySelector('[data-rs-volume-edge]')?.textContent).toBe(
      'touches the scan edge'
    );
    expect(volume.getAttribute('data-out-of-band')).toBe('true');
    expect(volume.getAttribute('title')).toBe(
      'From the reading system; at least: the structure touches the scan’s edge, so its volume is a minimum; outside the expected range for this organ.'
    );
    const extent = liver.querySelector('[data-rs-extent]') as HTMLElement;
    expect(extent.textContent).toBe('≥ 29 sl');
    expect(extent.getAttribute('title')).toBe(
      '29 slices, about 87 mm; it runs past the scan’s first or last slice; in 2 parts.'
    );
    expect(liver.querySelector('.prs-flag')?.getAttribute('title')).toBe(
      'Laterality from midline: it lies left of the midline.'
    );
    expect(column.querySelector('[data-rs-structure-warnings="total/1"]')?.textContent).toBe(
      'Laterality from midline: it lies left of the midline.'
    );
    // The spleen's volume comes from its voxels (no 1.13 number), within its band (no check).
    const spleen = column.querySelector(
      '[data-rs-structure="total/2"] [data-rs-volume]'
    ) as HTMLElement;
    expect(spleen.getAttribute('title')).toBe('From 9 voxels.');
    expect(spleen.hasAttribute('data-out-of-band')).toBe(false);
    expect(spleen.querySelector('[data-rs-volume-edge]')).toBeNull();
    destroy();
  });

  it("shows 1.14's attenuation in a column named for its statistic, only once the document has any", async () => {
    const { s } = await store(undefined, raw => {
      const total = raw.series[0].labelmaps[1] as { labels: Array<Record<string, unknown>> };
      total.labels[0].attenuation = {
        statistic: 'whole-mask median',
        medianHU: 57.4,
        iqrHU: 12.6,
        supported: true,
        reasons: [],
      };
      total.labels[1].attenuation = {
        statistic: 'whole-mask median',
        medianHU: null,
        iqrHU: null,
        supported: false,
        reasons: ['too few voxels'],
      };
    });
    const { column, destroy } = mount(fakeController(), s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    const organs = column.querySelector('[data-rs-anatomy-task="total"]') as HTMLElement;
    const headers = Array.from(organs.querySelectorAll('th')).map(th => th.textContent);
    expect(headers).toEqual(['', 'Extent', 'Volume', 'Median (IQR)HU, whole mask']);
    expect(organs.querySelectorAll('th')[3].getAttribute('title')).toMatch(
      /Not the report’s ROI median/
    );
    const cell = (key: string) =>
      column.querySelector(`[data-rs-structure="${key}"] [data-rs-attenuation]`) as HTMLElement;
    expect(cell('total/1').textContent).toBe('57 (13)');
    expect(cell('total/1').getAttribute('title')).toBe(
      'Whole-mask median 57.4 HU, interquartile range 12.6 HU: every voxel of the mask, partial volume and vessels included. Not the report’s ROI median.'
    );
    expect(cell('total/2').textContent).toBe('—');
    expect(cell('total/2').getAttribute('title')).toBe('Not measured: too few voxels.');
    // Not measurement eligible: no attenuation; one cell across both columns says why.
    expect(cell('vertebrae_pp/1')).toBeNull();
    const only = column.querySelector(
      '[data-rs-structure="vertebrae_pp/1"] [data-rs-localization-only]'
    ) as HTMLTableCellElement;
    expect([only.textContent, only.colSpan]).toEqual(['localization only', 2]);
    destroy();
  });

  it("shows 1.15's research features behind a Radiomics chip when computed: families that fold, a search, units, research use only", async () => {
    const { s } = await store(undefined, raw => {
      const total = raw.series[0].labelmaps[1] as { labels: Array<Record<string, unknown>> };
      total.labels[0].radiomics = {
        use: 'research',
        featureSet: 'radiomics_v1',
        engine: 'pyradiomics 3.0.1',
        state: 'computed',
        reason: '',
        features: {
          firstorder_Median: 41.537,
          firstorder_Mean: null,
          firstorder_InterquartileRange: 12.25,
          firstorder_10Percentile: 20,
          firstorder_90Percentile: 60,
          firstorder_Kurtosis: 3.1,
          firstorder_Energy: 5.1e9,
          shape_LeastAxisLength: 31.4,
          shape_Sphericity: 0.71,
          glcm_Contrast: 123456.7,
          glcm_Idmn: 0.98,
        },
      };
      total.labels[1].radiomics = {
        use: 'research',
        featureSet: 'radiomics_v1',
        engine: null,
        state: 'not_computed',
        reason: 'no radiomics engine is installed in this build',
        features: {},
      };
    });
    const { column, destroy } = mount(fakeController(), s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    const chip = (key: string) =>
      column.querySelector(`[data-rs-radiomics-chip="${key}"]`) as HTMLButtonElement | null;
    // Only computed features get a chip, which counts the finite values; nothing is open yet.
    expect(chip('total/1')?.textContent).toBe('Radiomics · 10');
    expect(chip('total/2')).toBeNull();
    expect(chip('vertebrae_pp/1')).toBeNull();
    expect(column.querySelector('[data-rs-radiomics]')).toBeNull();
    act(() => {
      fireEvent.click(chip('total/1')!);
    });
    expect(chip('total/1')!.getAttribute('aria-expanded')).toBe('true');
    const section = column.querySelector('[data-rs-radiomics="total/1"]') as HTMLElement;
    expect(section.querySelector('.prs-radiomics-head')?.textContent).toBe(
      'Radiomics (radiomics_v1 · pyradiomics 3.0.1). Research use only, not part of the report.'
    );
    const families = () =>
      Array.from(section.querySelectorAll('[data-rs-radiomics-family]')).map(f => [
        f.getAttribute('data-rs-radiomics-family'),
        f.querySelector('button')?.getAttribute('aria-expanded'),
        f.querySelector('button')?.textContent,
      ]);
    expect(families()).toEqual([
      ['firstorder', 'true', '▾ First order 7'],
      ['shape', 'true', '▾ Shape 2'],
      ['glcm', 'false', '▸ GLCM (co-occurrence) 2'],
    ]);
    const pairs = (cls: string) =>
      Array.from(
        section.querySelectorAll(
          `[data-rs-radiomics-family="${cls}"] dt, [data-rs-radiomics-family="${cls}"] dd`
        )
      ).map(e => e.textContent);
    const valueOf = (key: string) =>
      section.querySelector(`[data-rs-radiomics-feature="${key}"]`)!
        .nextElementSibling as HTMLElement;
    // First order opens on its key features, in their order; Mean has no finite value.
    expect(pairs('firstorder')).toEqual([
      'Median',
      '41.5 HU',
      'Mean',
      '—',
      'Interquartile range',
      '12.3 HU',
      '10th percentile',
      '20 HU',
      '90th percentile',
      '60 HU',
    ]);
    expect(
      section
        .querySelector('[data-rs-radiomics-feature="firstorder_Median"]')
        ?.getAttribute('title')
    ).toBe('firstorder_Median');
    expect(valueOf('firstorder_Median').getAttribute('title')).toBe('41.537 HU');
    expect(valueOf('firstorder_Mean').getAttribute('title')).toBe('No finite value.');
    act(() => {
      fireEvent.click(section.querySelector('[data-rs-radiomics-more]')!);
    });
    expect(pairs('firstorder')).toHaveLength(14);
    expect(section.querySelector('[data-rs-radiomics-more]')).toBeNull();
    expect(valueOf('firstorder_Energy').getAttribute('title')).toBe(
      '5100000000 HU², of HU + 1000 (the registry’s voxelArrayShift)'
    );
    expect(pairs('shape')).toEqual(['Least axis length', '31.4 mm', 'Sphericity', '0.71']);
    // GLCM starts folded.
    expect(pairs('glcm')).toEqual([]);
    act(() => {
      fireEvent.click(section.querySelector('[data-rs-radiomics-family="glcm"] button')!);
    });
    expect(pairs('glcm')).toEqual([
      'Contrast',
      '1.23 × 10⁵',
      'Inverse difference moment normalized',
      '0.98',
    ]);
    // A search: only the families with a match, open, with their counts.
    const search = section.querySelector('[data-rs-radiomics-search]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'axis' } });
    });
    expect(families()).toEqual([['shape', 'true', '▾ Shape 1 of 2']]);
    act(() => {
      fireEvent.change(search, { target: { value: 'zzz' } });
    });
    expect(section.querySelector('[data-rs-radiomics-none]')?.textContent).toBe(
      'No feature matches “zzz”.'
    );
    // Esc empties the search, and goes no further (the spotlight keeps its structure).
    s.select(
      Object.values(s.getSnapshot().structures).find(x => x.task === 'total' && x.value === 1)!.key
    );
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    act(() => {
      search.dispatchEvent(esc);
    });
    expect(search.value).toBe('');
    expect(s.getSnapshot().selected).not.toBeNull();
    // The research features are no column of the table; the chip again folds them.
    expect(Array.from(column.querySelectorAll('th')).map(th => th.textContent)).not.toContain(
      'Radiomics'
    );
    act(() => {
      fireEvent.click(chip('total/1')!);
    });
    expect(column.querySelector('[data-rs-radiomics]')).toBeNull();
    destroy();
  });

  it('unfolds the task of a structure picked on the images and brings its row into view', async () => {
    const scrolled: string[] = [];
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown };
    const before = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('data-rs-structure') ?? '');
    };
    try {
      const { s, navigations } = await store();
      const { column, destroy } = mount(fakeController(), s);
      await act(async () => {
        s.enter(STUDY);
        await flush();
      });
      const cavities = column.querySelector(
        '[data-rs-anatomy-task="trunk_cavities"]'
      ) as HTMLElement;
      expect(cavities.querySelectorAll('tr')).toHaveLength(0);
      const key = Object.values(s.getSnapshot().structures).find(
        x => x.task === 'trunk_cavities'
      )!.key;
      act(() => s.pick(key));
      expect(
        cavities
          .querySelector('tr[data-rs-structure="trunk_cavities/1"]')
          ?.getAttribute('aria-selected')
      ).toBe('true');
      expect(scrolled).toContain('trunk_cavities/1');
      expect(navigations).toEqual([]);
      destroy();
    } finally {
      proto.scrollIntoView = before;
    }
  });

  it('formats a volume for the table: whole mL from 1,000, one decimal from 1, two below', () => {
    expect(formatVolume(1523.4)).toBe('1,523 mL');
    expect(formatVolume(999.96)).toBe('1,000 mL');
    expect(formatVolume(108.66)).toBe('108.7 mL');
    expect(formatVolume(62.44)).toBe('62.4 mL');
    expect(formatVolume(0.324)).toBe('0.32 mL');
    expect(formatVolume(0)).toBe('—');
  });
});

describe("the pane's Radiomics tab (RS-36)", () => {
  const computed = (features: Record<string, number | null>) => ({
    use: 'research',
    featureSet: 'radiomics_v1',
    engine: 'pyradiomics 3.0.1',
    state: 'computed',
    reason: '',
    features,
  });

  it('comes after Anatomy while a structure has computed features: side by side, sortable, searchable, research use only', async () => {
    const { s } = await store(undefined, raw => {
      const total = raw.series[0].labelmaps[1] as { labels: Array<Record<string, unknown>> };
      // The liver (value 1) and the spleen (value 2).
      total.labels[0].radiomics = computed({
        firstorder_Median: 41.5,
        firstorder_Mean: 40,
        shape_Sphericity: 0.7,
      });
      total.labels[1].radiomics = computed({
        firstorder_Median: 52.25,
        firstorder_Mean: null,
        shape_Sphericity: 0.9,
      });
    });
    const controller = fakeController();
    const { column, destroy } = mount(controller, s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    expect(tabs(column)).toEqual([
      'Anatomy (4)',
      'Radiomics (2)',
      'Draft',
      'Inbox (0)',
      'Changes (0)',
    ]);
    act(() => {
      fireEvent.click(column.querySelector('[data-rs-tab="radiomics"]')!);
    });
    const tab = column.querySelector('[data-rs-radiomics-tab]') as HTMLElement;
    expect(tab.querySelector('[data-rs-radiomics-banner]')?.textContent).toBe(
      'Research use only, not part of the report.'
    );
    const head = () => Array.from(tab.querySelectorAll('thead th')).map(th => th.textContent);
    const body = () =>
      Array.from(tab.querySelectorAll('tbody tr')).map(tr =>
        Array.from(tr.children).map(c => c.textContent)
      );
    // The structures head to feet, as the Anatomy tab lists them.
    expect(head()).toEqual(['Feature', 'Spleen', 'Liver']);
    expect(body()).toEqual([
      ['First order 2'],
      ['Median HU', '52.3', '41.5'],
      ['Mean HU', '—', '40'],
      ['Shape 1'],
      ['Sphericity', '0.9', '0.7'],
    ]);
    expect(
      tab.querySelector('[data-rs-radiomics-row="firstorder_Median"] td')?.getAttribute('title')
    ).toBe('52.25 HU');
    // Sorted by the liver's values: ascending, descending, then the registry's order again.
    const liver = tab.querySelector('[data-rs-radiomics-sort="0/total/1"]') as HTMLButtonElement;
    const firsts = () => body().map(r => r[0]);
    act(() => {
      fireEvent.click(liver);
    });
    expect(firsts()).toEqual(['First order 2', 'Mean HU', 'Median HU', 'Shape 1', 'Sphericity']);
    expect(liver.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    act(() => {
      fireEvent.click(liver);
    });
    expect(firsts()).toEqual(['First order 2', 'Median HU', 'Mean HU', 'Shape 1', 'Sphericity']);
    act(() => {
      fireEvent.click(liver);
    });
    expect(liver.closest('th')?.getAttribute('aria-sort')).toBe('none');
    // By the feature's name.
    act(() => {
      fireEvent.click(tab.querySelector('[data-rs-radiomics-sort="name"]')!);
    });
    expect(firsts()).toEqual(['First order 2', 'Mean HU', 'Median HU', 'Shape 1', 'Sphericity']);
    // A search keeps the families with a match.
    act(() => {
      fireEvent.change(tab.querySelector('[data-rs-radiomics-search]')!, {
        target: { value: 'spher' },
      });
    });
    expect(body()).toEqual([['Shape 1 of 1'], ['Sphericity', '0.9', '0.7']]);
    destroy();
  });

  it("exports the study's features as CSV, unrounded, named by the study ref and never the UID", async () => {
    const { s } = await store(undefined, raw => {
      const total = raw.series[0].labelmaps[1] as { labels: Array<Record<string, unknown>> };
      total.labels[0].radiomics = computed({ firstorder_Median: 41.5, firstorder_Mean: 40 });
      total.labels[1].radiomics = {
        use: 'research',
        featureSet: 'radiomics_v1',
        engine: null,
        state: 'not_computed',
        reason: 'no radiomics engine is installed in this build',
        features: {},
      };
    });
    const blobs: Blob[] = [];
    const names: string[] = [];
    const url = window.URL as unknown as {
      createObjectURL?: (b: Blob) => string;
      revokeObjectURL?: (u: string) => void;
    };
    const saved = { create: url.createObjectURL, revoke: url.revokeObjectURL };
    url.createObjectURL = (b: Blob) => {
      blobs.push(b);
      return 'blob:radiomics';
    };
    url.revokeObjectURL = () => {};
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      names.push(this.download);
    });
    try {
      const { column, destroy } = mount(fakeController(), s);
      await act(async () => {
        s.enter(STUDY);
        await flush();
      });
      expect(tabs(column)).toContain('Radiomics (1)');
      act(() => {
        fireEvent.click(column.querySelector('[data-rs-tab="radiomics"]')!);
      });
      const tab = column.querySelector('[data-rs-radiomics-tab]') as HTMLElement;
      // The structure not computed is said under the table, with its reason.
      expect(tab.querySelector('[data-rs-radiomics-missing]')?.textContent).toBe(
        'Spleen: not computed (no radiomics engine is installed in this build).'
      );
      await act(async () => {
        fireEvent.click(tab.querySelector('[data-rs-radiomics-export]')!);
        await flush();
      });
      const subtle = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
      const ref = subtle
        ? `study-${createHash('sha256').update(STUDY).digest('hex').slice(0, 12)}`
        : 'ref';
      expect(names).toEqual([`${ref}-radiomics_v1.csv`]);
      const text = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blobs[0]);
      });
      expect(text.split('\r\n')).toEqual([
        '# Research use only: not part of the report. radiomics_v1 by pyradiomics 3.0.1',
        'family,feature,name,unit,Liver',
        'firstorder,firstorder_Median,Median,HU,41.5',
        'firstorder,firstorder_Mean,Mean,HU,40',
        '',
      ]);
      expect(`${names[0]}\n${text}`).not.toContain(STUDY);
      destroy();
    } finally {
      click.mockRestore();
      url.createObjectURL = saved.create;
      url.revokeObjectURL = saved.revoke;
    }
  });
});
