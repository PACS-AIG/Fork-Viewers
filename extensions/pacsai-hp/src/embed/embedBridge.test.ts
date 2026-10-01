import {
  createEmbedBridge,
  EMBED_HELLO_DELAYS_MS,
  EMBED_HELLO_MAX_POSTS,
  EMBED_VIEWER_CAPS,
  STUDY_SWITCH_TIMEOUT_MS,
  type EmbedAttemptEvent,
  type EmbedBridge,
  type EmbedBridgeDeps,
  type EmbedScheduler,
} from './embedBridge';
import { buildEmbedMessage, parseEmbedMessage, type ToShellMessage } from './embedProtocol';

const SHELL = 'http://localhost:3000';
const OTHER_ALLOWED = 'https://app-dev.pacsai.net';
const ALLOWED = [SHELL, OTHER_ALLOWED];
const DOC = 'docIdABCDEFGHIJKLMNOPQ';
const NONCE = 'nonceABCDEFGHIJKLMNOPq';
const OTHER_NONCE = 'nonce2_-abcdefghijklmn';
const A = '1.2.3.4.5';
const B = '1.2.3.4.6';
const C = '1.2.3.4.7';
const GW = 'GATEWAY_AET_1';
const RENDER = 'image_rendered_matching_study';
/** The boot stages a document records before its first mode entry. */
const BOOT = ['auth_ready', 'config_ready', 'runtime_ready'];

const ref = (uid: string) => `ref:${uid}`;

type TraceEvent = EmbedAttemptEvent & { studyRef: string };

/**
 * The attempt recorder's observable behaviour: record, then notify; begin(other)
 * = a new generation, and so is begin(same) after requestFreshGeneration (the
 * bridge's switch, m6-case-switch.md §6). Like the real recorder, it stamps
 * EVERY event with the CURRENT generation and study: nothing can arrive tagged
 * with an older one.
 */
function fakeTrace(studyUid: string, attemptId = 'att-3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f') {
  let generation = 1;
  let studyRef = ref(studyUid);
  let fresh = false;
  let freshRequests = 0;
  const events: TraceEvent[] = [];
  const listeners = new Set<(e: EmbedAttemptEvent) => void>();
  let subscriptions = 0;
  const emit = (partial: Pick<EmbedAttemptEvent, 'stage' | 'ok' | 'error'>) => {
    const event: TraceEvent = { attemptId, generation, studyRef, stage: partial.stage, ok: partial.ok };
    if (partial.error) {
      event.error = partial.error;
    }
    events.push(event);
    listeners.forEach(l => l(event));
  };
  return {
    view: {
      subscribe: (listener: (e: EmbedAttemptEvent) => void) => {
        subscriptions++;
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: () => ({ attemptId, generation, studyRef, events: events.slice() }),
      requestFreshGeneration: () => {
        fresh = true;
        freshRequests++;
      },
    },
    get generation() {
      return generation;
    },
    get studyRef() {
      return studyRef;
    },
    get subscriptions() {
      return subscriptions;
    },
    get listening() {
      return listeners.size;
    },
    get freshRequests() {
      return freshRequests;
    },
    /** A mode entry (no event: the real begin records none). */
    begin(uid: string) {
      if (fresh || ref(uid) !== studyRef) {
        generation++;
        studyRef = ref(uid);
      }
      fresh = false;
    },
    /** The trace names a study in the generation it is in (the real one's fill-in of 'none'). */
    rename(uid: string) {
      studyRef = ref(uid);
    },
    mark(stage: string) {
      emit({ stage, ok: true });
    },
    fail(code: string, stage = 'failed') {
      emit({ stage, ok: false, error: { code } });
    },
    /** Any event (an odd stage or code), stamped like every other. */
    emit,
  };
}

function fakeScheduler() {
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean; fired: boolean }> = [];
  return {
    timers,
    setTimeout: (fn: () => void, ms: number) => {
      const t = { fn, ms, cancelled: false, fired: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (handle: unknown) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
    pending: () => timers.filter(t => !t.cancelled && !t.fired),
    /** Fire the timers due now, one round. */
    tick: () => {
      timers
        .filter(t => !t.cancelled && !t.fired)
        .forEach(t => {
          t.fired = true;
          t.fn();
        });
    },
  };
}

type Posted = { message: ToShellMessage; targetOrigin: string };
const created: Array<{ posts: Posted[]; allowed: readonly string[]; bridge: EmbedBridge }> = [];

function setup(
  overrides: Partial<EmbedBridgeDeps> = {},
  opts: {
    study?: string;
    onSwitch?: (uid: string) => void;
    /**
     * What an earlier document of the same attempt recorded (the OIDC
     * callback, an F5: the trace resumes from sessionStorage), before this
     * document's bridge is created.
     */
    earlierDocument?: (trace: ReturnType<typeof fakeTrace>) => void;
  } = {}
) {
  const parent = { role: 'parent' };
  const posts: Posted[] = [];
  const trace = fakeTrace(opts.study ?? A);
  opts.earlierDocument?.(trace);
  const scheduler = fakeScheduler();
  const switches: Array<[string, string]> = [];
  const deps: EmbedBridgeDeps = {
    allowedOrigins: ALLOWED,
    framed: true,
    post: (message, targetOrigin) => {
      posts.push({ message, targetOrigin });
    },
    isParent: source => source === parent,
    candidateParentOrigins: () => [SHELL],
    documentId: DOC,
    attempt: trace.view,
    studyRefFor: ref,
    // The document's URL names the study its trace opened.
    routeStudyUid: () => opts.study ?? A,
    documentGateways: () => [GW],
    switchStudy: (uid, gw) => {
      switches.push([uid, gw]);
      opts.onSwitch?.(uid);
    },
    scheduler,
    ...overrides,
  };
  const bridge = createEmbedBridge(deps);
  created.push({ posts, allowed: deps.allowedOrigins, bridge });

  const deliver = (data: unknown, { origin = SHELL, source = parent as unknown } = {}) =>
    bridge.receive({ source, origin, data });
  const shell = {
    hello: (caseGeneration = 1, nonce = NONCE, documentId = DOC) =>
      deliver(buildEmbedMessage('shell.hello', { nonce, caseGeneration, payload: { documentId } })),
    study: (caseGeneration: number, studyInstanceUid: string, gatewayAet = GW, nonce = NONCE) =>
      deliver(
        buildEmbedMessage('shell.study', {
          nonce,
          caseGeneration,
          payload: { studyInstanceUid, gatewayAet },
        })
      ),
    visibility: (state: 'visible' | 'parked', caseGeneration = 1, nonce = NONCE) =>
      deliver(
        buildEmbedMessage('shell.visibility', {
          nonce,
          caseGeneration,
          payload: { state, width: 903, height: 869 },
        })
      ),
  };
  const of = <T extends ToShellMessage['type']>(type: T) =>
    posts
      .map(p => p.message)
      .filter((m): m is Extract<ToShellMessage, { type: T }> => m.type === type);
  return { bridge, parent, posts, trace, scheduler, switches, deliver, shell, of };
}

afterEach(() => {
  // Rules that hold for EVERY post of every bridge in this file.
  for (const { posts, allowed, bridge } of created) {
    const bound = bridge.getState().parentOrigin;
    for (const { message, targetOrigin } of posts) {
      expect(targetOrigin).not.toBe('*');
      expect(allowed).toContain(targetOrigin);
      if (message.type !== 'viewer.hello' && bound) {
        expect(targetOrigin).toBe(bound);
      }
      // What travels is exactly what the shell's parser accepts.
      const wire = JSON.parse(JSON.stringify(message));
      expect(parseEmbedMessage(wire, 'toShell')).toEqual({ ok: true, message: wire });
    }
    bridge.dispose();
  }
  created.length = 0;
});

describe('activation', () => {
  it.each([
    ['not framed', { framed: false }, 'not-framed'],
    ['an empty allow-list', { allowedOrigins: [] }, 'no-allowed-origins'],
    ['a bad document id', { documentId: 'short' }, 'bad-document-id'],
  ])('is inert when %s', (_name, overrides, reason) => {
    const h = setup(overrides as Partial<EmbedBridgeDeps>);
    expect(h.bridge.getState()).toMatchObject({ active: false, inactiveReason: reason, documentId: null });
    expect(h.posts).toEqual([]);
    expect(h.scheduler.timers).toEqual([]);
    expect(h.trace.subscriptions).toBe(0);
    h.shell.hello();
    h.bridge.authRequired();
    const listener = jest.fn();
    h.bridge.onVisibilityChange(listener);
    h.shell.visibility('parked');
    expect(h.posts).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(h.bridge.getState()).toMatchObject({ bound: false, received: {}, dropped: {}, ignored: 0 });
  });

  it('is active when framed with an allow-list, and says hello at once', () => {
    const h = setup();
    expect(h.bridge.getState()).toMatchObject({
      active: true,
      inactiveReason: null,
      documentId: DOC,
      bound: false,
      caseGeneration: 0,
      boundAttemptGeneration: null,
      suspended: false,
      helloPosts: 1,
      allowedOrigins: ALLOWED,
    });
    expect(h.posts).toEqual([
      {
        message: buildEmbedMessage('viewer.hello', { nonce: null, caseGeneration: 0, payload: { documentId: DOC } }),
        targetOrigin: SHELL,
      },
    ]);
    expect(h.trace.subscriptions).toBe(1);
  });
});

describe('hello', () => {
  it('repeats after 0.5, 1, 2, 4, 8, 8, 8 … s, at most 12 posts', () => {
    const h = setup();
    const delays: number[] = [];
    for (let i = 0; i < 20; i++) {
      const pending = h.scheduler.pending();
      if (pending.length === 0) {
        break;
      }
      expect(pending).toHaveLength(1);
      delays.push(pending[0].ms);
      h.scheduler.tick();
    }
    expect(EMBED_HELLO_MAX_POSTS).toBe(12);
    expect(EMBED_HELLO_DELAYS_MS).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000]);
    expect(h.of('viewer.hello')).toHaveLength(12);
    expect(h.bridge.getState().helloPosts).toBe(12);
    expect(h.scheduler.pending()).toEqual([]);
  });

  it('stops once a shell.hello binds', () => {
    const h = setup();
    h.scheduler.tick();
    h.scheduler.tick();
    expect(h.of('viewer.hello')).toHaveLength(3);
    h.shell.hello();
    expect(h.scheduler.pending()).toEqual([]);
    h.scheduler.tick();
    expect(h.of('viewer.hello')).toHaveLength(3);
    expect(h.bridge.getState().helloPosts).toBe(3);
  });

  it('goes to the candidate parent origin when it is allowed, else to each allowed origin', () => {
    const allowedCandidate = setup({ candidateParentOrigins: () => [OTHER_ALLOWED] });
    expect(allowedCandidate.posts.map(p => p.targetOrigin)).toEqual([OTHER_ALLOWED]);

    const foreignCandidate = setup({ candidateParentOrigins: () => ['https://evil.test'] });
    expect(foreignCandidate.posts.map(p => p.targetOrigin)).toEqual(ALLOWED);
    expect(foreignCandidate.bridge.getState().helloPosts).toBe(1);
    expect(foreignCandidate.bridge.getState().sent).toEqual({ 'viewer.hello': 2 });

    const none = setup({ candidateParentOrigins: () => [] });
    expect(none.posts.map(p => p.targetOrigin)).toEqual(ALLOWED);

    const throwing = setup({
      candidateParentOrigins: () => {
        throw new Error('no location');
      },
    });
    expect(throwing.posts.map(p => p.targetOrigin)).toEqual(ALLOWED);
  });
});

describe('inbound', () => {
  it('counts foreign traffic apart, from any source', () => {
    const h = setup();
    h.deliver(null, { source: { other: 1 } });
    h.deliver('ready', { origin: 'https://evil.test' });
    h.deliver({});
    h.deliver({ type: 'oidc-silent-renew', url: 'x' }, { source: { iframe: 1 } });
    h.deliver([]);
    expect(h.bridge.getState()).toMatchObject({ ignored: 5, dropped: {}, received: {}, bound: false });
  });

  it('drops a wrong source, a foreign origin and each parse failure by reason', () => {
    const h = setup();
    const hello = buildEmbedMessage('shell.hello', { nonce: NONCE, caseGeneration: 1, payload: { documentId: DOC } });
    h.deliver(hello, { source: { notTheParent: true } });
    h.deliver(hello, { origin: 'https://evil.test' });
    h.deliver(hello, { origin: 'http://localhost:3001' });
    h.deliver({ ...hello, version: 2 });
    h.deliver({ ...hello, extra: 1 });
    h.deliver({ ...hello, type: 'shell.bogus' });
    h.deliver(buildEmbedMessage('viewer.hello', { nonce: null, caseGeneration: 0, payload: { documentId: DOC } }));
    h.deliver({ ...hello, nonce: 'short' });
    h.deliver({ ...hello, caseGeneration: 0 });
    h.deliver({ ...hello, payload: { documentId: DOC, extra: 1 } });
    expect(h.bridge.getState()).toMatchObject({
      bound: false,
      ignored: 0,
      received: {},
      dropped: {
        'bad-source': 1,
        'bad-origin': 2,
        'wrong-version': 1,
        'bad-envelope': 1,
        'unknown-type': 1,
        'wrong-direction': 1,
        'bad-nonce': 1,
        'bad-generation': 1,
        'bad-payload': 1,
      },
    });
  });

  it('drops case messages before any shell.hello (not-bound)', () => {
    const h = setup();
    h.shell.study(1, A);
    h.shell.visibility('parked');
    expect(h.bridge.getState()).toMatchObject({ bound: false, suspended: false, dropped: { 'not-bound': 2 } });
    expect(h.switches).toEqual([]);
  });

  it('drops a hello for another document (unknown-document), bound or not', () => {
    const h = setup();
    h.shell.hello(1, NONCE, 'otherDocABCDEFGHIJKLMNOP');
    expect(h.bridge.getState()).toMatchObject({ bound: false, dropped: { 'unknown-document': 1 } });
    h.shell.hello();
    h.shell.hello(1, NONCE, 'otherDocABCDEFGHIJKLMNOP');
    expect(h.bridge.getState().dropped).toEqual({ 'unknown-document': 2 });
  });

  it('once bound, accepts only the bound parent origin', () => {
    const h = setup();
    h.shell.hello();
    h.deliver(
      buildEmbedMessage('shell.visibility', {
        nonce: NONCE,
        caseGeneration: 1,
        payload: { state: 'parked', width: 1, height: 1 },
      }),
      { origin: OTHER_ALLOWED }
    );
    expect(h.bridge.getState()).toMatchObject({ suspended: false, dropped: { 'bad-origin': 1 } });
  });
});

describe('binding', () => {
  it('binds on shell.hello to the sender origin, nonce and case generation, and never exposes the nonce', () => {
    const h = setup({ candidateParentOrigins: () => [] });
    h.deliver(
      buildEmbedMessage('shell.hello', { nonce: NONCE, caseGeneration: 3, payload: { documentId: DOC } }),
      { origin: OTHER_ALLOWED }
    );
    const state = h.bridge.getState();
    expect(state).toMatchObject({
      bound: true,
      parentOrigin: OTHER_ALLOWED,
      caseGeneration: 3,
      received: { 'shell.hello': 1 },
    });
    expect(JSON.stringify(state)).not.toContain(NONCE);
    expect(Object.keys(state).sort()).toEqual(
      [
        'active',
        'inactiveReason',
        'documentId',
        'bound',
        'parentOrigin',
        'allowedOrigins',
        'caseGeneration',
        'boundAttemptGeneration',
        'suspended',
        'helloPosts',
        'sent',
        'received',
        'dropped',
        'ignored',
        'lastReady',
        'lastError',
        'pendingErrors',
        'caps',
        'routeTarget',
        'requestedAtGeneration',
        'pendingStudyRef',
        'switchTimeout',
      ].sort()
    );
    // The switch target starts as the document URL's study; nothing switched yet.
    expect(state).toMatchObject({
      caps: ['case-switch'],
      routeTarget: ref(A),
      requestedAtGeneration: 0,
      pendingStudyRef: null,
      switchTimeout: 'off',
    });
  });

  it('takes a re-sent hello with the same nonce as a no-op, and drops another nonce', () => {
    const h = setup();
    h.shell.hello();
    h.shell.hello();
    h.shell.hello(1, OTHER_NONCE);
    expect(h.bridge.getState()).toMatchObject({
      bound: true,
      caseGeneration: 1,
      received: { 'shell.hello': 2 },
      dropped: { 'nonce-mismatch': 1 },
    });
    // The first nonce still rules.
    h.shell.visibility('parked', 1, OTHER_NONCE);
    expect(h.bridge.getState().suspended).toBe(false);
    h.shell.visibility('parked');
    expect(h.bridge.getState().suspended).toBe(true);
    // Each accepted hello is answered with the capabilities, nothing else.
    const after = h.posts.filter(p => p.message.type !== 'viewer.hello');
    expect(after.map(p => p.message.type)).toEqual(['viewer.caps', 'viewer.caps']);
  });

  it('drops a message from an older case generation (stale-generation)', () => {
    const h = setup();
    h.shell.hello(1);
    h.shell.study(2, A);
    h.shell.hello(1);
    h.shell.visibility('parked', 1);
    h.shell.study(1, A);
    expect(h.bridge.getState()).toMatchObject({
      caseGeneration: 2,
      suspended: false,
      dropped: { 'stale-generation': 3 },
    });
  });
});

describe('viewer.ready', () => {
  it('reports a render that happened before the handshake, at binding time', () => {
    const h = setup();
    h.trace.mark('first_pixels');
    h.trace.mark(RENDER);
    h.shell.hello();
    expect(h.of('viewer.ready')).toEqual([]); // no study bound yet
    h.shell.study(1, A);
    expect(h.bridge.getState().boundAttemptGeneration).toBe(1);
    expect(h.of('viewer.ready')).toEqual([
      buildEmbedMessage('viewer.ready', {
        nonce: NONCE,
        caseGeneration: 1,
        payload: {
          documentId: DOC,
          attemptId: 'att-3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f',
          attemptGeneration: 1,
          shown: true,
        },
      }),
    ]);
    expect(h.bridge.getState().lastReady).toEqual({
      caseGeneration: 1,
      attemptId: 'att-3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f',
      attemptGeneration: 1,
      shown: true,
    });
  });

  it('reports a later render once per case generation, shown only when not parked', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.visibility('parked');
    h.trace.mark('first_pixels');
    expect(h.of('viewer.ready')).toEqual([]);
    h.trace.mark(RENDER);
    h.trace.mark(RENDER);
    const readies = h.of('viewer.ready');
    expect(readies).toHaveLength(1);
    expect(readies[0]).toMatchObject({ caseGeneration: 1, payload: { attemptGeneration: 1, shown: false } });
  });

  it('never comes from snapshot().complete or another stage, only the matching render', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    ['launch', 'auth_ready', 'config_ready', 'runtime_ready', 'engine_created', 'container_sized', 'metadata_loaded', 'first_pixels', 'tools_ready'].forEach(
      stage => h.trace.mark(stage)
    );
    expect(h.of('viewer.ready')).toEqual([]);
  });

  it('keeps an odd launcher attempt id postable', () => {
    const trace = fakeTrace(A, 'att 1/odd');
    const h = setup({ attempt: trace.view });
    h.shell.hello();
    h.shell.study(1, A);
    trace.mark(RENDER);
    expect(h.of('viewer.ready')[0]).toMatchObject({ payload: { attemptId: 'att_1_odd' } });
  });
});

describe('a study switch inside the document (V04)', () => {
  it('never reports the old study’s late render as the new case’s ready', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.trace.mark('first_pixels'); // A is slow: no matching render yet
    expect(h.bridge.getState().boundAttemptGeneration).toBe(1);

    h.shell.study(2, B);
    expect(h.switches).toEqual([[B, GW]]);
    expect(h.bridge.getState()).toMatchObject({ caseGeneration: 2, boundAttemptGeneration: null });

    // The trace has not begun B yet: A's late render and its mode-exit cancel
    // land in generation 1, which no case generation is bound to any more.
    h.trace.mark(RENDER);
    h.trace.fail('MODE_EXIT_BEFORE_RENDER', 'cancelled');
    expect(h.of('viewer.ready')).toEqual([]);
    expect(h.of('viewer.error')).toEqual([]);

    // The router re-enters the mode: attempt.begin(B) opens generation 2.
    h.trace.begin(B);
    expect(h.trace.generation).toBe(2);
    h.trace.mark('metadata_loaded');
    expect(h.bridge.getState().boundAttemptGeneration).toBe(2);
    // The generation-1 render above is not replayed into generation 2.
    expect(h.of('viewer.ready')).toEqual([]);

    // From here on A's viewport can only add first pixels: the observers mark
    // the matching render against the requested study, which is now B.
    h.trace.mark('first_pixels');
    expect(h.of('viewer.ready')).toEqual([]);

    h.trace.mark(RENDER);
    const readies = h.of('viewer.ready');
    expect(readies).toHaveLength(1);
    expect(readies[0]).toMatchObject({ caseGeneration: 2, payload: { attemptGeneration: 2 } });
    expect(h.of('viewer.error')).toEqual([]);
  });

  it('binds at once when the trace has already begun the new study', () => {
    let trace: ReturnType<typeof fakeTrace>;
    const h = setup({}, { onSwitch: uid => trace.begin(uid) });
    trace = h.trace;
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.study(2, B);
    expect(h.bridge.getState()).toMatchObject({ caseGeneration: 2, boundAttemptGeneration: 2 });
  });

  it('binds a new case generation for the same study to the current attempt generation', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.trace.mark(RENDER);
    h.shell.study(2, A);
    expect(h.switches).toEqual([]);
    expect(h.of('viewer.ready').map(m => m.caseGeneration)).toEqual([1, 2]);
    expect(h.bridge.getState().boundAttemptGeneration).toBe(1);
  });

  it('switches before the attempt has any study, then binds when the trace names it', () => {
    const trace = fakeTrace(A);
    let snapshotNull = true;
    const view = {
      subscribe: trace.view.subscribe,
      snapshot: () => (snapshotNull ? null : trace.view.snapshot()),
    };
    const h = setup({
      attempt: { ...view, requestFreshGeneration: trace.view.requestFreshGeneration },
    });
    h.shell.hello();
    h.shell.study(1, B);
    expect(h.switches).toEqual([[B, GW]]);
    snapshotNull = false;
    trace.begin(B);
    trace.mark(RENDER);
    expect(h.of('viewer.ready')).toHaveLength(1);
    expect(h.of('viewer.ready')[0]).toMatchObject({ caseGeneration: 1, payload: { attemptGeneration: 2 } });
  });

  it('answers a study on another gateway with STUDY_GATEWAY_MISMATCH and nothing else', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, B, 'OTHER_GW');
    expect(h.switches).toEqual([]);
    expect(h.of('viewer.error')).toEqual([
      buildEmbedMessage('viewer.error', {
        nonce: NONCE,
        caseGeneration: 1,
        payload: { documentId: DOC, code: 'STUDY_GATEWAY_MISMATCH', stage: 'launch' },
      }),
    ]);
    h.trace.mark(RENDER); // A renders: not this case's study
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    expect(h.of('viewer.ready')).toEqual([]);
    expect(h.of('viewer.error')).toHaveLength(1);
    expect(h.bridge.getState()).toMatchObject({
      boundAttemptGeneration: null,
      lastError: { caseGeneration: 1, code: 'STUDY_GATEWAY_MISMATCH', stage: 'launch' },
    });
  });

  it('keeps one study per case generation (generation-reuse)', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.study(1, A);
    h.shell.study(1, B);
    h.shell.study(1, A, 'OTHER_GW');
    expect(h.switches).toEqual([]);
    expect(h.bridge.getState()).toMatchObject({
      caseGeneration: 1,
      boundAttemptGeneration: 1,
      received: { 'shell.hello': 1, 'shell.study': 2 },
      dropped: { 'generation-reuse': 2 },
    });
  });
});

describe('viewer.caps (m6-case-switch.md §6)', () => {
  it('answers the binding hello with the capabilities first, at the bound case generation', () => {
    const h = setup();
    h.bridge.authRequired(); // queued until the shell's hello
    h.shell.hello(3);
    const after = h.posts.filter(p => p.message.type !== 'viewer.hello');
    expect(after.map(p => p.message.type)).toEqual(['viewer.caps', 'viewer.error']);
    expect(after[0]).toEqual({
      message: buildEmbedMessage('viewer.caps', {
        nonce: NONCE,
        caseGeneration: 3,
        payload: { documentId: DOC, caps: ['case-switch'] },
      }),
      targetOrigin: SHELL,
    });
    expect(EMBED_VIEWER_CAPS).toEqual(['case-switch']);
  });

  it('answers every accepted re-hello, at the current case generation, and no dropped one', () => {
    const h = setup();
    h.shell.hello(1);
    h.shell.study(2, A);
    h.shell.hello(2); // idempotent: accepted
    h.shell.hello(3); // a hello never moves the case generation: accepted, caps at 2
    h.shell.hello(1); // stale-generation
    h.shell.hello(2, OTHER_NONCE); // nonce-mismatch
    h.shell.hello(2, NONCE, 'otherDocABCDEFGHIJKLMNOP'); // unknown-document
    expect(h.of('viewer.caps').map(m => m.caseGeneration)).toEqual([1, 2, 2]);
    expect(h.bridge.getState()).toMatchObject({
      sent: { 'viewer.caps': 3 },
      dropped: { 'stale-generation': 1, 'nonce-mismatch': 1, 'unknown-document': 1 },
    });
  });

  it('posts nothing before a hello binds, however many hellos go out', () => {
    const h = setup();
    h.scheduler.tick();
    h.scheduler.tick();
    h.shell.study(1, A); // not-bound
    expect(h.of('viewer.caps')).toEqual([]);
  });
});

describe('the switch target (m6-case-switch.md §6)', () => {
  const readyPairs = (h: ReturnType<typeof setup>) =>
    h.of('viewer.ready').map(m => [m.caseGeneration, m.payload.attemptGeneration]);

  it('A → B → A in a booted document: switches back, and binds only a generation begun after it', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    BOOT.forEach(stage => h.trace.mark(stage));
    h.trace.mark(RENDER);
    expect(readyPairs(h)).toEqual([[1, 1]]);

    h.shell.study(2, B); // B's mode entry has not begun B …
    h.shell.study(3, A); // … when the reader goes back to A
    // The switch back is a real switch: the URL is B's, though the trace still names A.
    expect(h.switches).toEqual([
      [B, GW],
      [A, GW],
    ]);
    expect(h.trace.freshRequests).toBe(2);
    expect(h.bridge.getState()).toMatchObject({
      caseGeneration: 3,
      boundAttemptGeneration: null,
      routeTarget: ref(A),
      requestedAtGeneration: 1,
      pendingStudyRef: ref(A),
    });
    // A's generation 1 is not case 3's: neither its replay nor a late render is a ready.
    expect(readyPairs(h)).toEqual([[1, 1]]);
    h.trace.mark(RENDER);
    expect(readyPairs(h)).toEqual([[1, 1]]);

    // The router re-enters the mode for A: a new generation although the study is the same.
    h.trace.begin(A);
    expect(h.trace.generation).toBe(2);
    h.trace.mark('engine_created');
    expect(h.bridge.getState()).toMatchObject({ boundAttemptGeneration: 2, pendingStudyRef: null });
    expect(readyPairs(h)).toEqual([[1, 1]]);
    h.trace.mark(RENDER);
    expect(h.of('viewer.ready')[1]).toEqual(
      buildEmbedMessage('viewer.ready', {
        nonce: NONCE,
        caseGeneration: 3,
        payload: {
          documentId: DOC,
          attemptId: 'att-3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f',
          attemptGeneration: 2,
          shown: true,
        },
      })
    );
    expect(h.of('viewer.error')).toEqual([]);
  });

  it('A → B → A before the boot: the boot’s first mode entry opens the generation case 3 binds', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A); // the trace names the URL's A in generation 1; nothing has booted
    expect(h.bridge.getState().boundAttemptGeneration).toBe(1);
    h.shell.study(2, B);
    h.shell.study(3, A);
    expect(h.switches).toEqual([
      [B, GW],
      [A, GW],
    ]);
    BOOT.forEach(stage => h.trace.mark(stage)); // still generation 1: not case 3's
    expect(h.bridge.getState()).toMatchObject({
      boundAttemptGeneration: null,
      pendingStudyRef: ref(A),
    });
    h.trace.begin(A); // the boot's first mode entry, with the fresh request still pending
    h.trace.mark('engine_created');
    h.trace.mark(RENDER);
    expect(readyPairs(h)).toEqual([[3, 2]]);
  });

  it('binds at once a new case generation for the study the URL and the trace are on (no switch)', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.trace.mark(RENDER);
    h.shell.study(2, A); // the shell never sent another study: generation 1 is still A's
    expect(h.switches).toEqual([]);
    expect(h.trace.freshRequests).toBe(0);
    expect(readyPairs(h)).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('waits when the trace names the target only in the generation the switch was asked at', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.study(2, B);
    h.trace.rename(B); // the trace names B, but still in generation 1
    h.shell.study(3, B); // B is the target: no second switch, and no bind of generation 1
    expect(h.switches).toEqual([[B, GW]]);
    h.trace.mark('first_pixels');
    expect(h.bridge.getState()).toMatchObject({
      caseGeneration: 3,
      boundAttemptGeneration: null,
      pendingStudyRef: ref(B),
    });
    h.trace.begin(B); // the switch's fresh request: generation 2
    h.trace.mark('engine_created');
    expect(h.bridge.getState().boundAttemptGeneration).toBe(2);
  });

  it('B → C → B: switches to a study the trace still names once the URL has moved on', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.study(2, B);
    h.trace.begin(B);
    h.trace.mark(RENDER);
    expect(readyPairs(h)).toEqual([[2, 2]]);
    h.shell.study(3, C); // C's mode entry has not begun C
    h.shell.study(4, B);
    expect(h.switches).toEqual([
      [B, GW],
      [C, GW],
      [B, GW],
    ]);
    expect(h.bridge.getState()).toMatchObject({
      requestedAtGeneration: 2,
      boundAttemptGeneration: null,
    });
    h.trace.mark(RENDER); // B's old generation 2: not case 4's
    expect(readyPairs(h)).toEqual([[2, 2]]);
    h.trace.begin(B);
    h.trace.mark(RENDER);
    expect(readyPairs(h)).toEqual([
      [2, 2],
      [4, 3],
    ]);
  });

  it('leaves the switch target where it was on a gateway mismatch or a refused switch', () => {
    let refuse = false;
    const h = setup(
      {},
      {
        onSwitch: () => {
          if (refuse) {
            throw new Error('SecurityError');
          }
        },
      }
    );
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.study(2, B, 'OTHER_GW');
    expect(h.bridge.getState()).toMatchObject({ routeTarget: ref(A), pendingStudyRef: null });
    h.shell.study(3, A); // still the URL's study, and no switch ever happened: bound at once
    expect(h.bridge.getState().boundAttemptGeneration).toBe(1);
    refuse = true;
    h.shell.study(4, B);
    expect(h.bridge.getState()).toMatchObject({
      routeTarget: ref(A),
      requestedAtGeneration: 0,
      pendingStudyRef: null,
      switchTimeout: 'off',
    });
    expect(h.trace.freshRequests).toBe(0); // the URL never moved
    h.shell.study(5, A);
    expect(h.bridge.getState().boundAttemptGeneration).toBe(1);
    expect(h.of('viewer.error').map(m => [m.caseGeneration, m.payload.code])).toEqual([
      [2, 'STUDY_GATEWAY_MISMATCH'],
      [4, 'STUDY_SWITCH_FAILED'],
    ]);
  });
});

describe('STUDY_SWITCH_TIMEOUT (fake timers)', () => {
  /** The adapter's clock, so jest's fake timers drive it. */
  const windowClock: EmbedScheduler = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const timeouts = (h: ReturnType<typeof setup>) =>
    h.of('viewer.error').filter(m => m.payload.code === 'STUDY_SWITCH_TIMEOUT');

  /** A document booted on A (its runtime is up), bound and rendered as case 1. */
  const booted = () => {
    const h = setup({ scheduler: windowClock });
    h.shell.hello();
    h.shell.study(1, A);
    BOOT.forEach(stage => h.trace.mark(stage));
    h.trace.mark(RENDER);
    return h;
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('is 20 s, and posts once at the switch’s case generation with stage launch', () => {
    expect(STUDY_SWITCH_TIMEOUT_MS).toBe(20000);
    const h = booted();
    h.shell.study(2, B);
    expect(h.bridge.getState().switchTimeout).toBe('armed');
    jest.advanceTimersByTime(19_999);
    expect(timeouts(h)).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(timeouts(h)).toEqual([
      buildEmbedMessage('viewer.error', {
        nonce: NONCE,
        caseGeneration: 2,
        payload: { documentId: DOC, code: 'STUDY_SWITCH_TIMEOUT', stage: 'launch' },
      }),
    ]);
    jest.advanceTimersByTime(60_000);
    expect(timeouts(h)).toHaveLength(1);
    expect(h.bridge.getState()).toMatchObject({
      switchTimeout: 'off',
      lastError: { caseGeneration: 2, code: 'STUDY_SWITCH_TIMEOUT', stage: 'launch' },
    });
  });

  it('counts from this document’s first runtime_ready when the switch came during the boot', () => {
    // An earlier document's runtime_ready (the trace resumes) does not count.
    const h = setup({ scheduler: windowClock }, { earlierDocument: t => t.mark('runtime_ready') });
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.study(2, B);
    expect(h.bridge.getState().switchTimeout).toBe('awaiting-runtime');
    jest.advanceTimersByTime(60_000); // a slow silent sign-in, config and module load
    expect(timeouts(h)).toEqual([]);
    BOOT.forEach(stage => h.trace.mark(stage));
    expect(h.bridge.getState().switchTimeout).toBe('armed');
    jest.advanceTimersByTime(19_999);
    expect(timeouts(h)).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(timeouts(h).map(m => m.caseGeneration)).toEqual([2]);
  });

  it('is not posted when the switch begins at 19.9 s: the deadline binds it, or the event did', () => {
    const h = booted();
    h.shell.study(2, B);
    jest.advanceTimersByTime(19_900);
    h.trace.begin(B); // a mode entry records no event: only the deadline sees it
    jest.advanceTimersByTime(100);
    expect(timeouts(h)).toEqual([]);
    expect(h.bridge.getState()).toMatchObject({
      boundAttemptGeneration: 2,
      pendingStudyRef: null,
      switchTimeout: 'off',
    });
    h.trace.mark(RENDER);
    expect(h.of('viewer.ready').map(m => m.caseGeneration)).toEqual([1, 2]);

    const h2 = booted();
    h2.shell.study(2, B);
    jest.advanceTimersByTime(19_900);
    h2.trace.begin(B);
    h2.trace.mark('engine_created'); // bound on the event: the deadline is cancelled
    expect(h2.bridge.getState()).toMatchObject({ boundAttemptGeneration: 2, switchTimeout: 'off' });
    jest.advanceTimersByTime(60_000);
    expect(timeouts(h2)).toEqual([]);
  });

  it('is re-armed by a newer case generation: a superseded request never fires', () => {
    const h = booted();
    h.shell.study(2, B);
    jest.advanceTimersByTime(10_000);
    h.shell.study(3, C);
    jest.advanceTimersByTime(19_999);
    expect(timeouts(h)).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(timeouts(h).map(m => m.caseGeneration)).toEqual([3]);
  });

  it('is cancelled by an AUTH_* posted in its case generation, and not armed after one', () => {
    const h = booted();
    h.shell.study(2, B);
    jest.advanceTimersByTime(10_000);
    h.bridge.authRequired('AUTH_UNAVAILABLE');
    expect(h.bridge.getState().switchTimeout).toBe('off');
    jest.advanceTimersByTime(60_000);
    expect(h.of('viewer.error').map(m => [m.caseGeneration, m.payload.code])).toEqual([
      [2, 'AUTH_UNAVAILABLE'],
    ]);

    // The session ended before the case's study arrived, in the same generation.
    const h2 = setup({ scheduler: windowClock });
    BOOT.forEach(stage => h2.trace.mark(stage));
    h2.shell.hello(1);
    h2.bridge.authRequired();
    h2.shell.study(1, B);
    expect(h2.switches).toEqual([[B, GW]]);
    expect(h2.bridge.getState().switchTimeout).toBe('off');
    jest.advanceTimersByTime(60_000);
    expect(timeouts(h2)).toEqual([]);
  });

  it('scopes the AUTH_* rule to its case generation: the next switch arms its own', () => {
    const h = booted();
    h.shell.study(2, B);
    h.bridge.authRequired(); // the auth path only: the trace holds nothing to replay at 3
    expect(h.bridge.getState().switchTimeout).toBe('off');
    h.shell.study(3, C);
    expect(h.bridge.getState().switchTimeout).toBe('armed');
    jest.advanceTimersByTime(STUDY_SWITCH_TIMEOUT_MS);
    expect(timeouts(h).map(m => m.caseGeneration)).toEqual([3]);
  });

  it('is not armed when the switch’s replay posts an AUTH_* (a document stopped at boot auth)', () => {
    const h = setup({ scheduler: windowClock });
    h.trace.fail('AUTH_UNAVAILABLE', 'auth_ready'); // index.js records it …
    h.bridge.authRequired('AUTH_UNAVAILABLE'); // … and tells the bridge; nothing boots
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.study(2, B);
    expect(h.bridge.getState().switchTimeout).toBe('off');
    jest.advanceTimersByTime(120_000);
    expect(h.of('viewer.error').map(m => [m.caseGeneration, m.payload.code])).toEqual([
      [1, 'AUTH_UNAVAILABLE'],
      [2, 'AUTH_UNAVAILABLE'],
    ]);
  });

  it('arms nothing for a gateway mismatch or a bind at once', () => {
    const h = booted();
    h.shell.study(2, B, 'OTHER_GW');
    expect(h.bridge.getState().switchTimeout).toBe('off');
    h.shell.study(3, A);
    expect(h.bridge.getState().switchTimeout).toBe('off');
    jest.advanceTimersByTime(60_000);
    expect(timeouts(h)).toEqual([]);
  });
});

describe('failures while a switch is unbound (m6-case-switch.md §6)', () => {
  const errors = (h: ReturnType<typeof setup>) =>
    h.of('viewer.error').map(m => [m.caseGeneration, m.payload.code, m.payload.stage]);

  it('replays this document’s auth code at the new case generation: a document stopped at boot auth answers it', () => {
    const h = setup();
    h.trace.fail('AUTH_REQUIRED', 'auth_ready');
    h.bridge.authRequired();
    h.shell.hello();
    h.shell.study(1, A);
    expect(errors(h)).toEqual([[1, 'AUTH_REQUIRED', 'auth_ready']]);
    h.shell.study(2, B);
    expect(h.of('viewer.error')[1]).toEqual(
      buildEmbedMessage('viewer.error', {
        nonce: NONCE,
        caseGeneration: 2,
        payload: { documentId: DOC, code: 'AUTH_REQUIRED', stage: 'auth_ready' },
      })
    );
    expect(h.bridge.getState()).toMatchObject({
      pendingStudyRef: ref(B),
      boundAttemptGeneration: null,
    });
    // Told again by the auth path: the same error, not sent twice in the generation.
    h.bridge.authRequired();
    expect(errors(h)).toHaveLength(2);
  });

  it('replays boot failures, never an earlier document’s, then answers that the document cannot switch', () => {
    const h = setup({}, { earlierDocument: t => t.fail('AUTH_REQUIRED', 'auth_ready') });
    h.trace.fail('CONFIG_NO_DATASOURCES', 'config_ready'); // no data source: no case opens here
    h.shell.hello();
    h.shell.study(1, B); // a switch before the boot
    expect(errors(h)).toEqual([
      [1, 'CONFIG_NO_DATASOURCES', 'config_ready'],
      [1, 'STUDY_SWITCH_FAILED', 'launch'],
    ]);
    h.shell.study(2, C);
    expect(errors(h)).toEqual([
      [1, 'CONFIG_NO_DATASOURCES', 'config_ready'],
      [1, 'STUDY_SWITCH_FAILED', 'launch'],
      [2, 'CONFIG_NO_DATASOURCES', 'config_ready'],
      [2, 'STUDY_SWITCH_FAILED', 'launch'],
    ]);
  });

  it('forwards this document’s later failures while a switch is unbound, never a mode exit', () => {
    const h = setup({}, { earlierDocument: t => t.fail('AUTH_REQUIRED', 'auth_ready') });
    h.shell.hello();
    h.shell.study(1, B); // a switch before the boot: nothing has failed in this document
    h.shell.study(2, C);
    expect(errors(h)).toEqual([]);
    h.trace.fail('MODE_EXIT_BEFORE_RENDER', 'cancelled'); // never a failure
    h.trace.fail('AUTH_UNAVAILABLE', 'auth_ready');
    expect(errors(h)).toEqual([[2, 'AUTH_UNAVAILABLE', 'auth_ready']]);
    expect(h.bridge.getState()).toMatchObject({ pendingStudyRef: ref(C), switchTimeout: 'off' });
  });

  it('never carries a case failure of the previous study to the new case generation, replayed or live', () => {
    // A pane of A failed and another rendered; then the reader moved on. A's
    // load that settles after the switch is still stamped with A's generation
    // (begin(B) has not run): it is A's, and B must not open on an error card.
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    BOOT.forEach(stage => h.trace.mark(stage));
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    h.trace.mark(RENDER);
    expect(errors(h)).toEqual([[1, 'VIEWPORT_LOAD_FAILED', 'failed']]);
    h.shell.study(2, B);
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    h.trace.fail('WEBGL_CONTEXT_LOST_OFFSCREEN');
    h.trace.fail('ENGINE_CONSTRUCT_FAILED', 'engine_created');
    expect(errors(h)).toEqual([[1, 'VIEWPORT_LOAD_FAILED', 'failed']]);
    h.trace.begin(B);
    h.trace.mark(RENDER);
    expect(h.of('viewer.ready').map(m => m.caseGeneration)).toEqual([1, 2]);
    expect(errors(h)).toHaveLength(1);
  });
});

describe('a document whose boot failed answers a switch at once (STUDY_SWITCH_FAILED)', () => {
  const errors = (h: ReturnType<typeof setup>) =>
    h.of('viewer.error').map(m => [m.caseGeneration, m.payload.code, m.payload.stage]);
  const switchFailed = (caseGeneration: number) =>
    buildEmbedMessage('viewer.error', {
      nonce: NONCE,
      caseGeneration,
      payload: { documentId: DOC, code: 'STUDY_SWITCH_FAILED', stage: 'launch' },
    });
  /** Nothing waits in this document for the case any more: no deadline, no timer. */
  const answered = (h: ReturnType<typeof setup>, caseGeneration: number) => {
    expect(h.bridge.getState()).toMatchObject({
      caseGeneration,
      boundAttemptGeneration: null,
      pendingStudyRef: null,
      switchTimeout: 'off',
      lastError: { caseGeneration, code: 'STUDY_SWITCH_FAILED', stage: 'launch' },
    });
    expect(h.scheduler.pending()).toEqual([]);
  };

  it('init failed before the runtime (APP_INIT_FAILED, no router): answered at the switch, not left awaiting a runtime', () => {
    const h = setup();
    h.trace.mark('auth_ready');
    h.trace.mark('config_ready');
    h.trace.fail('APP_INIT_FAILED'); // App.tsx: appInit rejected, so no Mode route ever mounts
    h.shell.hello();
    h.shell.study(1, A); // the document's own case: the trace's own code, as in slice 1
    expect(errors(h)).toEqual([[1, 'APP_INIT_FAILED', 'failed']]);
    h.shell.study(2, B);
    expect(h.of('viewer.error')[1]).toEqual(switchFailed(2));
    expect(errors(h)).toHaveLength(2);
    answered(h, 2);
    // Told again (a second init failure): the case is answered once.
    h.trace.fail('APP_INIT_FAILED');
    expect(errors(h)).toHaveLength(2);
  });

  it('init failed after the runtime (the modes did not load): answered at the switch, not after 20 s', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    BOOT.forEach(stage => h.trace.mark(stage));
    h.trace.fail('APP_INIT_FAILED');
    h.shell.study(2, B);
    expect(errors(h)).toEqual([
      [1, 'APP_INIT_FAILED', 'failed'],
      [2, 'STUDY_SWITCH_FAILED', 'launch'],
    ]);
    answered(h, 2);
  });

  it('a boot that fails while the switch waits for it is answered when it fails, before or after the runtime', () => {
    // Before the runtime: the switch was waiting for a runtime_ready that will not come.
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.study(2, B);
    expect(h.bridge.getState().switchTimeout).toBe('awaiting-runtime');
    h.trace.mark('auth_ready');
    h.trace.fail('APP_INIT_FAILED');
    expect(h.of('viewer.error')).toEqual([switchFailed(2)]);
    answered(h, 2);

    // After it: the 20 s clock was counting.
    const h2 = setup();
    h2.shell.hello();
    h2.shell.study(1, A);
    BOOT.forEach(stage => h2.trace.mark(stage));
    h2.shell.study(2, B);
    expect(h2.bridge.getState().switchTimeout).toBe('armed');
    h2.trace.fail('APP_INIT_FAILED');
    expect(h2.of('viewer.error')).toEqual([switchFailed(2)]);
    answered(h2, 2);

    // The config came back with no data source: forwarded as itself, then answered.
    const h3 = setup();
    h3.shell.hello();
    h3.shell.study(1, A);
    h3.shell.study(2, B);
    h3.trace.mark('auth_ready');
    h3.trace.fail('CONFIG_NO_DATASOURCES', 'config_ready');
    expect(errors(h3)).toEqual([
      [2, 'CONFIG_NO_DATASOURCES', 'config_ready'],
      [2, 'STUDY_SWITCH_FAILED', 'launch'],
    ]);
    answered(h3, 2);
  });

  it('answers a case once: an init that fails after the deadline fired adds no second switch code', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    BOOT.forEach(stage => h.trace.mark(stage));
    h.shell.study(2, B);
    h.scheduler.tick(); // 20 s: the mode never began B
    expect(errors(h)).toEqual([[2, 'STUDY_SWITCH_TIMEOUT', 'launch']]);
    h.trace.fail('APP_INIT_FAILED'); // the modes' load gave up later still
    expect(errors(h)).toEqual([[2, 'STUDY_SWITCH_TIMEOUT', 'launch']]);
  });

  it('only this document’s boot: never an earlier document’s, a case’s failure after the runtime, or a mode exit', () => {
    // An earlier document of the attempt failed its init; this one boots.
    const earlier = setup({}, { earlierDocument: t => t.fail('APP_INIT_FAILED') });
    earlier.shell.hello();
    earlier.shell.study(1, A);
    earlier.shell.study(2, B);
    expect(earlier.bridge.getState()).toMatchObject({ pendingStudyRef: ref(B), switchTimeout: 'awaiting-runtime' });

    // A's own failures, at stage failed like APP_INIT_FAILED: the case's, not the document's.
    const caseFailures = setup();
    caseFailures.shell.hello();
    caseFailures.shell.study(1, A);
    BOOT.forEach(stage => caseFailures.trace.mark(stage));
    caseFailures.trace.fail('VIEWPORT_LOAD_FAILED');
    caseFailures.trace.fail('WEBGL_CONTEXT_LOST');
    caseFailures.trace.fail('ENGINE_CONSTRUCT_FAILED', 'engine_created');
    caseFailures.shell.study(2, B);
    expect(caseFailures.bridge.getState()).toMatchObject({ pendingStudyRef: ref(B), switchTimeout: 'armed' });
    caseFailures.trace.fail('WEBGL_CONTEXT_LOST_OFFSCREEN'); // A's engine, after the switch
    expect(caseFailures.bridge.getState().switchTimeout).toBe('armed');

    // A mode exit before the runtime is no failure at all.
    const cancelled = setup();
    cancelled.trace.fail('MODE_EXIT_BEFORE_RENDER', 'cancelled');
    cancelled.shell.hello();
    cancelled.shell.study(1, A);
    cancelled.shell.study(2, B);
    expect(cancelled.bridge.getState().switchTimeout).toBe('awaiting-runtime');

    for (const h of [earlier, caseFailures, cancelled]) {
      expect(errors(h).filter(([g]) => g === 2)).toEqual([]);
    }
  });

  it('leaves a sign-in on record to the shell’s card: no remount under a reader who may be signing in', () => {
    const h = setup();
    h.trace.fail('AUTH_UNAVAILABLE', 'auth_ready');
    h.trace.fail('APP_INIT_FAILED');
    h.shell.hello();
    h.shell.study(1, A);
    h.shell.study(2, B);
    expect(errors(h)).toEqual([
      [1, 'AUTH_UNAVAILABLE', 'auth_ready'],
      [1, 'APP_INIT_FAILED', 'failed'],
      [2, 'AUTH_UNAVAILABLE', 'auth_ready'],
    ]);
    expect(h.bridge.getState().switchTimeout).toBe('off');
  });
});

describe('viewer.error', () => {
  it('queues AUTH_REQUIRED until the shell binds, then sends it once with the bound case generation', () => {
    const h = setup();
    h.trace.fail('AUTH_REQUIRED', 'auth_ready'); // preInitSignIn records it …
    h.bridge.authRequired(); // … and tells the bridge
    h.bridge.authRequired();
    expect(h.of('viewer.error')).toEqual([]);
    expect(h.bridge.getState().pendingErrors).toEqual([{ code: 'AUTH_REQUIRED', stage: 'auth_ready' }]);

    h.shell.hello(4);
    expect(h.of('viewer.error')).toEqual([
      buildEmbedMessage('viewer.error', {
        nonce: NONCE,
        caseGeneration: 4,
        payload: { documentId: DOC, code: 'AUTH_REQUIRED', stage: 'auth_ready' },
      }),
    ]);
    expect(h.bridge.getState().pendingErrors).toEqual([]);

    // Binding the study replays the trace's own AUTH_REQUIRED: the same error, not sent again.
    h.shell.study(4, A);
    h.bridge.authRequired();
    expect(h.of('viewer.error')).toHaveLength(1);
  });

  it('carries the auth path\'s code: AUTH_UNAVAILABLE queued, deduped, sent once, not again on the replay', () => {
    const h = setup();
    h.trace.fail('AUTH_UNAVAILABLE', 'auth_ready'); // preInitSignIn records it …
    h.bridge.authRequired('AUTH_UNAVAILABLE'); // … and tells the bridge
    h.bridge.authRequired('AUTH_UNAVAILABLE');
    expect(h.of('viewer.error')).toEqual([]);
    expect(h.bridge.getState().pendingErrors).toEqual([{ code: 'AUTH_UNAVAILABLE', stage: 'auth_ready' }]);

    h.shell.hello(2);
    expect(h.of('viewer.error')).toEqual([
      buildEmbedMessage('viewer.error', {
        nonce: NONCE,
        caseGeneration: 2,
        payload: { documentId: DOC, code: 'AUTH_UNAVAILABLE', stage: 'auth_ready' },
      }),
    ]);
    expect(h.bridge.getState()).toMatchObject({
      pendingErrors: [],
      lastError: { caseGeneration: 2, code: 'AUTH_UNAVAILABLE', stage: 'auth_ready' },
    });

    // Binding the study replays the trace's own AUTH_UNAVAILABLE: the same error, not sent again.
    h.shell.study(2, A);
    h.bridge.authRequired('AUTH_UNAVAILABLE');
    expect(h.of('viewer.error')).toHaveLength(1);
    // No code is AUTH_REQUIRED, as before: another error, sent once.
    h.bridge.authRequired();
    h.bridge.authRequired(undefined);
    expect(h.of('viewer.error').map(m => m.payload.code)).toEqual(['AUTH_UNAVAILABLE', 'AUTH_REQUIRED']);
  });

  it('keeps an auth code that breaks the rule postable, as the trace does', () => {
    const h = setup();
    h.shell.hello();
    h.bridge.authRequired('auth unavailable');
    h.bridge.authRequired('A'.repeat(41));
    expect(h.of('viewer.error').map(m => m.payload)).toEqual([
      { documentId: DOC, code: 'UNSPECIFIED_ERROR', stage: 'auth_ready' },
    ]);
  });

  it('sends every failure of the bound attempt generation, once per code and stage until a ready', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.trace.mark(RENDER);
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    h.trace.fail('WEBGL_CONTEXT_LOST');
    h.trace.fail('VIEWPORT_LOAD_FAILED', 'engine_created');
    expect(h.of('viewer.error').map(m => m.payload)).toEqual([
      { documentId: DOC, code: 'VIEWPORT_LOAD_FAILED', stage: 'failed' },
      { documentId: DOC, code: 'WEBGL_CONTEXT_LOST', stage: 'failed' },
      { documentId: DOC, code: 'VIEWPORT_LOAD_FAILED', stage: 'engine_created' },
    ]);

    // Retry viewer recovered: a later matching render is reported again …
    h.trace.mark('retry_requested');
    h.trace.mark(RENDER);
    expect(h.of('viewer.ready')).toHaveLength(2);
    // … and resets the dedupe, so the same failure is sent again.
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    expect(h.of('viewer.error')).toHaveLength(4);
    expect(h.bridge.getState().lastError).toEqual({ caseGeneration: 1, code: 'VIEWPORT_LOAD_FAILED', stage: 'failed' });
  });

  it('reports the recovery a Retry viewer brings, even when another pane was ready before it', () => {
    // Found live (N02-failure): one pane failed, another pane's image made the
    // case ready, and the reader's Retry then recovered the failed pane — with
    // no new viewer.ready, because no error had come since the last one.
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    h.trace.mark(RENDER); // the other pane
    expect(h.of('viewer.ready')).toHaveLength(1);
    h.trace.mark('retry_requested');
    expect(h.of('viewer.ready')).toHaveLength(1);
    h.trace.mark(RENDER); // the retried pane
    expect(h.of('viewer.ready')).toHaveLength(2);
    // A Retry that fails again is reported again, although the code is the same.
    h.trace.mark('retry_requested');
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    expect(h.of('viewer.error')).toHaveLength(2);
  });

  it('replays the bound generation in order at binding time: an error, then the recovery', () => {
    const h = setup();
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    h.trace.mark('retry_requested');
    h.trace.mark(RENDER);
    h.shell.hello();
    h.shell.study(1, A);
    const after = h.posts.filter(p => p.message.type !== 'viewer.hello');
    expect(after.map(p => p.message.type)).toEqual(['viewer.caps', 'viewer.error', 'viewer.ready']);
  });

  it('ignores failures of another attempt generation, and replays those from before the binding', () => {
    const h = setup();
    h.shell.hello();
    h.trace.fail('CONFIG_FAILED', 'config_ready'); // generation 1, no study bound yet: replayed at binding
    expect(h.of('viewer.error')).toEqual([]);
    h.shell.study(1, A);
    expect(h.of('viewer.error').map(m => m.payload.code)).toEqual(['CONFIG_FAILED']);
    // The reader opens another study inside the viewer, which the shell never
    // asked for: the trace's generation 2 is not the bound one.
    h.trace.begin('9.9.9');
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    expect(h.of('viewer.error')).toHaveLength(1);
    expect(h.bridge.getState().boundAttemptGeneration).toBe(1);
  });

  it('does not report a cancelled attempt (a mode exit before the render) as an error, live or replayed', () => {
    const h = setup();
    h.trace.fail('MODE_EXIT_BEFORE_RENDER', 'cancelled'); // before the handshake: replayed at binding
    h.shell.hello();
    h.shell.study(1, A);
    expect(h.of('viewer.error')).toEqual([]);
    h.trace.fail('MODE_EXIT_BEFORE_RENDER', 'cancelled');
    h.trace.fail('SOME_OTHER_CODE', 'cancelled');
    expect(h.of('viewer.error')).toEqual([]);
    expect(h.bridge.getState().lastError).toBeNull();
    // A real failure of the same generation still goes, and a render after it is ready.
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    h.trace.mark(RENDER);
    expect(h.of('viewer.error').map(m => m.payload)).toEqual([
      { documentId: DOC, code: 'VIEWPORT_LOAD_FAILED', stage: 'failed' },
    ]);
    expect(h.of('viewer.ready')).toHaveLength(1);
  });

  it('keeps a failure with an odd code or stage postable', () => {
    const h = setup();
    h.shell.hello();
    h.shell.study(1, A);
    h.trace.emit({ stage: 'rendering', ok: false, error: { code: 'lower case' } });
    h.trace.emit({ stage: 'failed', ok: false });
    expect(h.of('viewer.error').map(m => m.payload)).toEqual([
      { documentId: DOC, code: 'UNSPECIFIED_ERROR', stage: 'failed' },
    ]);
  });

  it('starts a fresh dedupe for a new case generation', () => {
    const h = setup();
    h.shell.hello();
    h.bridge.authRequired();
    h.shell.study(2, A);
    h.bridge.authRequired();
    expect(h.of('viewer.error').map(m => m.caseGeneration)).toEqual([1, 2]);
  });
});

describe('a resumed trace (the same attempt, a later document)', () => {
  it('posts no viewer.ready at the handshake for an earlier document’s render, and one after this document’s own', () => {
    const h = setup({}, {
      earlierDocument: t => {
        ['launch', 'auth_ready', 'config_ready', 'first_pixels', RENDER, 'tools_ready'].forEach(s => t.mark(s));
      },
    });
    h.shell.hello();
    h.shell.study(1, A);
    expect(h.bridge.getState().boundAttemptGeneration).toBe(1);
    expect(h.of('viewer.ready')).toEqual([]);
    h.trace.mark('auth_ready');
    h.trace.mark('first_pixels');
    expect(h.of('viewer.ready')).toEqual([]);
    h.trace.mark(RENDER);
    const readies = h.of('viewer.ready');
    expect(readies).toHaveLength(1);
    expect(readies[0]).toMatchObject({ caseGeneration: 1, payload: { attemptGeneration: 1, shown: true } });
  });

  it('replays this document’s render from before the handshake, never the earlier one’s', () => {
    const h = setup({}, { earlierDocument: t => t.mark(RENDER) });
    h.trace.mark(RENDER); // this document rendered before the shell's hello arrived
    h.shell.hello();
    h.shell.study(1, A);
    expect(h.of('viewer.ready')).toHaveLength(1);
  });

  it('posts no viewer.error from a signed-in document for the earlier document’s AUTH_REQUIRED', () => {
    const h = setup({}, {
      earlierDocument: t => {
        t.mark('launch');
        t.fail('AUTH_REQUIRED', 'auth_ready'); // framed without a user
      },
    });
    h.trace.mark('auth_ready'); // this document has the user
    h.shell.hello();
    h.shell.study(1, A);
    expect(h.of('viewer.error')).toEqual([]);
    expect(h.bridge.getState()).toMatchObject({ lastError: null, pendingErrors: [] });
    h.trace.mark(RENDER);
    expect(h.of('viewer.ready')).toHaveLength(1);
    expect(h.of('viewer.error')).toEqual([]);
  });

  it('still reports this document’s own failures, replayed or live', () => {
    const h = setup({}, { earlierDocument: t => t.fail('AUTH_REQUIRED', 'auth_ready') });
    h.trace.fail('CONFIG_NO_DATASOURCES', 'config_ready');
    h.shell.hello();
    h.shell.study(1, A);
    h.trace.fail('VIEWPORT_LOAD_FAILED');
    expect(h.of('viewer.error').map(m => m.payload.code)).toEqual(['CONFIG_NO_DATASOURCES', 'VIEWPORT_LOAD_FAILED']);
  });
});

describe('shell.visibility', () => {
  it('suspends on parked and resumes on visible, idempotently', () => {
    const h = setup();
    const states: string[] = [];
    h.bridge.onVisibilityChange(s => states.push(s));
    h.shell.hello();
    expect(h.bridge.getState().suspended).toBe(false); // before any visibility
    h.shell.visibility('parked');
    h.shell.visibility('parked');
    expect(h.bridge.getState().suspended).toBe(true);
    h.shell.visibility('visible');
    h.shell.visibility('visible');
    h.shell.visibility('parked');
    expect(states).toEqual(['parked', 'visible', 'parked']);
    expect(h.bridge.getState().received['shell.visibility']).toBe(5);
    const after = h.posts.filter(p => !['viewer.hello', 'viewer.caps'].includes(p.message.type));
    expect(after).toEqual([]);
  });

  it('tells a listener added while parked at once, and stops after unsubscribe', () => {
    const h = setup();
    h.shell.hello();
    h.shell.visibility('parked');
    const late = jest.fn();
    const unsubscribe = h.bridge.onVisibilityChange(late);
    expect(late.mock.calls).toEqual([['parked']]);
    unsubscribe();
    h.shell.visibility('visible');
    expect(late).toHaveBeenCalledTimes(1);

    const whileVisible = jest.fn();
    h.bridge.onVisibilityChange(whileVisible);
    expect(whileVisible).not.toHaveBeenCalled();
  });

  it('survives a listener that throws', () => {
    const h = setup();
    const after = jest.fn();
    h.bridge.onVisibilityChange(() => {
      throw new Error('boom');
    });
    h.bridge.onVisibilityChange(after);
    h.shell.hello();
    h.shell.visibility('parked');
    expect(after).toHaveBeenCalledWith('parked');
  });
});

describe('dispose', () => {
  it('stops the hello, the trace subscription and every inbound rule', () => {
    const h = setup();
    h.bridge.dispose();
    expect(h.scheduler.pending()).toEqual([]);
    expect(h.trace.listening).toBe(0);
    h.shell.hello();
    expect(h.bridge.getState().bound).toBe(false);
  });
});
