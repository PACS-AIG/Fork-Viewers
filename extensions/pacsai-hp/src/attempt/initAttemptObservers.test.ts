/**
 * The attempt observers over the REAL attempt recorder (platform/core
 * utils/attempt) and stub services. Each document is a fresh module registry
 * (a fresh recorder and a fresh copy of the observers); jsdom's sessionStorage
 * is the window's and survives, as a reload's does. The window hook is
 * read-only, so only the first document of this file publishes it.
 */
import type { AttemptRecorder } from '../../../../platform/core/src/utils/attempt/attempt';
import type { RenderLog, RenderLogHook } from './renderLog';

// Cornerstone's package is ESM-only (an `import` condition), which jest's
// resolver cannot open; the observers read one enum and the volume cache.
const mockVolumes: Record<string, unknown> = {};
jest.mock(
  '@cornerstonejs/core',
  () => ({
    Enums: { Events: { IMAGE_RENDERED: 'CORNERSTONE_IMAGE_RENDERED' } },
    cache: { getVolume: (volumeId: string) => mockVolumes[volumeId] },
  }),
  { virtual: true }
);

const CORE_ATTEMPT = '../../../../platform/core/src/utils/attempt/attempt';
const CORE_TRACE = '../../../../platform/core/src/utils/attempt/attemptTrace';
const A = '1.2.840.99.1';
const B = '1.2.840.99.2';

type Observers = (args: { servicesManager: unknown }) => void;
type GridRenderHook = typeof import('./initAttemptObservers').onGridRender;

/** A document load: a fresh recorder (resolved as index.js does first thing) and observers over it. */
function loadDocument(): {
  recorder: AttemptRecorder;
  initObservers: Observers;
  onGridRender: GridRenderHook;
  studyRefFor: (uid: string) => string;
  /** This document's render log (the window hook holds only the first document's). */
  logEntries: () => ReturnType<RenderLog['entries']>;
} {
  let recorder: AttemptRecorder | null = null;
  let initObservers: Observers | null = null;
  let onGridRender: GridRenderHook | null = null;
  let studyRefFor: ((uid: string) => string) | null = null;
  let renderLog: RenderLog | null = null;
  jest.isolateModules(() => {
    recorder = require(CORE_ATTEMPT).attempt;
    studyRefFor = require(CORE_TRACE).studyRefFor;
    jest.doMock('@ohif/core', () => ({ utils: { attempt: recorder, studyRefFor } }));
    jest.doMock('./renderLog', () => {
      const actual = jest.requireActual('./renderLog');
      return {
        ...actual,
        createRenderLog: (capacity?: number) => (renderLog = actual.createRenderLog(capacity)),
      };
    });
    ({ default: initObservers, onGridRender } = require('./initAttemptObservers'));
  });
  recorder!.init();
  return {
    recorder: recorder!,
    initObservers: initObservers!,
    onGridRender: onGridRender!,
    studyRefFor: studyRefFor!,
    logEntries: () => renderLog?.entries() ?? [],
  };
}

/** A Cornerstone StackViewport as the observers read it: csImage is set once one is displayed. */
const stackViewport = (image: { imageId: string } | undefined) => ({
  getCornerstoneImage: () => image,
});

/**
 * Stub services: grid viewports by id, each showing display sets of A or B (a
 * stack with an image unless `cs` says otherwise).
 */
function stubServices(
  viewports: Record<string, string[]>,
  active: { uid: string | null } = { uid: null },
  cs: Record<string, unknown> = {}
) {
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
      getCornerstoneViewport: (id: string) =>
        !viewports[id] ? null : id in cs ? cs[id] : stackViewport({ imageId: `wadors:${id}` }),
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
    expect(
      entries.map(({ generation, studyRefs, activeRef, image }) => ({
        generation,
        studyRefs,
        activeRef,
        image,
      }))
    ).toEqual([
      { generation: 1, studyRefs: [studyRefFor(A)], activeRef: studyRefFor(A), image: true },
      { generation: 2, studyRefs: [studyRefFor(A)], activeRef: studyRefFor(A), image: true },
      { generation: 2, studyRefs: [studyRefFor(B)], activeRef: studyRefFor(B), image: true },
      { generation: 2, studyRefs: [studyRefFor(A)], activeRef: studyRefFor(B), image: true },
      { generation: 2, studyRefs: [studyRefFor(B)], activeRef: null, image: true },
    ]);
    entries.forEach(e => expect(Number.isInteger(e.tMs)).toBe(true));
    const wire = JSON.stringify(entries);
    expect(wire).not.toContain(A);
    expect(wire).not.toContain(B);
    // The trace itself stamps both generation-2 renders with B: only the log tells them apart.
    expect(recorder.snapshot()!.studyRef).toBe(studyRefFor(B));
  });
});

const RENDER_STAGES: string[] = ['first_pixels', 'image_rendered_matching_study', 'tools_ready'];
const stagesOf = (recorder: AttemptRecorder) =>
  recorder
    .snapshot()!
    .events.map(e => e.stage)
    .filter(stage => RENDER_STAGES.includes(stage));

describe('a render counts only when the viewport shows an image', () => {
  it('an empty stack render (nothing decoded) is logged with image:false and records no stage; the first with an image records them', () => {
    const { recorder, initObservers, logEntries } = loadDocument();
    const shown = { image: undefined as { imageId: string } | undefined };
    const grid = { getCornerstoneImage: () => shown.image };
    const stub = stubServices({ 'grid-1': ['ds-A1'] }, { uid: A }, { 'grid-1': grid });
    initObservers({ servicesManager: stub.servicesManager });

    rendered('grid-1'); // Cornerstone renders the grid before the decode workers answer
    rendered('grid-1');
    expect(stagesOf(recorder)).toEqual([]);
    expect(recorder.needs('first_pixels')).toBe(true);
    expect(recorder.needs('image_rendered_matching_study')).toBe(true);

    shown.image = { imageId: 'wadors:A1/1' }; // StackViewport renderImageObject → csImage
    rendered('grid-1');
    expect(stagesOf(recorder)).toEqual([
      'first_pixels',
      'image_rendered_matching_study',
      'tools_ready',
    ]);
    expect(logEntries().map(e => e.image)).toEqual([false, false, true]);
  });

  it('a volume viewport counts once its streaming volume has a decoded frame, not a failed one', () => {
    const { recorder, initObservers, logEntries } = loadDocument();
    const volumeId = 'cornerstoneStreamingImageVolume:ds-A1';
    const volume = { framesUpdated: 0, framesProcessed: 0 };
    mockVolumes[volumeId] = volume;
    mockVolumes['labelmap-1'] = { voxelManager: {} }; // derived: no streaming counters
    const mpr = {
      getAllVolumeIds: () => [volumeId, 'labelmap-1'],
      getActors: () => [{ uid: 'actor-1', referencedId: volumeId }, { uid: 'labelmap-1' }],
    };
    const stub = stubServices({ 'mpr-axial': ['ds-A1'] }, { uid: A }, { 'mpr-axial': mpr });
    initObservers({ servicesManager: stub.servicesManager });

    rendered('mpr-axial'); // framesUpdated 0: an empty texture
    volume.framesProcessed = 3; // three frames failed for good: processed, never decoded
    rendered('mpr-axial');
    expect(stagesOf(recorder)).toEqual([]);

    volume.framesUpdated = 1; // the first decoded frame is in the texture
    volume.framesProcessed = 4;
    rendered('mpr-axial');
    expect(stagesOf(recorder)).toEqual([
      'first_pixels',
      'image_rendered_matching_study',
      'tools_ready',
    ]);
    expect(logEntries().map(e => e.image)).toEqual([false, false, true]);
    delete mockVolumes[volumeId];
    delete mockVolumes['labelmap-1'];
  });

  it('a viewport of a shape it does not know (or none at all) is not an image; the thumbnail stays out', () => {
    const { recorder, initObservers, logEntries } = loadDocument();
    const stub = stubServices(
      { video: ['ds-A1'], gone: ['ds-A1'], throws: ['ds-A1'] },
      { uid: A },
      {
        video: { play: () => undefined },
        gone: null,
        throws: {
          getCornerstoneImage: () => {
            throw new Error('destroyed');
          },
        },
      }
    );
    initObservers({ servicesManager: stub.servicesManager });
    rendered('video');
    rendered('gone');
    rendered('throws');
    rendered('renderGPUViewport-thumbnail-3');
    expect(stagesOf(recorder)).toEqual([]);
    expect(logEntries().map(e => e.image)).toEqual([false, false, false]);
  });
});

describe('onGridRender (the image-pool hold’s volume release)', () => {
  it('hears every grid render, image or not, with whether it is a volume viewport; never a thumbnail; until unsubscribed', () => {
    const { recorder, initObservers, onGridRender } = loadDocument();
    const volumeId = 'cornerstoneStreamingImageVolume:ds-A1';
    const volume = { framesUpdated: 0 };
    mockVolumes[volumeId] = volume;
    const mpr = {
      getAllVolumeIds: () => [volumeId],
      getActors: () => [{ uid: 'actor-1', referencedId: volumeId }],
    };
    const stub = stubServices(
      { 'mpr-axial': ['ds-A1'], 'grid-1': ['ds-A1'], video: ['ds-A1'] },
      { uid: A },
      { 'mpr-axial': mpr, 'grid-1': stackViewport(undefined), video: { play: () => undefined } }
    );
    initObservers({ servicesManager: stub.servicesManager });
    const heard: unknown[] = [];
    const off = onGridRender(render => heard.push(render));
    onGridRender(() => {
      throw new Error('a broken listener'); // reaches neither the viewer nor the others
    });

    rendered('mpr-axial'); // an empty texture
    rendered('grid-1'); // an empty stack
    rendered('video');
    rendered('renderGPUViewport-thumbnail-2');
    volume.framesUpdated = 2;
    rendered('mpr-axial');
    expect(heard).toEqual([
      { viewportId: 'mpr-axial', isVolume: true, image: false },
      { viewportId: 'grid-1', isVolume: false, image: false },
      { viewportId: 'video', isVolume: false, image: false },
      { viewportId: 'mpr-axial', isVolume: true, image: true },
    ]);
    expect(stagesOf(recorder)).toEqual([
      'first_pixels',
      'image_rendered_matching_study',
      'tools_ready',
    ]);

    off();
    rendered('mpr-axial');
    expect(heard).toHaveLength(4);
    delete mockVolumes[volumeId];
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
