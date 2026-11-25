import { act, fireEvent } from '@testing-library/react';
import type { RsEvidenceView } from '../rsContract';
import type { RsController, RsSnapshot } from '../rsController';
import { RsHttpError } from '../rsClient';
import { createRsHost } from '../rsHost';
import { makeEvidence, makeInbox, makeReport, makeVersions } from '../testDocs';
import { paragraphs, studyStrips } from './PathGradeTab';
import { readShowcase } from './showcaseContract';
import { createShowcaseStore, type ShowcaseClient } from './showcaseStore';
import { NOTICE, PICTURES, makeShowcase, sha } from './showcaseTestData';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};

function fakeController(evidence: RsEvidenceView | null = makeEvidence()) {
  let state: RsSnapshot = {
    phase: 'ready',
    reason: null,
    docs: { report: makeReport(), versions: makeVersions(), inbox: makeInbox(), evidence },
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

function showcaseStore(over: Partial<ShowcaseClient> = {}) {
  let n = 0;
  const client = {
    showcase: jest.fn(async () => readShowcase(makeShowcase(), 'fixture')),
    showcaseImage: jest.fn(async (name: string) => PICTURES[name]),
    ...over,
  };
  const store = createShowcaseStore({
    client,
    digest: async b => sha(b),
    pictureUrl: { create: () => `blob:picture-${++n}`, revoke: () => {} },
  });
  return { store, client };
}

function mount(controller: RsController, pathgrade: ReturnType<typeof createShowcaseStore> | null) {
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
    host = createRsHost({ win: window, column, controller, pathgrade, setInset: () => {} });
  });
  return { column, destroy: () => act(() => host?.destroy()) };
}

const tabs = (column: HTMLElement) =>
  [...column.querySelectorAll('[role="tab"]')].map(t => t.textContent);
const text = (column: HTMLElement, sel: string) =>
  [...column.querySelectorAll(sel)].map(e => (e.textContent ?? '').trim());

async function openTab(column: HTMLElement) {
  await act(async () => {
    fireEvent.click(column.querySelector('[data-rs-tab="pathgrade"]')!);
    await flush();
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe("the pane's PathGrade tab (RS-36, contract 1.16)", () => {
  it('is offered last, research only, and reads nothing until it is opened', async () => {
    const { store, client } = showcaseStore();
    const { column, destroy } = mount(fakeController(), store);
    expect(tabs(column)).toEqual(['Draft', 'Inbox (0)', 'Changes (0)', 'PathGrade (research)']);
    expect(client.showcase).not.toHaveBeenCalled();
    await openTab(column);
    expect(client.showcase).toHaveBeenCalledTimes(1);
    expect(
      column.querySelector('[data-rs-panel="pathgrade"] [data-rs-pathgrade="ready"]')
    ).not.toBeNull();
    // The notice first, then the cohort's credit.
    expect(text(column, '[data-rs-pathgrade-notice]')).toEqual([NOTICE]);
    expect(text(column, '[data-rs-pathgrade-credit]')).toEqual([
      'Images: The Cancer Imaging Archive (TCIA), C4KC-KiTS, DOI 10.7937/TCIA.2019.IX49E8NX, CC BY 3.0',
    ]);
    expect(text(column, '.prs-pg-title')).toEqual(['PathGrade on public kidney tumours']);
    // This study: its one finding has no strip.
    expect(text(column, '[data-rs-pathgrade-study] p')).toEqual([
      'No finding in this study has a reference-case strip.',
    ]);
    // The sections in order, as the API words them.
    expect(text(column, '[data-rs-pathgrade-section] h4')).toEqual([
      'The machine’s outline and size beside the expert’s',
      'Where PathGrade stands',
    ]);
    expect(text(column, '[data-rs-pathgrade-item="text"] p')).toEqual([
      'Yellow is the expert’s outline.',
      'Red is the machine’s.',
    ]);
    expect(text(column, '[data-rs-pathgrade-item="facts"] dt')).toEqual([
      'Tumours',
      'Dice, median',
    ]);
    expect(text(column, '[data-rs-pathgrade-item="facts"] dd')).toEqual(['75', '0.90']);
    expect(text(column, '.prs-pg-table caption')).toEqual(['From public cases to a usable mask']);
    expect(text(column, '.prs-pg-table th')).toEqual(['Dataset', 'Cases', 'Usable']);
    expect(text(column, '.prs-pg-table td')).toEqual([
      'C4KC-KiTS',
      '300',
      '75',
      'CPTAC-CCRCC',
      '222',
      '26',
    ]);
    const images = [
      ...column.querySelectorAll('img[data-rs-pathgrade-image]'),
    ] as HTMLImageElement[];
    expect(
      images.map(i => [i.getAttribute('data-rs-pathgrade-image'), i.alt, i.getAttribute('src')])
    ).toEqual([
      ['outline_KiTS-00001.png', 'Axial slice of outline_KiTS-00001', 'blob:picture-1'],
      ['outline_KiTS-00002.png', 'Axial slice of outline_KiTS-00002', 'blob:picture-2'],
      ['growth_KiTS-00003.png', 'Axial slice of growth_KiTS-00003', 'blob:picture-3'],
    ]);
    expect(text(column, '.prs-pg-panel figcaption')).toEqual([
      'KiTS-00001: clear cell',
      'KiTS-00002: papillary',
    ]);
    expect(text(column, '.prs-pg-figcaption')).toEqual([
      'Axial slices through each tumour’s widest part.',
    ]);
    expect(text(column, '[data-rs-pathgrade-sources] li')).toEqual([
      'code: pathgrade.showcase',
      `model: subtype model (sha256 ${'b'.repeat(12)}…)`,
    ]);
    // Away and back: nothing is read again.
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-tab="draft"]')!);
    });
    await openTab(column);
    expect(client.showcase).toHaveBeenCalledTimes(1);
    destroy();
  });

  it("lists this study's findings that have a reference-case strip, as the strip words it", async () => {
    const evidence = makeEvidence();
    evidence.findings[0] = {
      ...evidence.findings[0],
      kind: 'lesion',
      className: 'renal mass',
      referenceCaseStrip: {
        state: 'empty',
        reason: 'no_qualified_characterizer',
        display: 'No reference cases: no qualified characterizer.',
      },
    };
    expect(studyStrips(evidence)).toEqual([
      {
        finding: 'Lesion · renal mass',
        display: 'No reference cases: no qualified characterizer.',
      },
    ]);
    expect(studyStrips(makeEvidence())).toEqual([]);
    expect(studyStrips(null)).toEqual([]);
    const { store } = showcaseStore();
    const { column, destroy } = mount(fakeController(evidence), store);
    await openTab(column);
    expect(text(column, '[data-rs-pathgrade-strip]')).toEqual([
      'Lesion · renal massNo reference cases: no qualified characterizer.',
    ]);
    destroy();
    const unread = mount(fakeController(null), showcaseStore().store);
    await openTab(unread.column);
    expect(text(unread.column, '[data-rs-pathgrade-study] p')).toEqual([
      'This study’s evidence view could not be read.',
    ]);
    unread.destroy();
  });

  it('shows a picture larger under its row, until Escape or Close', async () => {
    const { store } = showcaseStore();
    const { column, destroy } = mount(fakeController(), store);
    await openTab(column);
    const pictures = column.querySelectorAll('.prs-pg-picture');
    await act(async () => {
      fireEvent.click(pictures[1]);
    });
    const larger = column.querySelector('[data-rs-pathgrade-larger]') as HTMLElement;
    expect(larger.getAttribute('data-rs-pathgrade-larger')).toBe('outline_KiTS-00002.png');
    expect(larger.closest('[data-rs-pathgrade-item="figure"]')).not.toBeNull();
    expect(text(column, '.prs-pg-larger-caption')).toEqual(['KiTS-00002: papillary']);
    expect(document.activeElement?.textContent).toBe('Close');
    await act(async () => {
      fireEvent.keyDown(larger, { key: 'Escape' });
    });
    expect(column.querySelector('[data-rs-pathgrade-larger]')).toBeNull();
    await act(async () => {
      fireEvent.click(column.querySelectorAll('.prs-pg-picture')[2]);
    });
    expect(
      column.querySelector('[data-rs-pathgrade-larger]')?.getAttribute('data-rs-pathgrade-larger')
    ).toBe('growth_KiTS-00003.png');
    await act(async () => {
      fireEvent.click(column.querySelector('.prs-pg-larger .prs-btn')!);
    });
    expect(column.querySelector('[data-rs-pathgrade-larger]')).toBeNull();
    destroy();
  });

  it('shows why a picture is not shown, in its place', async () => {
    const { store } = showcaseStore({
      showcaseImage: jest.fn(async (name: string) =>
        name === 'growth_KiTS-00003.png' ? new Uint8Array([0]) : PICTURES[name]
      ),
    });
    const { column, destroy } = mount(fakeController(), store);
    await openTab(column);
    const refused = column.querySelector('[data-rs-pathgrade-picture="refused"]') as HTMLElement;
    expect(refused.textContent).toBe(
      'Its bytes are not the ones the showcase lists, so it is not shown.'
    );
    expect(refused.getAttribute('aria-label')).toBe('Axial slice of growth_KiTS-00003');
    expect(column.querySelectorAll('img[data-rs-pathgrade-image]')).toHaveLength(2);
    destroy();
  });

  it('says plainly when none is served, and offers Try again after a failed read', async () => {
    const none = showcaseStore({
      showcase: jest.fn(async () => {
        throw new RsHttpError(
          404,
          'PathGrade showcase',
          'no PathGrade showcase is served: none is configured'
        );
      }),
    });
    const a = mount(fakeController(), none.store);
    await openTab(a.column);
    expect(text(a.column, '[data-rs-pathgrade-reason]')).toEqual([
      'No PathGrade showcase is served: none is configured.',
    ]);
    expect(a.column.querySelector('[data-rs-pathgrade-retry]')).toBeNull();
    a.destroy();

    let fail = true;
    const flaky = showcaseStore({
      showcase: jest.fn(async () => {
        if (fail) {
          throw new RsHttpError(503, 'PathGrade showcase');
        }
        return readShowcase(makeShowcase(), 'fixture');
      }),
    });
    const b = mount(fakeController(), flaky.store);
    await openTab(b.column);
    expect(text(b.column, '[data-rs-pathgrade-reason]')).toEqual([
      'The PathGrade showcase could not be read (HTTP 503).',
    ]);
    fail = false;
    await act(async () => {
      fireEvent.click(b.column.querySelector('[data-rs-pathgrade-retry]')!);
      await flush();
    });
    expect(b.column.querySelector('[data-rs-pathgrade="ready"]')).not.toBeNull();
    b.destroy();
  });

  it('has no PathGrade tab without its store, and splits text into paragraphs', () => {
    const { column, destroy } = mount(fakeController(), null);
    expect(tabs(column)).toEqual(['Draft', 'Inbox (0)', 'Changes (0)']);
    destroy();
    expect(paragraphs('One.\n\n Two,\nstill two. \n \nThree.')).toEqual([
      'One.',
      'Two,\nstill two.',
      'Three.',
    ]);
  });
});
