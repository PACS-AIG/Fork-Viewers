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
import { formatVolume } from './AnatomyTab';
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
            { kind: 'laterality', status: 'inconsistent', reason: 'It lies left of the midline.' },
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
      'It lies left of the midline.'
    );
    expect(column.querySelector('[data-rs-structure-warnings="total/1"]')?.textContent).toBe(
      'It lies left of the midline.'
    );
    // The spleen's volume comes from its voxels (no 1.13 number), within its band (no check).
    const spleen = column.querySelector(
      '[data-rs-structure="total/2"] [data-rs-volume]'
    ) as HTMLElement;
    expect(spleen.getAttribute('title')).toBe('From 9 voxels.');
    expect(spleen.hasAttribute('data-out-of-band')).toBe(false);
    destroy();
  });

  it('formats a volume for the table', () => {
    expect(formatVolume(1523.4)).toBe('1,523 mL');
    expect(formatVolume(62.44)).toBe('62.4 mL');
    expect(formatVolume(0.324)).toBe('0.32 mL');
    expect(formatVolume(0)).toBe('—');
  });
});
