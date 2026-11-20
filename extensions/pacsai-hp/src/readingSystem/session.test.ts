import { act } from '@testing-library/react';
import {
  DEFAULT_POLL_MS,
  MIN_POLL_MS,
  currentReadingSystem,
  enterReadingSystem,
  leaveReadingSystem,
  readingSystemConfig,
  readingSystemEnabled,
  setReadingSystemUser,
} from './session';
import { makeEvidence, makeInbox, makeReport, makeSnapshot, makeVersions } from './testDocs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};

function fakeDock() {
  const column = document.createElement('section');
  column.setAttribute('data-pacsai-reading-column', '');
  document.body.append(column);
  const listeners = new Set<() => void>();
  let gone = false;
  const insets: number[] = [];
  return {
    column,
    insets,
    dock: {
      reportColumn: () => column,
      setReadingSystemInset: (px: number) => insets.push(px),
      isGone: () => gone,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    go: () => {
      gone = true;
      listeners.forEach(l => l());
    },
  };
}

afterEach(() => {
  act(() => leaveReadingSystem());
  delete window.PACSAI_READING_SYSTEM_API;
  delete window.PACSAI_READING_SYSTEM_MODE;
  delete window.PACSAI_READING_SYSTEM_POLL_MS;
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

describe('the reading system switches (RS-36)', () => {
  it('is off without an API base, and reads clinical documents unless told fixture', () => {
    expect(readingSystemConfig()).toBeNull();
    expect(readingSystemEnabled()).toBe(false);
    window.PACSAI_READING_SYSTEM_API = '/api/reading-system/';
    expect(readingSystemConfig()).toEqual({
      base: '/api/reading-system',
      mode: 'clinical',
      pollMs: DEFAULT_POLL_MS,
    });
    window.PACSAI_READING_SYSTEM_MODE = ' Fixture ';
    window.PACSAI_READING_SYSTEM_POLL_MS = '10';
    expect(readingSystemConfig()).toEqual({
      base: '/api/reading-system',
      mode: 'fixture',
      pollMs: MIN_POLL_MS,
    });
    window.PACSAI_READING_SYSTEM_API = '   ';
    expect(readingSystemEnabled()).toBe(false);
  });

  it('puts no pane anywhere without the API base or without the dock', () => {
    const { dock, column } = fakeDock();
    enterReadingSystem('study-x', dock);
    expect(column.querySelector('[data-pacsai-rs-pane]')).toBeNull();
    window.PACSAI_READING_SYSTEM_API = '/rs-api';
    enterReadingSystem('study-x', null);
    expect(document.querySelector('[data-pacsai-rs-pane]')).toBeNull();
  });

  it("mounts the pane in the dock's column, reads the study, names the viewer's user, and goes with the dock", async () => {
    window.PACSAI_READING_SYSTEM_API = '/rs-api';
    window.PACSAI_READING_SYSTEM_MODE = 'fixture';
    const posted: Array<Record<string, unknown>> = [];
    const answers: Record<string, unknown> = {
      report: makeReport(),
      versions: makeVersions(),
      inbox: makeInbox(),
      evidence_view: makeEvidence(),
      snapshots: makeSnapshot(),
    };
    const fetchMock = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(init.body ?? '{}'));
        return {
          status: 200,
          ok: true,
          json: async () => ({
            artifact: 'intake_response',
            status: 'recorded',
            httpStatus: 200,
            revision: 4,
          }),
        };
      }
      const key = Object.keys(answers).find(k => url.includes(`/${k}`)) ?? '';
      return { status: 200, ok: true, json: async () => answers[key] };
    });
    (window as unknown as { fetch: unknown }).fetch = fetchMock;
    setReadingSystemUser(() => ({ profile: { preferred_username: 'dr.reader', sub: 'sub-1' } }));
    const { dock, column, go, insets } = fakeDock();
    await act(async () => {
      enterReadingSystem('study-x', dock);
      await flush();
    });
    expect(column.firstElementChild?.hasAttribute('data-pacsai-rs-pane')).toBe(true);
    // The island starts below the pane: the dock is told the pane's height.
    expect(insets[insets.length - 1]).toBeGreaterThan(0);
    expect(currentReadingSystem()?.getSnapshot().phase).toBe('ready');
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/rs-api/'))).toBe(true);
    expect(posted[0]?.event).toEqual({ type: 'opened' });
    expect(posted[0]?.reader).toEqual({ id: 'dr.reader', role: 'radiologist' });
    // The harness's view names the study by reference, never by UID.
    const state = (
      window as unknown as { __pacsaiReadingSystem: { getState: () => Record<string, unknown> } }
    ).__pacsaiReadingSystem.getState();
    expect(state.phase).toBe('ready');
    expect(String(state.study)).toMatch(/^fnv1a64:/);
    // Entering again keeps the one pane.
    await act(async () => {
      enterReadingSystem('study-x', dock);
      await flush();
    });
    expect(column.querySelectorAll('[data-pacsai-rs-pane]')).toHaveLength(1);
    act(() => go());
    expect(column.querySelector('[data-pacsai-rs-pane]')).toBeNull();
    expect(insets[insets.length - 1]).toBe(0);
    expect(currentReadingSystem()?.getSnapshot().phase).toBe('idle');
  });
});
