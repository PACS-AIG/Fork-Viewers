import { act, fireEvent } from '@testing-library/react';
import type { RsController, RsSnapshot } from './rsController';
import { BAR_PX, ISLAND_MIN_PX, PANE_MIN_PX, createRsHost, inReportEditor, isTyping, paneHeightPx } from './rsHost';
import { makeEvidence, makeInbox, makeReport, makeVersions } from './testDocs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeController(initial: Partial<RsSnapshot> = {}) {
  let state: RsSnapshot = {
    phase: 'ready',
    reason: null,
    docs: { report: makeReport(), versions: makeVersions(), inbox: makeInbox(), evidence: makeEvidence() },
    selection: null,
    copilotOpen: false,
    tab: 'draft',
    collapsed: false,
    busy: false,
    notice: null,
    canRetry: false,
    ...initial,
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
    toggleCopilot: jest.fn(() => {
      set({ copilotOpen: !state.copilotOpen });
      return true;
    }),
    openCopilot: jest.fn(() => {
      set({ copilotOpen: true });
      return true;
    }),
    closeCopilot: jest.fn(() => set({ copilotOpen: false })),
    select: jest.fn((id: string) => set({ selection: { entryId: 'F1', passageId: id, sentenceId: 's-liver' } })),
    moveSelection: jest.fn(),
    setTab: jest.fn((tab: RsSnapshot['tab']) => set({ tab })),
    setCollapsed: jest.fn((collapsed: boolean) => set({ collapsed })),
    accept: jest.fn(async () => {}),
    reject: jest.fn(async () => {}),
    undo: jest.fn(async () => {}),
    retry: jest.fn(async () => {}),
    dismissNotice: jest.fn(),
    harnessState: () => ({}),
    enter: jest.fn(),
    leave: jest.fn(),
  };
  return { controller: c as unknown as RsController & typeof c, set };
}

function column() {
  const col = document.createElement('section');
  col.setAttribute('data-pacsai-reading-column', '');
  const island = document.createElement('div');
  island.setAttribute('data-pacsai-reading-island', '');
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  const islandButton = document.createElement('button');
  island.append(editor, islandButton);
  col.append(island);
  document.body.append(col);
  col.getBoundingClientRect = () => ({ height: 1000, width: 600, top: 0, left: 0, right: 600, bottom: 1000, x: 0, y: 0, toJSON() {} });
  return { col, island, editor, islandButton };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the pane in the report column (RS-36)', () => {
  it('sizes the pane: nothing for a study not served, its bar folded or not ready, a share of the column open', () => {
    expect(paneHeightPx({ phase: 'not_served', collapsed: false }, 1000)).toBe(0);
    expect(paneHeightPx({ phase: 'idle', collapsed: false }, 1000)).toBe(0);
    expect(paneHeightPx({ phase: 'loading', collapsed: false }, 1000)).toBe(BAR_PX);
    expect(paneHeightPx({ phase: 'ready', collapsed: true }, 1000)).toBe(BAR_PX);
    expect(paneHeightPx({ phase: 'ready', collapsed: false }, 1000)).toBe(450);
    // At least PANE_MIN_PX, and the island keeps ISLAND_MIN_PX.
    expect(paneHeightPx({ phase: 'ready', collapsed: false }, 300)).toBe(300 - ISLAND_MIN_PX);
    expect(paneHeightPx({ phase: 'ready', collapsed: false }, 420)).toBe(PANE_MIN_PX);
    expect(paneHeightPx({ phase: 'ready', collapsed: false }, 100)).toBe(BAR_PX);
  });

  it('tells typing and the report editor apart from a command', () => {
    const { editor, islandButton } = column();
    const input = document.createElement('input');
    document.body.append(input);
    expect(isTyping(input)).toBe(true);
    expect(isTyping(editor)).toBe(true);
    expect(isTyping(document.body)).toBe(false);
    expect(inReportEditor(islandButton)).toBe(true);
    expect(inReportEditor(document.body)).toBe(false);
    const portal = document.createElement('div');
    portal.setAttribute('data-pacs-island-portal-host', '');
    const inPortal = document.createElement('span');
    portal.append(inPortal);
    document.body.append(portal);
    expect(inReportEditor(inPortal)).toBe(true);
  });

  it('mounts the pane as the column\'s first child and tells the dock its height, for the island to start below', () => {
    const { col } = column();
    const { controller } = fakeController();
    const setInset = jest.fn();
    let host: ReturnType<typeof createRsHost>;
    act(() => {
      host = createRsHost({ win: window, column: col, controller, setInset });
    });
    expect(col.firstElementChild).toBe(host!.element);
    expect(host!.element.getAttribute('aria-label')).toBe('CT analysis');
    expect(host!.element.style.height).toBe('450px');
    expect(setInset).toHaveBeenLastCalledWith(450);
    expect(host!.element.querySelector('[data-rs-draft]')).not.toBeNull();
    act(() => {
      controller.setCollapsed(true);
    });
    expect(host!.element.style.height).toBe(`${BAR_PX}px`);
    expect(setInset).toHaveBeenLastCalledWith(BAR_PX);
    act(() => host!.destroy());
    expect(col.querySelector('[data-pacsai-rs-pane]')).toBeNull();
    expect(setInset).toHaveBeenLastCalledWith(0);
  });

  it('gives a study the reading system does not serve no pane at all', () => {
    const { col } = column();
    const { controller } = fakeController({ phase: 'not_served', docs: null });
    const setInset = jest.fn();
    let host: ReturnType<typeof createRsHost>;
    act(() => {
      host = createRsHost({ win: window, column: col, controller, setInset });
    });
    expect(setInset).toHaveBeenLastCalledWith(0);
    expect(host!.element.style.display).toBe('none');
    act(() => host!.destroy());
  });

  it('opens and closes the Copilot on K, never while typing or in the report editor, and closes it on Escape', () => {
    const { col, editor, islandButton } = column();
    const { controller } = fakeController();
    let host: ReturnType<typeof createRsHost>;
    act(() => {
      host = createRsHost({ win: window, column: col, controller, setInset: () => {} });
    });
    act(() => {
      fireEvent.keyDown(document.body, { key: 'k' });
    });
    expect(controller.toggleCopilot).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().copilotOpen).toBe(true);
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(controller.closeCopilot).toHaveBeenCalled();
    expect(controller.getSnapshot().copilotOpen).toBe(false);
    act(() => {
      fireEvent.keyDown(editor, { key: 'k' });
      fireEvent.keyDown(islandButton, { key: 'k' });
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
      fireEvent.keyDown(document.body, { key: 'k', repeat: true });
    });
    expect(controller.toggleCopilot).toHaveBeenCalledTimes(1);
    act(() => host!.destroy());
    act(() => {
      fireEvent.keyDown(document.body, { key: 'k' });
    });
    expect(controller.toggleCopilot).toHaveBeenCalledTimes(1);
  });

  it('renders the draft: a click selects and opens nothing, the inbox shows the preview with Accept and Reject', () => {
    const { col } = column();
    const inbox = makeInbox({
      entries: [
        {
          id: 'inbox-1',
          kind: 'update',
          entryIds: ['F1'],
          updates: ['u-1'],
          claims: [],
          summary: 'diameter 12 -> 14 mm',
          preview: [{ passageId: 'p-liver', section: 'liver_and_biliary', before: 'old line', after: 'changed line' }],
          acceptable: true,
        },
      ],
    });
    const { controller, set } = fakeController();
    set({ docs: { report: makeReport(), versions: makeVersions(), inbox, evidence: makeEvidence() } });
    let host: ReturnType<typeof createRsHost>;
    act(() => {
      host = createRsHost({ win: window, column: col, controller, setInset: () => {} });
    });
    const sentence = col.querySelector('[data-rs-passage="p-liver"]') as HTMLElement;
    act(() => {
      fireEvent.click(sentence);
    });
    expect(controller.select).toHaveBeenCalledWith('p-liver');
    expect(col.querySelector('[data-rs-copilot]')).toBeNull();
    expect(col.querySelector('[data-rs-inbox-count]')?.getAttribute('data-rs-inbox-count')).toBe('1');
    act(() => {
      fireEvent.keyDown(sentence, { key: 'Enter' });
    });
    expect(controller.openCopilot).toHaveBeenCalled();
    expect(col.querySelector('[data-rs-copilot="F1"]')).not.toBeNull();
    act(() => {
      controller.setTab('inbox');
    });
    expect(col.querySelector('[data-rs-change="p-liver"] [data-rs-after]')?.textContent).toBe('changed line');
    act(() => {
      fireEvent.click(col.querySelector('[data-rs-accept="inbox-1"]') as HTMLElement);
      fireEvent.click(col.querySelector('[data-rs-reject="inbox-1"]') as HTMLElement);
    });
    expect(controller.accept).toHaveBeenCalledWith('inbox-1');
    expect(controller.reject).toHaveBeenCalledWith('inbox-1');
    act(() => host!.destroy());
  });
});
