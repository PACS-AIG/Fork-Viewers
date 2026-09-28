/**
 * installImagePoolHold over the REAL attempt recorder (platform/core
 * utils/attempt) and a stub of Cornerstone's pool. Each document is a fresh
 * module registry (a fresh recorder and governor); jsdom's sessionStorage is
 * the window's and survives, as a reload's does.
 */
import type { AttemptRecorder } from '../../../../platform/core/src/utils/attempt/attempt';
import type { ImagePoolHold } from './holdImagePoolsUntilFirstRender';

const limits: Record<string, number> = {};
// Cornerstone's package is ESM-only (an `import` condition), which jest's
// resolver cannot open; the governor needs only its pool manager.
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
  }),
  { virtual: true }
);

const CORE_ATTEMPT = '../../../../platform/core/src/utils/attempt/attempt';
const STUDY = '1.2.840.99.1';

type Install = (timeoutMs?: number) => ImagePoolHold | null;

function loadDocument(): { recorder: AttemptRecorder; install: Install } {
  let recorder: AttemptRecorder | null = null;
  let install: Install | null = null;
  jest.isolateModules(() => {
    recorder = require(CORE_ATTEMPT).attempt;
    jest.doMock('@ohif/core', () => ({ utils: { attempt: recorder } }));
    install = require('./installImagePoolHold').default;
  });
  recorder!.init();
  return { recorder: recorder!, install: install! };
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.assign(limits, { interaction: 100, thumbnail: 75, prefetch: 25 });
  window.sessionStorage.clear();
  window.history.replaceState(null, '', `/viewer?StudyInstanceUIDs=${STUDY}&attempt=att-pool-hold-test`);
});

afterEach(() => {
  jest.useRealTimers();
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
