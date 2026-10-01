import {
  ATTEMPT_STAGES,
  READINESS_STAGES,
  AttemptTrace,
  fnv1a64Hex,
  pinGeneration,
  studyRefFor,
  validateReadiness,
  ERROR_CODE,
} from './attemptTrace';

const SCHEMA_KEYS = [
  'attemptId',
  'generation',
  'stage',
  'tMs',
  'ok',
  'error',
  'buildVersion',
  'workstationId',
  'studyRef',
  'cacheState',
  'containerSize',
];

function memoryDeps(t = 1000) {
  const clock = { t };
  const store = { state: null };
  return {
    clock,
    store,
    deps: {
      now: () => clock.t,
      buildVersion: 'test-build',
      workstationId: 'ws-test',
      load: () => (store.state ? JSON.parse(store.state) : null),
      save: s => {
        store.state = JSON.stringify(s);
      },
    },
  };
}

const init = { attemptId: 'a1', t0: 1000, studyRef: studyRefFor('1.2.3'), cacheState: 'warm' };

describe('attempt trace: shape', () => {
  it('has the package schema stages, in order', () => {
    expect(ATTEMPT_STAGES).toEqual([
      'launch',
      'auth_ready',
      'config_ready',
      'runtime_ready',
      'engine_created',
      'container_sized',
      'metadata_loaded',
      'first_pixels',
      'image_rendered_matching_study',
      'tools_ready',
      'retry_requested',
      'cancelled',
      'failed',
    ]);
    expect(READINESS_STAGES).toEqual(ATTEMPT_STAGES.slice(0, 8));
  });

  it('emits only schema keys, integer tMs, and an error only when not ok', () => {
    const { deps, clock } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    clock.t = 1000 + 2310.7;
    const ok = trace.mark('launch');
    expect(Object.keys(ok).every(k => SCHEMA_KEYS.includes(k))).toBe(true);
    expect(ok.tMs).toBe(2311);
    expect(Number.isInteger(ok.tMs)).toBe(true);
    expect(ok.error).toBeUndefined();
    expect(ok.cacheState).toBe('warm');
    const bad = trace.fail('ENGINE_CACHE_INVALID', 'engine_created', { containerSize: [0, 0] });
    expect(bad.ok).toBe(false);
    expect(bad.error).toEqual({ code: 'ENGINE_CACHE_INVALID' });
    expect(bad.containerSize).toEqual([0, 0]);
    expect(ERROR_CODE.test(bad.error.code)).toBe(true);
  });

  it('never lets a non-schema code through', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    expect(trace.fail('bad code with spaces').error.code).toBe('UNSPECIFIED_ERROR');
  });

  it('tMs never goes negative when a clock is behind t0', () => {
    const { deps, clock } = memoryDeps();
    const trace = new AttemptTrace(deps, { ...init, t0: 5000 });
    clock.t = 4000;
    expect(trace.mark('launch').tMs).toBe(0);
  });
});

describe('attempt trace: study reference carries no PHI', () => {
  it('hashes deterministically and does not contain the uid', () => {
    const uid = '1.2.840.113619.2.55.3.604688.1234';
    expect(fnv1a64Hex(uid)).toBe(fnv1a64Hex(uid));
    expect(fnv1a64Hex(uid)).toMatch(/^[0-9a-f]{16}$/);
    expect(studyRefFor(uid)).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(studyRefFor(uid).includes('604688')).toBe(false);
    expect(studyRefFor(uid)).not.toBe(studyRefFor(uid + '5'));
    expect(studyRefFor('')).toBe('none');
    expect(studyRefFor(undefined)).toBe('none');
  });
});

describe('attempt trace: readiness rule', () => {
  function ready(trace) {
    READINESS_STAGES.forEach(s => trace.mark(s));
  }

  it('is complete only when every readiness stage is ok and the matching image rendered', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    ready(trace);
    expect(trace.snapshot().complete).toBe(false);
    trace.mark('image_rendered_matching_study');
    const v = trace.snapshot().readiness;
    expect(v).toEqual({ ok: true, missing: [], failed: [], rendered: true });
  });

  it('names the stage that is missing or red', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    READINESS_STAGES.filter(s => s !== 'container_sized').forEach(s => trace.mark(s));
    trace.fail('ENGINE_CACHE_INVALID', 'engine_created');
    trace.mark('image_rendered_matching_study');
    const v = trace.snapshot().readiness;
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['container_sized']);
    expect(v.failed).toEqual(['engine_created']);
    expect(v.rendered).toBe(true);
  });

  it('ignores events from another generation or attempt', () => {
    const events = [
      ...READINESS_STAGES.map(stage => ({
        attemptId: 'a1',
        generation: 1,
        stage,
        tMs: 1,
        ok: true,
        buildVersion: 'b',
        workstationId: 'w',
        studyRef: 'fnv1a64:0',
      })),
      {
        attemptId: 'a1',
        generation: 1,
        stage: 'image_rendered_matching_study',
        tMs: 2,
        ok: true,
        buildVersion: 'b',
        workstationId: 'w',
        studyRef: 'fnv1a64:0',
      },
    ];
    expect(validateReadiness(events, 'a1', 1).ok).toBe(true);
    expect(validateReadiness(events, 'a1', 2).ok).toBe(false);
    expect(validateReadiness(events, 'other', 1).ok).toBe(false);
  });

  it('lets a later document supersede an earlier red stage', () => {
    const { deps } = memoryDeps();
    const doc1 = new AttemptTrace(deps, init);
    doc1.mark('launch');
    doc1.fail('CONFIG_NO_DATASOURCES', 'config_ready');
    doc1.mark('runtime_ready');
    // The OIDC callback loads a second document for the same attempt.
    const doc2 = new AttemptTrace(deps, { ...init, studyRef: 'none' });
    expect(doc2.documentLoads).toBe(2);
    expect(doc2.studyRef).toBe(init.studyRef);
    expect(doc2.has('launch')).toBe(true);
    // launch was recorded in document 1; the resumed document must not repeat it
    expect(doc2.mark('launch')).toBeNull();
    doc2.mark('config_ready');
    ['auth_ready', 'runtime_ready', 'engine_created', 'container_sized', 'metadata_loaded', 'first_pixels'].forEach(
      s => doc2.mark(s)
    );
    doc2.mark('image_rendered_matching_study');
    const v = doc2.snapshot().readiness;
    expect(v.ok).toBe(true);
    expect(doc2.events().filter(e => e.stage === 'config_ready').length).toBe(2);
  });
});

describe('attempt trace: documents of one attempt', () => {
  const BOOT_TO_TOOLS = [
    'auth_ready',
    'config_ready',
    'runtime_ready',
    'engine_created',
    'container_sized',
    'metadata_loaded',
    'first_pixels',
    'image_rendered_matching_study',
    'tools_ready',
  ];

  it('re-records every stage in a document resumed after a full render (an F5)', () => {
    const { deps } = memoryDeps();
    const doc1 = new AttemptTrace(deps, init);
    doc1.mark('launch');
    BOOT_TO_TOOLS.forEach(s => doc1.mark(s));
    expect(doc1.snapshot().complete).toBe(true);

    // F5: the same URL (same attempt id) loads a second document, and
    // sessionStorage still holds the trace of the first.
    const doc2 = new AttemptTrace(deps, init);
    expect(doc2.documentLoads).toBe(2);
    // has() spans the documents; needs() is this document's.
    expect(doc2.has('metadata_loaded')).toBe(true);
    expect(doc2.needs('metadata_loaded')).toBe(true);
    expect(doc2.needs('first_pixels')).toBe(true);
    expect(doc2.needs('image_rendered_matching_study')).toBe(true);
    // launch is the launcher's click: once per attempt.
    expect(doc2.mark('launch')).toBeNull();
    BOOT_TO_TOOLS.forEach(s => expect(doc2.mark(s)).not.toBeNull());
    // … and once per document again from here.
    expect(doc2.mark('first_pixels')).toBeNull();
    expect(doc2.needs('image_rendered_matching_study')).toBe(false);
    const stages = doc2.events().map(e => e.stage);
    expect(stages.filter(s => s === 'launch')).toHaveLength(1);
    expect(stages.filter(s => s === 'image_rendered_matching_study')).toHaveLength(2);
    expect(stages.filter(s => s === 'metadata_loaded')).toHaveLength(2);
    expect(doc2.snapshot().complete).toBe(true);
  });

  it('lets a resumed document record a failure the earlier one already recorded', () => {
    const { deps } = memoryDeps();
    const doc1 = new AttemptTrace(deps, init);
    doc1.mark('launch');
    expect(doc1.fail('AUTH_REQUIRED', 'auth_ready')).not.toBeNull();
    expect(doc1.fail('AUTH_REQUIRED', 'auth_ready')).toBeNull(); // once per document
    const doc2 = new AttemptTrace(deps, init);
    expect(doc2.fail('AUTH_REQUIRED', 'auth_ready')).not.toBeNull();
    expect(doc2.events().filter(e => e.stage === 'auth_ready')).toHaveLength(2);
  });

  it('keeps the cold sign-in flow: launch once in document 1, the rest in document 2', () => {
    const { deps } = memoryDeps();
    const doc1 = new AttemptTrace(deps, init);
    doc1.mark('launch'); // then the redirect to the identity provider
    const doc2 = new AttemptTrace(deps, { ...init, studyRef: 'none' }); // the callback URL
    expect(doc2.documentLoads).toBe(2);
    expect(doc2.has('launch', 1)).toBe(true); // attempt.init()'s guard
    expect(doc2.mark('launch')).toBeNull();
    BOOT_TO_TOOLS.forEach(s => expect(doc2.mark(s)).not.toBeNull());
    expect(doc2.events().map(e => e.stage)).toEqual(['launch', ...BOOT_TO_TOOLS]);
    expect(doc2.snapshot().complete).toBe(true);
  });

  it('does not count a fresh document as resumed', () => {
    const { deps, store } = memoryDeps();
    const doc1 = new AttemptTrace(deps, init);
    doc1.mark('launch');
    doc1.mark('metadata_loaded');
    const other = new AttemptTrace(deps, { ...init, attemptId: 'a2' });
    expect(store.state).toContain('"attemptId":"a2"');
    expect(other.documentLoads).toBe(1);
    expect(other.mark('launch')).not.toBeNull();
    expect(other.mark('metadata_loaded')).not.toBeNull();
  });
});

describe('attempt trace: retry and recovery', () => {
  it('lets a failed stage succeed later in the same document (the CPU fallback), and the latest event wins', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    READINESS_STAGES.filter(s => s !== 'engine_created').forEach(s => trace.mark(s));
    trace.fail('ENGINE_CONSTRUCT_FAILED', 'engine_created');
    expect(trace.snapshot().readiness.failed).toEqual(['engine_created']);
    expect(trace.mark('engine_created')).not.toBeNull();
    trace.mark('image_rendered_matching_study');
    expect(trace.snapshot().readiness).toEqual({ ok: true, missing: [], failed: [], rendered: true });
    expect(trace.events().filter(e => e.stage === 'engine_created').map(e => e.ok)).toEqual([false, true]);
  });

  it('records retry_requested and lets already-green stages record again', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    READINESS_STAGES.forEach(s => trace.mark(s));
    expect(trace.mark('engine_created')).toBeNull();
    expect(trace.mark('container_sized')).toBeNull();
    trace.fail('WEBGL_CONTEXT_LOST');
    const r = trace.retry();
    expect(r.stage).toBe('retry_requested');
    expect(r.ok).toBe(true);
    expect(r.generation).toBe(1);
    expect(trace.needs('engine_created')).toBe(true);
    expect(trace.mark('engine_created')).not.toBeNull();
    expect(trace.needs('engine_created')).toBe(false);
    expect(trace.mark('container_sized', { containerSize: [400, 300] })).not.toBeNull();
    expect(trace.needs('image_rendered_matching_study')).toBe(true);
    trace.mark('image_rendered_matching_study');
    expect(trace.snapshot().readiness.ok).toBe(true);
    expect(trace.events().filter(e => e.stage === 'engine_created').length).toBe(2);
    // boot stages are not re-run by a retry and stay deduped
    expect(trace.needs('auth_ready')).toBe(false);
    expect(trace.mark('auth_ready')).toBeNull();
    expect(trace.mark('runtime_ready')).toBeNull();
  });
});

describe('attempt trace: dedupe and generations', () => {
  it('records a non-repeatable stage once per document, but failures may repeat', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    expect(trace.mark('engine_created')).not.toBeNull();
    expect(trace.mark('engine_created')).toBeNull();
    expect(trace.fail('WEBGL_CONTEXT_LOST')).not.toBeNull();
    expect(trace.fail('WEBGL_CONTEXT_LOST')).not.toBeNull();
    expect(trace.events().filter(e => e.stage === 'failed').length).toBe(2);
  });

  it('starts a new generation on a study switch and tags events with it', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    trace.mark('launch');
    expect(trace.begin(studyRefFor('1.2.3'))).toBe(1);
    expect(trace.begin(studyRefFor('9.9.9'))).toBe(2);
    const e = trace.mark('metadata_loaded');
    expect(e.generation).toBe(2);
    expect(e.studyRef).toBe(studyRefFor('9.9.9'));
    expect(trace.has('launch', 1)).toBe(true);
    expect(trace.has('launch', 2)).toBe(false);
  });

  it('fills in the study when the first document did not know it', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, { ...init, studyRef: 'none' });
    trace.mark('launch');
    expect(trace.begin(studyRefFor('1.2.3'))).toBe(1);
    expect(trace.studyRef).toBe(studyRefFor('1.2.3'));
  });

  it('opens a new generation for the same study after requestFreshGeneration (the switch back)', () => {
    // m6-case-switch.md §6: the embed bridge moved the URL A → B → A before
    // B's mode entry began B. The trace still names A in generation 1, so the
    // re-entry's begin(A) must not leave A's old generation current.
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    trace.mark('launch');
    trace.mark('image_rendered_matching_study'); // A rendered in generation 1
    expect(trace.freshGenerationRequested).toBe(false);
    trace.requestFreshGeneration();
    expect(trace.freshGenerationRequested).toBe(true);
    expect(trace.begin(studyRefFor('1.2.3'))).toBe(2);
    expect(trace.studyRef).toBe(studyRefFor('1.2.3'));
    expect(trace.freshGenerationRequested).toBe(false);
    // The render owed is the new generation's; generation 1's does not count.
    expect(trace.needs('image_rendered_matching_study')).toBe(true);
    expect(trace.mark('metadata_loaded').generation).toBe(2);
    // Consumed: the next begin of the same study is a no-op again.
    expect(trace.begin(studyRefFor('1.2.3'))).toBe(2);
    // A different study after a request: one new generation, not two.
    trace.requestFreshGeneration();
    expect(trace.begin(studyRefFor('9.9.9'))).toBe(3);
    expect(trace.begin(studyRefFor('9.9.9'))).toBe(3);
  });

  it('keeps the request across a begin that names no study, and opens a generation even from none', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    trace.requestFreshGeneration();
    expect(trace.begin('none')).toBe(1);
    expect(trace.freshGenerationRequested).toBe(true);
    expect(trace.begin(studyRefFor('1.2.3'))).toBe(2);

    // A trace that did not know its study (the callback URL) fills it in
    // without a new generation — unless a switch asked for a fresh one,
    // which the bridge binds only above the generation it asked at.
    const { deps: deps2 } = memoryDeps();
    const callback = new AttemptTrace(deps2, { ...init, studyRef: 'none' });
    callback.requestFreshGeneration();
    expect(callback.begin(studyRefFor('1.2.3'))).toBe(2);
    expect(callback.studyRef).toBe(studyRefFor('1.2.3'));
  });

  it('keeps the request in this document only: the stored state never carries it', () => {
    const { deps, store } = memoryDeps();
    const doc1 = new AttemptTrace(deps, init);
    doc1.requestFreshGeneration();
    expect(store.state).not.toContain('fresh');
    const doc2 = new AttemptTrace(deps, init); // a reload of the same attempt
    expect(doc2.freshGenerationRequested).toBe(false);
    expect(doc2.begin(studyRefFor('1.2.3'))).toBe(1);
    expect(Object.keys(doc1.snapshot())).not.toContain('freshGenerationRequested');
  });

  it('keeps working when storage throws', () => {
    const deps = {
      now: () => 1500,
      buildVersion: 'b',
      workstationId: 'w',
      load: () => {
        throw new Error('no storage');
      },
      save: () => {
        throw new Error('no storage');
      },
    };
    const trace = new AttemptTrace(deps, init);
    expect(trace.mark('launch').tMs).toBe(500);
    expect(trace.events().length).toBe(1);
  });
});

describe('attempt trace: pinGeneration (a load that settles late)', () => {
  it('is true while the trace stays in the generation the work started in', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    const stillA = pinGeneration(() => trace.generation);
    expect(stillA()).toBe(true);
    trace.begin(studyRefFor('1.2.3')); // the same study again: no new generation
    trace.retry(); // Retry viewer keeps the generation
    expect(stillA()).toBe(true);
    trace.begin(studyRefFor('9.9.9')); // an in-document switch
    expect(stillA()).toBe(false);
    expect(pinGeneration(() => trace.generation)()).toBe(true);
  });

  it('is what keeps a late failure of A off B: the trace stamps it with B', () => {
    const { deps } = memoryDeps();
    const trace = new AttemptTrace(deps, init);
    const loadOfA = pinGeneration(() => trace.generation);
    trace.begin(studyRefFor('9.9.9'));
    const unguarded = trace.fail('VIEWPORT_LOAD_FAILED');
    expect(unguarded.generation).toBe(2);
    expect(unguarded.studyRef).toBe(studyRefFor('9.9.9'));
    expect(loadOfA()).toBe(false);
  });

  it('never blocks a record when a generation cannot be read', () => {
    let generation = null;
    const unknownAtStart = pinGeneration(() => generation);
    generation = 3;
    expect(unknownAtStart()).toBe(true);
    const unknownAtEnd = pinGeneration(() => generation);
    generation = undefined;
    expect(unknownAtEnd()).toBe(true);
    const throwing = pinGeneration(() => {
      throw new Error('no trace');
    });
    expect(throwing()).toBe(true);
  });
});
