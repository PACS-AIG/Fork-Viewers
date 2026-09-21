import {
  ATTEMPT_STAGES,
  READINESS_STAGES,
  AttemptTrace,
  fnv1a64Hex,
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
