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
import { formatFeature, formatVolume, resampledNote } from './AnatomyTab';
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
    // §2.3: a structure that is not measurement eligible shows no volume.
    expect(rows(groups[1])).toEqual([['vertebrae_pp/1', 'L1 vertebra', '≥ 2 sl', '']]);
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
    expect(volume.textContent).toBe('≥ 1,464 mL');
    expect(volume.getAttribute('data-out-of-band')).toBe('true');
    expect(volume.getAttribute('title')).toBe(
      'From the reading system; at least: the structure reaches the scan’s edge; outside the expected range for this organ.'
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
    // Not measurement eligible: no attenuation, an empty cell.
    expect(cell('vertebrae_pp/1').textContent).toBe('');
    destroy();
  });

  it("shows 1.15's research features in a section of their own, marked research use only, or why they were not computed", async () => {
    const { s } = await store(undefined, raw => {
      const total = raw.series[0].labelmaps[1] as { labels: Array<Record<string, unknown>> };
      total.labels[0].radiomics = {
        use: 'research',
        featureSet: 'radiomics_v1',
        engine: 'pyradiomics 3.0.1',
        state: 'computed',
        reason: '',
        features: { firstorder_Median: 41.537, firstorder_Mean: null, glcm_Contrast: 123456.7 },
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
    const toggle = (key: string) =>
      column.querySelector(`[data-rs-research-toggle="${key}"]`) as HTMLButtonElement | null;
    // Only the structures with research features have the button; nothing is open yet.
    expect(toggle('total/1')).not.toBeNull();
    expect(toggle('total/2')).not.toBeNull();
    expect(toggle('vertebrae_pp/1')).toBeNull();
    expect(column.querySelector('[data-rs-research]')).toBeNull();
    act(() => {
      fireEvent.click(toggle('total/1')!);
    });
    const section = column.querySelector('[data-rs-research="total/1"]') as HTMLElement;
    expect(toggle('total/1')!.getAttribute('aria-expanded')).toBe('true');
    expect(section.querySelector('.prs-research-head')?.textContent).toBe(
      'Research features (radiomics_v1) · pyradiomics 3.0.1'
    );
    expect(section.querySelector('.prs-research-banner')?.textContent).toBe(
      'Research use only: not validated for diagnosis. Never a finding, a measurement or report content.'
    );
    const classes = Array.from(section.querySelectorAll('details'));
    expect(
      classes.map(d => [
        d.getAttribute('data-rs-research-class'),
        d.open,
        d.querySelector('summary')?.textContent,
      ])
    ).toEqual([
      ['firstorder', true, 'First order (2)'],
      ['glcm', false, 'GLCM (co-occurrence) (1)'],
    ]);
    expect(Array.from(classes[0].querySelectorAll('dt, dd')).map(e => e.textContent)).toEqual([
      'Median',
      '41.54',
      'Mean',
      '—',
    ]);
    expect(classes[1].querySelector('dd')?.textContent).toBe('1.23e+5');
    // The research features are no column of the table.
    expect(Array.from(column.querySelectorAll('th')).map(th => th.textContent)).not.toContain(
      'Research'
    );
    // Another structure's: one open at a time; why they were not computed.
    act(() => {
      fireEvent.click(toggle('total/2')!);
    });
    expect(column.querySelector('[data-rs-research="total/1"]')).toBeNull();
    expect(
      column.querySelector('[data-rs-research="total/2"] [data-rs-research-reason]')?.textContent
    ).toBe('Not computed: no radiomics engine is installed in this build.');
    expect(
      column.querySelector('[data-rs-research="total/2"] .prs-research-head')?.textContent
    ).toBe('Research features (radiomics_v1)');
    act(() => {
      fireEvent.click(toggle('total/2')!);
    });
    expect(column.querySelector('[data-rs-research]')).toBeNull();
    destroy();
  });

  it('formats a research feature: four significant digits, an exponent beyond them, a dash for none', () => {
    expect(formatFeature(41.537)).toBe('41.54');
    expect(formatFeature(0.123456)).toBe('0.1235');
    expect(formatFeature(12345.6)).toBe('12350');
    expect(formatFeature(123456.7)).toBe('1.23e+5');
    expect(formatFeature(0.0001234)).toBe('1.23e-4');
    expect(formatFeature(0)).toBe('0');
    expect(formatFeature(-2.5)).toBe('-2.5');
    expect(formatFeature(null)).toBe('—');
  });

  it('formats a volume for the table', () => {
    expect(formatVolume(1523.4)).toBe('1,523 mL');
    expect(formatVolume(62.44)).toBe('62.4 mL');
    expect(formatVolume(0.324)).toBe('0.32 mL');
    expect(formatVolume(0)).toBe('—');
  });
});
