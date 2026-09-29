/**
 * installImagePoolHold over the REAL attempt recorder (platform/core
 * utils/attempt), the REAL attempt observers (their grid renders) and a stub
 * of Cornerstone's pool. Each document is a fresh module registry (a fresh
 * recorder, observers and governor); jsdom's sessionStorage is the window's
 * and survives, as a reload's does.
 */
import type { AttemptRecorder } from '../../../../platform/core/src/utils/attempt/attempt';
import type { ImagePoolHold } from './holdImagePoolsUntilFirstRender';

const limits: Record<string, number> = {};
const mockVolumes: Record<string, unknown> = {};
// Cornerstone's package is ESM-only (an `import` condition), which jest's
// resolver cannot open; the governor needs only its pool manager, the
// observers one enum and the volume cache.
jest.mock(
  '@cornerstonejs/core',
  () => ({
    imageLoadPoolManager: {
      getMaxSimultaneousRequests: (type: string) => limits[type],
      setMaxSimultaneousRequests: (type: string, max: number) => {
        limits[type] = max;
      },
      startGrabbing: () => undefined,
    },
    Enums: { Events: { IMAGE_RENDERED: 'CORNERSTONE_IMAGE_RENDERED' } },
    cache: { getVolume: (volumeId: string) => mockVolumes[volumeId] },
  }),
  { virtual: true }
);

const CORE_ATTEMPT = '../../../../platform/core/src/utils/attempt/attempt';
const CORE_TRACE = '../../../../platform/core/src/utils/attempt/attemptTrace';
const STUDY = '1.2.840.99.1';

type Install = (timeoutMs?: number) => ImagePoolHold | null;
type Observers = (args: { servicesManager: unknown }) => void;

function loadDocument(): {
  recorder: AttemptRecorder;
  install: Install;
  initObservers: Observers;
  /** Grid-render listeners the hold has subscribed and not yet unsubscribed. */
  liveGridListeners: () => number;
} {
  let recorder: AttemptRecorder | null = null;
  let install: Install | null = null;
  let initObservers: Observers | null = null;
  let live = 0;
  jest.isolateModules(() => {
    recorder = require(CORE_ATTEMPT).attempt;
    const { studyRefFor } = require(CORE_TRACE);
    jest.doMock('@ohif/core', () => ({ utils: { attempt: recorder, studyRefFor } }));
    jest.doMock('../attempt/initAttemptObservers', () => {
      const actual = jest.requireActual('../attempt/initAttemptObservers');
      return {
        ...actual,
        onGridRender: (listener: (render: unknown) => void) => {
          live++;
          const off = actual.onGridRender(listener);
          return () => {
            live--;
            off();
          };
        },
      };
    });
    initObservers = require('../attempt/initAttemptObservers').default;
    install = require('./installImagePoolHold').default;
  });
  recorder!.init();
  return {
    recorder: recorder!,
    install: install!,
    initObservers: initObservers!,
    liveGridListeners: () => live,
  };
}

/** The viewport service's grid viewports (Cornerstone viewports by id) as the observers read it. */
const gridOf = (viewports: Record<string, unknown>) => ({
  services: {
    cornerstoneViewportService: {
      getViewportInfo: (id: string) =>
        id in viewports ? { getViewportData: () => ({ data: [] }) } : undefined,
      getCornerstoneViewport: (id: string) => viewports[id],
    },
  },
});

/** An MPR viewport whose one actor is a streaming volume with `framesUpdated` decoded frames. */
function mprViewport(volumeId: string, framesUpdated: number) {
  const volume = { framesUpdated, framesProcessed: framesUpdated };
  mockVolumes[volumeId] = volume;
  return {
    volume,
    viewport: {
      getAllVolumeIds: () => [volumeId],
      getActors: () => [{ uid: 'actor-1', referencedId: volumeId }],
    },
  };
}

/** Cornerstone's IMAGE_RENDERED: a non-bubbling event on the viewport's element. */
function rendered(viewportId: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  element.dispatchEvent(new CustomEvent('CORNERSTONE_IMAGE_RENDERED', { detail: { viewportId } }));
  element.remove();
}

const HELD = { interaction: 100, thumbnail: 0, prefetch: 0 };
const RESTORED = { interaction: 100, thumbnail: 75, prefetch: 25 };

const listeners: Array<
  [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]
> = [];
const realAddEventListener = document.addEventListener.bind(document);

beforeAll(() => {
  jest.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener, options]);
    realAddEventListener(type, listener, options);
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  Object.assign(limits, { interaction: 100, thumbnail: 75, prefetch: 25 });
  window.sessionStorage.clear();
  window.history.replaceState(
    null,
    '',
    `/viewer?StudyInstanceUIDs=${STUDY}&attempt=att-pool-hold-test`
  );
});

afterEach(() => {
  jest.useRealTimers();
  // One document's observers per test.
  listeners
    .splice(0)
    .forEach(([type, listener, options]) => document.removeEventListener(type, listener, options));
  Object.keys(mockVolumes).forEach(id => delete mockVolumes[id]);
});

describe('installImagePoolHold', () => {
  it('holds until this document’s first render, and not again once it is up', () => {
    const { recorder, install } = loadDocument();
    const hold = install();
    expect(hold).not.toBeNull();
    expect(limits).toEqual({ interaction: 100, thumbnail: 0, prefetch: 0 });
    recorder.mark('first_pixels');
    expect(hold!.reason).toBe('first_render');
    expect(limits).toEqual({ interaction: 100, thumbnail: 75, prefetch: 25 });
    expect(install()).toBeNull(); // the mode re-entered for the same study
  });

  it('holds again in a document resumed after a render (an F5): the reload owes its own first render', () => {
    const doc1 = loadDocument();
    doc1.install()!.release('manual');
    doc1.recorder.mark('first_pixels');
    expect(doc1.install()).toBeNull();

    const doc2 = loadDocument();
    expect(doc2.recorder.snapshot()!.documentLoads).toBe(2);
    const hold = doc2.install();
    expect(hold).not.toBeNull();
    expect(limits).toEqual({ interaction: 100, thumbnail: 0, prefetch: 0 });
    doc2.recorder.mark('first_pixels');
    expect(hold!.released).toBe(true);
    expect(hold!.reason).toBe('first_render');
    expect(limits).toEqual({ interaction: 100, thumbnail: 75, prefetch: 25 });
  });
});

describe('installImagePoolHold on the grid’s renders (the real observers)', () => {
  it('a volume viewport’s first grid render releases it at once, before a frame is decoded: its frames stream through the prefetch pool', () => {
    const { recorder, install, initObservers, liveGridListeners } = loadDocument();
    const mpr = mprViewport('cornerstoneStreamingImageVolume:ds-1', 0);
    initObservers({ servicesManager: gridOf({ 'mpr-axial': mpr.viewport }) });
    const hold = install()!;
    expect(limits).toEqual(HELD);

    rendered('renderGPUViewport-thumbnail-1'); // a thumbnail is no grid render
    expect(hold.released).toBe(false);

    rendered('mpr-axial'); // an empty texture: framesUpdated 0
    expect(hold.reason).toBe('volume_render');
    expect(limits).toEqual(RESTORED);
    expect(recorder.needs('first_pixels')).toBe(true); // no pixels yet: the stage is still owed
    expect(liveGridListeners()).toBe(0);

    mpr.volume.framesUpdated = 1; // the frames the released pool streamed in
    rendered('mpr-axial');
    expect(recorder.needs('first_pixels')).toBe(false);
    expect(hold.reason).toBe('volume_render');
  });

  it('an empty stack render does not release it; the first stack render with an image does, through first_pixels', () => {
    const { install, initObservers, liveGridListeners } = loadDocument();
    const shown = { image: undefined as { imageId: string } | undefined };
    const stack = { getCornerstoneImage: () => shown.image };
    initObservers({ servicesManager: gridOf({ 'grid-1': stack }) });
    const hold = install()!;

    rendered('grid-1'); // before the decode workers answer (the stack's images: interaction pool)
    rendered('grid-1');
    expect(hold.released).toBe(false);
    expect(limits).toEqual(HELD);

    shown.image = { imageId: 'wadors:1/1' };
    rendered('grid-1');
    expect(hold.reason).toBe('first_render');
    expect(limits).toEqual(RESTORED);
    expect(liveGridListeners()).toBe(0);
  });

  it('with no grid render at all the timeout releases it, unchanged, and leaves no grid listener behind', () => {
    const { install, initObservers, liveGridListeners } = loadDocument();
    const mpr = mprViewport('cornerstoneStreamingImageVolume:ds-1', 0);
    initObservers({ servicesManager: gridOf({ 'mpr-axial': mpr.viewport }) });
    const hold = install()!;
    jest.advanceTimersByTime(7999);
    expect(hold.released).toBe(false);
    jest.advanceTimersByTime(1);
    expect(hold.reason).toBe('timeout');
    expect(limits).toEqual(RESTORED);
    expect(liveGridListeners()).toBe(0);
    rendered('mpr-axial');
    expect(hold.reason).toBe('timeout');
  });

  it('a mode exit leaves no grid listener behind either', () => {
    const { install, liveGridListeners } = loadDocument();
    const hold = install()!;
    expect(liveGridListeners()).toBe(1);
    hold.release('mode_exit');
    expect(liveGridListeners()).toBe(0);
    expect(limits).toEqual(RESTORED);
  });
});
