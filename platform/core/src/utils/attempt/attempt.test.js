/**
 * The browser half of the attempt trace (attempt.ts): which study a mode
 * entry's begin() names, and the embed bridge's fresh-generation request
 * (m6-case-switch.md §6). Each test is one document: a fresh module registry,
 * so a fresh recorder, over jsdom's window and sessionStorage.
 */
import { studyRefFor } from './attemptTrace';

const A = '1.2.840.99.1';
const B = '1.2.840.99.2';

function loadDocument(search) {
  window.history.replaceState(null, '', `/viewer${search}`);
  let recorder = null;
  jest.isolateModules(() => {
    recorder = require('./attempt').attempt;
  });
  recorder.init();
  return recorder;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('attempt.begin: the study a mode entry names', () => {
  it('reads window.location when no study is passed, as before', () => {
    const doc = loadDocument(`?StudyInstanceUIDs=${A}&attempt=att-loc`);
    expect(doc.begin()).toBe(1);
    expect(doc.snapshot().studyRef).toBe(studyRefFor(A));
    // The URL moved (an in-document switch): the next entry follows it.
    window.history.replaceState(null, '', `/viewer?StudyInstanceUIDs=${B},${A}&attempt=att-loc`);
    expect(doc.begin()).toBe(2);
    expect(doc.snapshot().studyRef).toBe(studyRefFor(B));
  });

  it('uses the route’s studyInstanceUIDs when given, not window.location', () => {
    // The route can still be loading B while the URL already names A (a
    // switch during the first layout's await): the trace must name what the
    // route loads.
    const doc = loadDocument(`?StudyInstanceUIDs=${A}&attempt=att-route`);
    expect(doc.begin([B, A])).toBe(2);
    expect(doc.snapshot().studyRef).toBe(studyRefFor(B));
    expect(doc.begin([` ${B} `])).toBe(2);
    expect(doc.begin(`${A},${B}`)).toBe(3);
    expect(doc.snapshot().studyRef).toBe(studyRefFor(A));
  });

  it('names no study for null, an empty list or a blank uid: a no-op, never window.location', () => {
    const doc = loadDocument(`?StudyInstanceUIDs=${A}&attempt=att-none`);
    window.history.replaceState(null, '', `/viewer?StudyInstanceUIDs=${B}&attempt=att-none`);
    expect(doc.begin(null)).toBe(1);
    expect(doc.begin([])).toBe(1);
    expect(doc.begin([''])).toBe(1);
    expect(doc.begin('  ')).toBe(1);
    expect(doc.snapshot().studyRef).toBe(studyRefFor(A));
  });
});

describe('attempt.requestFreshGeneration', () => {
  it('makes the next begin of the same study a new generation, once', () => {
    const doc = loadDocument(`?StudyInstanceUIDs=${A}&attempt=att-fresh`);
    expect(doc.begin([A])).toBe(1);
    doc.requestFreshGeneration();
    expect(doc.begin([A])).toBe(2);
    expect(doc.begin([A])).toBe(2);
    expect(doc.mark('metadata_loaded')).toMatchObject({ generation: 2, studyRef: studyRefFor(A) });
  });

  it('survives to the boot’s first mode entry (a switch back before the boot)', () => {
    // index.js resolves the attempt before the bridge is installed, so the
    // trace already names the URL's study A in generation 1. A → B → A before
    // the router exists only rewrote the URL; the boot's begin(A) must still
    // open generation 2, the one the bridge waits for.
    const doc = loadDocument(`?StudyInstanceUIDs=${A}&attempt=att-preboot`);
    doc.requestFreshGeneration(); // switchStudy(B)
    doc.requestFreshGeneration(); // switchStudy(A)
    doc.mark('auth_ready');
    doc.mark('config_ready');
    doc.mark('runtime_ready');
    expect(doc.snapshot().generation).toBe(1);
    expect(doc.begin([A])).toBe(2);
  });

  it('is kept by a mode entry that names no study, and used by the next one that does', () => {
    const doc = loadDocument(`?StudyInstanceUIDs=${A}&attempt=att-keep`);
    doc.requestFreshGeneration();
    expect(doc.begin(null)).toBe(1);
    expect(doc.begin([A])).toBe(2);
  });
});
