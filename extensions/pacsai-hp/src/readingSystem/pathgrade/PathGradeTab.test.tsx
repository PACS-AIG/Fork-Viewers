import { act, fireEvent } from '@testing-library/react';
import type { RsEvidenceView, RsFindingEvidence } from '../rsContract';
import type { RsController, RsSnapshot } from '../rsController';
import { createRsHost } from '../rsHost';
import { makeEvidence, makeInbox, makeReport, makeVersions } from '../testDocs';
import { heldStrips } from './PathGradeTab';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The test evidence view, its one finding with this strip (and these fields). */
function evidenceWith(
  strip: RsFindingEvidence['referenceCaseStrip'],
  over: Partial<RsFindingEvidence> = {}
): RsEvidenceView {
  const ev = makeEvidence();
  ev.findings = [{ ...ev.findings[0], referenceCaseStrip: strip, ...over }];
  return ev;
}

const HELD = {
  state: 'held',
  reason: 'qualified_characterizer',
  display: 'Reference cases: 4 public cases of this class',
};
const EMPTY = {
  state: 'empty',
  reason: 'no_licensed_cohort',
  display: 'empty: no licensed cohort',
};

function fakeController(evidence: RsEvidenceView | null) {
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
    // The test's own: a new evidence view (as the controller's polling brings one).
    setEvidence: (ev: RsEvidenceView | null) => set({ docs: { ...state.docs!, evidence: ev } }),
  };
  return c as unknown as RsController & typeof c;
}

function mount(controller: RsController) {
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
    host = createRsHost({ win: window, column, controller, setInset: () => {} });
  });
  return { column, destroy: () => act(() => host?.destroy()) };
}

const tabs = (column: HTMLElement) =>
  [...column.querySelectorAll('[role="tab"]')].map(t => t.textContent);

afterEach(() => {
  document.body.innerHTML = '';
});

describe("the pane's PathGrade tab: this study's PathGrade results only (RS-36, D-344)", () => {
  it('takes only held strips as PathGrade results, never an empty one or none', () => {
    expect(heldStrips(evidenceWith(HELD, { kind: 'lesion', className: 'renal mass' }))).toEqual([
      { finding: 'Lesion · renal mass', display: 'Reference cases: 4 public cases of this class' },
    ]);
    expect(heldStrips(evidenceWith(HELD, { kind: 'lesion', className: null }))).toEqual([
      { finding: 'Lesion', display: 'Reference cases: 4 public cases of this class' },
    ]);
    expect(heldStrips(evidenceWith(EMPTY))).toEqual([]);
    expect(heldStrips(evidenceWith(null))).toEqual([]);
    expect(heldStrips(evidenceWith(undefined))).toEqual([]);
    expect(heldStrips(null)).toEqual([]);
  });

  it.each([
    ['an empty strip', evidenceWith(EMPTY)],
    ['no strip', evidenceWith(null)],
    ['no evidence view', null],
  ])('is hidden for a study with %s', (_why, evidence) => {
    const { column, destroy } = mount(fakeController(evidence));
    expect(tabs(column)).toEqual(['Draft', 'Inbox (0)', 'Changes (0)']);
    expect(column.querySelector('[data-rs-tab="pathgrade"]')).toBeNull();
    destroy();
  });

  it('is there for a study with a held strip, and lists those findings as the strip words them', async () => {
    const ev = makeEvidence();
    ev.findings = [
      {
        ...ev.findings[0],
        entryId: 'F1',
        kind: 'lesion',
        className: 'renal mass',
        referenceCaseStrip: HELD,
      },
      { ...ev.findings[0], entryId: 'F2', referenceCaseStrip: EMPTY },
      { ...ev.findings[0], entryId: 'F3', referenceCaseStrip: null },
    ];
    const { column, destroy } = mount(fakeController(ev));
    expect(tabs(column)).toEqual(['Draft', 'Inbox (0)', 'Changes (0)', 'PathGrade (1)']);
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-tab="pathgrade"]')!);
    });
    expect(column.querySelector('[data-rs-panel="pathgrade"] [data-rs-pathgrade]')).not.toBeNull();
    expect(
      [...column.querySelectorAll('[data-rs-pathgrade-strip]')].map(li => li.textContent)
    ).toEqual(['Lesion · renal massReference cases: 4 public cases of this class']);
    destroy();
  });

  it('goes when the study no longer has a held strip, back to the Draft', async () => {
    const controller = fakeController(evidenceWith(HELD));
    const { column, destroy } = mount(controller);
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-tab="pathgrade"]')!);
    });
    expect(column.querySelector('[data-rs-panel="pathgrade"]')).not.toBeNull();
    await act(async () => {
      controller.setEvidence(evidenceWith(EMPTY));
    });
    expect(tabs(column)).toEqual(['Draft', 'Inbox (0)', 'Changes (0)']);
    expect(column.querySelector('[data-rs-panel="draft"]')).not.toBeNull();
    destroy();
  });
});
