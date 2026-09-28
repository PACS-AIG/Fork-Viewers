/**
 * The attempt observers over the REAL attempt recorder (platform/core
 * utils/attempt) and stub services. Each document is a fresh module registry
 * (a fresh recorder and a fresh copy of the observers); jsdom's sessionStorage
 * is the window's and survives, as a reload's does. The window hook is
 * read-only, so only the first document of this file publishes it.
 */
import type { AttemptRecorder } from '../../../../platform/core/src/utils/attempt/attempt';
import type { RenderLogHook } from './renderLog';

// Cornerstone's package is ESM-only (an `import` condition), which jest's
// resolver cannot open; the observers read one enum from it.
jest.mock(
  '@cornerstonejs/core',
  () => ({ Enums: { Events: { IMAGE_RENDERED: 'CORNERSTONE_IMAGE_RENDERED' } } }),
  { virtual: true }
);

const CORE_ATTEMPT = '../../../../platform/core/src/utils/attempt/attempt';
const CORE_TRACE = '../../../../platform/core/src/utils/attempt/attemptTrace';
const A = '1.2.840.99.1';
const B = '1.2.840.99.2';

type Observers = (args: { servicesManager: unknown }) => void;

/** A document load: a fresh recorder (resolved as index.js does first thing) and observers over it. */
function loadDocument(): { recorder: AttemptRecorder; initObservers: Observers; studyRefFor: (uid: string) => string } {
  let recorder: AttemptRecorder | null = null;
  let initObservers: Observers | null = null;
  let studyRefFor: ((uid: string) => string) | null = null;
  jest.isolateModules(() => {
    recorder = require(CORE_ATTEMPT).attempt;
    studyRefFor = require(CORE_TRACE).studyRefFor;
    jest.doMock('@ohif/core', () => ({ utils: { attempt: recorder, studyRefFor } }));
    initObservers = require('./initAttemptObservers').default;
  });
  recorder!.init();
  return { recorder: recorder!, initObservers: initObservers!, studyRefFor: studyRefFor! };
}

/** Stub services: grid viewports by id, each showing display sets of A or B. */
function stubServices(viewports: Record<string, string[]>, active: { uid: string | null } = { uid: null }) {
  const displaySets: Record<string, { StudyInstanceUID: string }> = {
    'ds-A1': { StudyInstanceUID: A },
    'ds-A2': { StudyInstanceUID: A },
    'ds-B1': { StudyInstanceUID: B },
  };
  let onAdded: ((payload: unknown) => void) | null = null;
  const services = {
    displaySetService: {
      EVENTS: { DISPLAY_SETS_ADDED: 'event::displaySetsAdded' },
      subscribe: (_event: string, callback: (payload: unknown) => void) => {
        onAdded = callback;
        return { unsubscribe: () => undefined };
      },
      getDisplaySetByUID: (uid: string) => displaySets[uid],
    },
    cornerstoneViewportService: {
      getViewportInfo: (id: string) =>
        viewports[id]
          ? { getViewportData: () => ({ data: viewports[id].map(uid => ({ displaySetInstanceUID: uid })) }) }
          : undefined,
    },
    toolGroupService: { getToolGroupForViewport: () => ({ id: 'default' }) },
    hangingProtocolService: { getState: () => ({ activeStudyUID: active.uid }) },
  };
  return {
    servicesManager: { services },
    addDisplaySets: (sets: Array<{ StudyInstanceUID: string }>) => onAdded?.({ displaySetsAdded: sets }),
  };
}

/** Cornerstone's IMAGE_RENDERED: a non-bubbling event on the viewport's element. */
function rendered(viewportId: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  element.dispatchEvent(new CustomEvent('CORNERSTONE_IMAGE_RENDERED', { detail: { viewportId } }));
  element.remove();
}

const hook = () => (window as unknown as { __pacsaiRenderLog?: RenderLogHook }).__pacsaiRenderLog;

const listeners: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];
const realAddEventListener = document.addEventListener.bind(document);

beforeAll(() => {
  jest.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener, options]);
    realAddEventListener(type, listener, options);
  });
});

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', `/viewer?StudyInstanceUIDs=${A}&attempt=att-observers-test`);
});

afterEach(() => {
  // One document's observers per test.
  listeners.splice(0).forEach(([type, listener, options]) => document.removeEventListener(type, listener, options));
});

describe('the render log (window.__pacsaiRenderLog)', () => {
  it('logs every grid render with the generation at that moment and study refs, never UIDs', () => {
    const { recorder, initObservers, studyRefFor } = loadDocument();
    const active = { uid: A as string | null };
    const stub = stubServices({ 'grid-1': ['ds-A1', 'ds-A2'], 'grid-2': ['ds-B1'] }, active);
    initObservers({ servicesManager: stub.servicesManager });
    expect(Object.getOwnPropertyDescriptor(window, '__pacsaiRenderLog')).toMatchObject({
      writable: false,
      configurable: false,
    });
    expect(Object.isFrozen(hook())).toBe(true);
    expect(hook()!.version).toBe(1);
    expect(hook()!.entries()).toEqual([]);

    rendered('grid-1');
    rendered('renderGPUViewport-thumbnail-7'); // a thumbnail: not a grid viewport
    recorder.begin(B); // an in-document switch: generation 2
    rendered('grid-1'); // A's image still rendering in B's generation, A still active: stale
    active.uid = B; // the protocol re-hangs for B
    rendered('grid-2');
    rendered('grid-1'); // A again, now as B's prior pane
    active.uid = null;
    rendered('grid-2'); // no hanging state: unknown

    const entries = hook()!.entries();
    expect(entries.map(({ generation, studyRefs, activeRef }) => ({ generation, studyRefs, activeRef }))).toEqual([
      { generation: 1, studyRefs: [studyRefFor(A)], activeRef: studyRefFor(A) },
      { generation: 2, studyRefs: [studyRefFor(A)], activeRef: studyRefFor(A) },
      { generation: 2, studyRefs: [studyRefFor(B)], activeRef: studyRefFor(B) },
      { generation: 2, studyRefs: [studyRefFor(A)], activeRef: studyRefFor(B) },
      { generation: 2, studyRefs: [studyRefFor(B)], activeRef: null },
    ]);
    entries.forEach(e => expect(Number.isInteger(e.tMs)).toBe(true));
    const wire = JSON.stringify(entries);
    expect(wire).not.toContain(A);
    expect(wire).not.toContain(B);
    // The trace itself stamps both generation-2 renders with B: only the log tells them apart.
    expect(recorder.snapshot()!.studyRef).toBe(studyRefFor(B));
  });
});

describe('metadata_loaded across documents of one attempt', () => {
  it('is recorded again in a document resumed after a full load (an F5)', () => {
    const doc1 = loadDocument();
    const stub1 = stubServices({});
    doc1.initObservers({ servicesManager: stub1.servicesManager });
    stub1.addDisplaySets([{ StudyInstanceUID: A }]);
    expect(doc1.recorder.snapshot()!.events.filter(e => e.stage === 'metadata_loaded')).toHaveLength(1);
    listeners.splice(0).forEach(([type, listener, options]) => document.removeEventListener(type, listener, options));

    const doc2 = loadDocument();
    expect(doc2.recorder.snapshot()!.documentLoads).toBe(2);
    const stub2 = stubServices({});
    doc2.initObservers({ servicesManager: stub2.servicesManager });
    stub2.addDisplaySets([{ StudyInstanceUID: B }]); // not the requested study
    expect(doc2.recorder.needs('metadata_loaded')).toBe(true);
    stub2.addDisplaySets([{ StudyInstanceUID: A }]);
    expect(doc2.recorder.needs('metadata_loaded')).toBe(false);
    stub2.addDisplaySets([{ StudyInstanceUID: A }]); // once per document
    expect(doc2.recorder.snapshot()!.events.filter(e => e.stage === 'metadata_loaded')).toHaveLength(2);
  });
});
