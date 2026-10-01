/**
 * The bridge over the REAL attempt recorder (platform/core utils/attempt: the
 * AttemptTrace class behind sessionStorage), across two documents of one
 * attempt: the first renders the study, an F5 loads the second, which resumes
 * the trace. Each document is a fresh module registry, so a fresh recorder;
 * jsdom's sessionStorage is the window's and survives, as a reload's does.
 */
import { createEmbedBridge, type EmbedAttemptView } from './embedBridge';
import { buildEmbedMessage, type ToShellMessage } from './embedProtocol';
import { studyRefFor } from '../../../../platform/core/src/utils/attempt/attemptTrace';
import type { AttemptRecorder } from '../../../../platform/core/src/utils/attempt/attempt';

const SHELL = 'http://localhost:3000';
const DOC = 'docIdABCDEFGHIJKLMNOPQ';
const NONCE = 'nonceABCDEFGHIJKLMNOPq';
const STUDY = '1.2.3.4.5';
const GW = 'GATEWAY_AET_1';
const RENDER = 'image_rendered_matching_study';
/** What one document records after launch, in the order the viewer does. */
const OPEN = [
  'auth_ready',
  'config_ready',
  'runtime_ready',
  'engine_created',
  'container_sized',
  'metadata_loaded',
  'first_pixels',
] as const;

/** A document load: a fresh recorder, resolved as index.js does first thing. */
function loadDocument(): AttemptRecorder {
  let recorder: AttemptRecorder | null = null;
  jest.isolateModules(() => {
    recorder = require('../../../../platform/core/src/utils/attempt/attempt').attempt;
  });
  recorder!.init();
  return recorder!;
}

/** browser.ts's view of the recorder. */
function viewOf(recorder: AttemptRecorder): EmbedAttemptView {
  return {
    subscribe: listener => recorder.subscribe(listener),
    snapshot: () => {
      const trace = recorder.snapshot();
      return trace
        ? { attemptId: trace.attemptId, generation: trace.generation, studyRef: trace.studyRef, events: trace.events }
        : null;
    },
    requestFreshGeneration: () => recorder.requestFreshGeneration(),
  };
}

function bridgeOver(recorder: AttemptRecorder) {
  const parent = { role: 'parent' };
  const posts: ToShellMessage[] = [];
  const switches: string[] = [];
  const bridge = createEmbedBridge({
    allowedOrigins: [SHELL],
    framed: true,
    post: message => {
      posts.push(message);
    },
    isParent: source => source === parent,
    candidateParentOrigins: () => [SHELL],
    documentId: DOC,
    attempt: viewOf(recorder),
    studyRefFor,
    routeStudyUid: () => new URLSearchParams(window.location.search).get('StudyInstanceUIDs'),
    documentGateways: () => [GW],
    // browser.ts's switch, minus the popstate: the URL names the new study.
    switchStudy: uid => {
      switches.push(uid);
      const url = `/viewer?StudyInstanceUIDs=${uid}&gatewayAET=${GW}&attempt=att-f5-test`;
      window.history.replaceState(null, '', url);
    },
    scheduler: { setTimeout: () => null, clearTimeout: () => undefined },
  });
  const deliver = (data: unknown) => bridge.receive({ source: parent, origin: SHELL, data });
  const study = (caseGeneration: number, studyInstanceUid: string) =>
    deliver(
      buildEmbedMessage('shell.study', {
        nonce: NONCE,
        caseGeneration,
        payload: { studyInstanceUid, gatewayAet: GW },
      })
    );
  return {
    bridge,
    switches,
    study,
    of: (type: ToShellMessage['type']) => posts.filter(m => m.type === type),
    handshake: () => {
      deliver(buildEmbedMessage('shell.hello', { nonce: NONCE, caseGeneration: 1, payload: { documentId: DOC } }));
      study(1, STUDY);
    },
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', `/viewer?StudyInstanceUIDs=${STUDY}&gatewayAET=${GW}&attempt=att-f5-test`);
});

describe('the bridge over the real attempt trace, across an F5', () => {
  it('posts no viewer.ready for the first document’s render, and one for the reloaded document’s own', () => {
    const doc1 = loadDocument();
    doc1.begin(STUDY);
    OPEN.forEach(stage => doc1.mark(stage));
    doc1.mark(RENDER);
    doc1.mark('tools_ready');
    expect(doc1.snapshot()!.complete).toBe(true);

    const doc2 = loadDocument();
    expect(doc2.snapshot()!.documentLoads).toBe(2);
    expect(doc2.snapshot()!.events.filter(e => e.stage === RENDER)).toHaveLength(1);
    const h = bridgeOver(doc2);
    h.handshake();
    expect(h.bridge.getState()).toMatchObject({ bound: true, boundAttemptGeneration: 1 });
    expect(h.of('viewer.ready')).toEqual([]);

    // The reloaded document opens the study again; the trace owes it every stage.
    doc2.begin(STUDY);
    OPEN.forEach(stage => expect(doc2.mark(stage)).not.toBeNull());
    expect(h.of('viewer.ready')).toEqual([]);
    expect(doc2.mark(RENDER)).not.toBeNull();
    expect(h.of('viewer.ready')).toEqual([
      buildEmbedMessage('viewer.ready', {
        nonce: NONCE,
        caseGeneration: 1,
        payload: { documentId: DOC, attemptId: 'att-f5-test', attemptGeneration: 1, shown: true },
      }),
    ]);
    expect(h.of('viewer.error')).toEqual([]);
    expect(doc2.snapshot()!.events.filter(e => e.stage === 'launch')).toHaveLength(1);
    h.bridge.dispose();
  });

  it('posts a framed AUTH_UNAVAILABLE once: told before the handshake, recorded by the trace, not again on the replay', () => {
    const doc = loadDocument();
    const h = bridgeOver(doc);
    // index.js's onAuthRequired: the trace records the code, the bridge is told it.
    expect(doc.fail('AUTH_UNAVAILABLE', 'auth_ready')).toMatchObject({ stage: 'auth_ready', ok: false, error: { code: 'AUTH_UNAVAILABLE' } });
    h.bridge.authRequired('AUTH_UNAVAILABLE');
    h.handshake();
    expect(h.of('viewer.error')).toEqual([
      buildEmbedMessage('viewer.error', {
        nonce: NONCE,
        caseGeneration: 1,
        payload: { documentId: DOC, code: 'AUTH_UNAVAILABLE', stage: 'auth_ready' },
      }),
    ]);
    h.bridge.dispose();
  });

  it('posts no viewer.error from a signed-in reload for the first document’s AUTH_REQUIRED', () => {
    const doc1 = loadDocument();
    doc1.fail('AUTH_REQUIRED', 'auth_ready'); // framed without a user: nothing boots

    const doc2 = loadDocument(); // the shell reloads the frame after the top-level sign-in
    const h = bridgeOver(doc2);
    expect(doc2.mark('auth_ready')).not.toBeNull();
    h.handshake();
    expect(h.of('viewer.error')).toEqual([]);
    doc2.begin(STUDY);
    OPEN.slice(1).forEach(stage => doc2.mark(stage));
    doc2.mark(RENDER);
    expect(h.of('viewer.ready')).toHaveLength(1);
    expect(h.of('viewer.error')).toEqual([]);
    h.bridge.dispose();
  });
});

describe('the bridge over the real attempt trace, across an in-document switch back', () => {
  const OTHER = '1.2.3.4.6';
  const pairs = (h: ReturnType<typeof bridgeOver>) =>
    h
      .of('viewer.ready')
      .map(m => [m.caseGeneration, (m.payload as { attemptGeneration: number }).attemptGeneration]);

  it('A → B → A delivered before the frame re-renders: case 3 is ready only from the re-entered mode’s render', () => {
    const doc = loadDocument();
    const h = bridgeOver(doc);
    OPEN.slice(0, 3).forEach(stage => doc.mark(stage)); // the boot: auth, config, runtime
    h.handshake();
    doc.begin([STUDY]); // the first mode entry, with the route's studyInstanceUIDs
    OPEN.slice(3).forEach(stage => doc.mark(stage));
    doc.mark(RENDER);
    expect(pairs(h)).toEqual([[1, 1]]);

    h.study(2, OTHER);
    h.study(3, STUDY); // both before the router re-rendered: B never began
    expect(h.switches).toEqual([OTHER, STUDY]);
    expect(h.bridge.getState()).toMatchObject({ caseGeneration: 3, boundAttemptGeneration: null });
    expect(pairs(h)).toEqual([[1, 1]]);

    // A's mode exits (it had rendered: nothing to cancel), and the router
    // enters the mode again for the URL's A: a new generation, the one case 3 binds.
    doc.cancelIfIncomplete('MODE_EXIT_BEFORE_RENDER');
    expect(doc.begin([STUDY])).toBe(2);
    expect(doc.mark('engine_created')).not.toBeNull();
    expect(h.bridge.getState().boundAttemptGeneration).toBe(2);
    expect(pairs(h)).toEqual([[1, 1]]);
    OPEN.slice(4).forEach(stage => doc.mark(stage));
    expect(doc.mark(RENDER)).not.toBeNull();
    expect(pairs(h)).toEqual([
      [1, 1],
      [3, 2],
    ]);
    expect(h.of('viewer.error')).toEqual([]);
    h.bridge.dispose();
  });
});
