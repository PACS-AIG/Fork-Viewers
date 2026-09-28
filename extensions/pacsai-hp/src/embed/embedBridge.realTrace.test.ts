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
  };
}

function bridgeOver(recorder: AttemptRecorder) {
  const parent = { role: 'parent' };
  const posts: ToShellMessage[] = [];
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
    documentGateways: () => [GW],
    switchStudy: () => undefined,
    scheduler: { setTimeout: () => null, clearTimeout: () => undefined },
  });
  const deliver = (data: unknown) => bridge.receive({ source: parent, origin: SHELL, data });
  return {
    bridge,
    of: (type: ToShellMessage['type']) => posts.filter(m => m.type === type),
    handshake: () => {
      deliver(buildEmbedMessage('shell.hello', { nonce: NONCE, caseGeneration: 1, payload: { documentId: DOC } }));
      deliver(
        buildEmbedMessage('shell.study', {
          nonce: NONCE,
          caseGeneration: 1,
          payload: { studyInstanceUid: STUDY, gatewayAet: GW },
        })
      );
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
