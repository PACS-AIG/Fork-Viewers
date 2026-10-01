/**
 * The adapter in a framed document (jsdom: window.self and window.parent are
 * redefined so this window believes it is a frame). One document per file:
 * the bridge's window properties are read-only and cannot be reset, so the
 * tests below run in order against one install.
 */
import type * as BrowserModule from './browser';
import type { EmbedAttemptEvent } from './embedBridge';
import { buildEmbedMessage, isEmbedId, parseEmbedMessage } from './embedProtocol';
import { studyRefFor } from '../../../../platform/core/src/utils/attempt/attemptTrace';
import {
  clearComparisonRoles,
  setAvailablePriors,
  setComparisonRoles,
  setSessionStudies,
} from '../priors/roleRegistry';

const SHELL = 'http://localhost:3000';
const OTHER_ALLOWED = 'https://app-dev.pacsai.net';
const NONCE = 'nonceABCDEFGHIJKLMNOPq';

const listeners = new Set<(e: EmbedAttemptEvent) => void>();
const trace = { generation: 1, studyRef: studyRefFor('1.2.3'), events: [] as EmbedAttemptEvent[] };
const subscribe = jest.fn((listener: (e: EmbedAttemptEvent) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
});
const requestFreshGeneration = jest.fn();
const fakeAttempt = {
  subscribe,
  snapshot: () => ({
    attemptId: 'att-1',
    generation: trace.generation,
    studyRef: trace.studyRef,
    events: trace.events.slice(),
  }),
  requestFreshGeneration,
};
const mark = (stage: string) => {
  const event = { attemptId: 'att-1', generation: trace.generation, stage, ok: true };
  trace.events.push(event);
  listeners.forEach(l => l(event));
};

const parent = { postMessage: jest.fn() };
const popstates: unknown[] = [];

let browser: typeof BrowserModule;
let documentId = '';

function deliver(data: unknown, origin = SHELL, source: unknown = parent) {
  // MessageEvent refuses a non-Window source; the listener only reads these three.
  const event = new Event('message');
  Object.defineProperties(event, {
    data: { value: data },
    origin: { value: origin },
    source: { value: source },
  });
  window.dispatchEvent(event);
}

const posted = () =>
  parent.postMessage.mock.calls.map(([message, targetOrigin]) => ({ message, targetOrigin }));
const postedOf = (type: string) => posted().filter(p => p.message.type === type);
const hook = () =>
  (window as unknown as { __pacsaiEmbed: { version: number; getState: () => Record<string, unknown> } })
    .__pacsaiEmbed;

beforeAll(() => {
  jest.useFakeTimers();
  Object.defineProperty(window, 'self', { value: { notTheTop: true }, configurable: true });
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  Object.defineProperty(document, 'referrer', { value: `${SHELL}/reports/7?x=1`, configurable: true });
  (window as unknown as { PACSAI_EMBED_ORIGINS: unknown }).PACSAI_EMBED_ORIGINS = [
    'HTTP://LOCALHOST:3000',
    SHELL,
    '*',
    `${OTHER_ALLOWED}/viewer`,
    OTHER_ALLOWED,
  ];
  // A deep link's query: the case's own params, and A's series, protocol,
  // stage and token, which a switch to another study must not carry.
  window.history.replaceState(
    { idx: 0, key: 'k1' },
    '',
    '/viewer/viewer?StudyInstanceUIDs=1.2.3&gatewayAET=GW_1&gatewayAET=GW_3&attempt=att-1' +
      '&attemptT0=1727740800000&attemptCache=cold&SeriesInstanceUIDs=1.2.3.9' +
      '&initialSeriesInstanceUID=1.2.3.9&initialSOPInstanceUID=1.2.3.9.1&hangingProtocolId=hp' +
      '&hangingprotocolid=hp2&stageid=s1&token=t0k3n&studyinstanceuids=1.2.3#frag'
  );
  window.addEventListener('popstate', (event: PopStateEvent) => popstates.push(event.state));
  jest.doMock('@ohif/core', () => ({
    utils: { attempt: fakeAttempt, studyRefFor },
  }));
  browser = require('./browser');
});

afterAll(() => {
  // Every post of this document went to an exact allowed origin, and parses for the shell.
  for (const { message, targetOrigin } of posted()) {
    expect([SHELL, OTHER_ALLOWED]).toContain(targetOrigin);
    expect(parseEmbedMessage(JSON.parse(JSON.stringify(message)), 'toShell').ok).toBe(true);
  }
  jest.useRealTimers();
});

describe('installEmbedBridge in a framed document', () => {
  it('sees the frame and says hello to the referrer origin at once', () => {
    expect(browser.isFramed()).toBe(true);
    const handle = browser.installEmbedBridge();
    expect(handle).not.toBeNull();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(posted()).toHaveLength(1);
    const [{ message, targetOrigin }] = posted();
    expect(targetOrigin).toBe(SHELL);
    expect(message).toMatchObject({ type: 'viewer.hello', nonce: null, caseGeneration: 0 });
    documentId = message.payload.documentId;
    expect(isEmbedId(documentId)).toBe(true);
    expect(documentId).toHaveLength(22);
  });

  it('publishes a read-only hook and a hidden shared instance', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, '__pacsaiEmbed');
    expect(descriptor).toMatchObject({ writable: false, configurable: false });
    expect(Object.isFrozen(hook())).toBe(true);
    expect(hook().version).toBe(1);
    expect(hook().getState()).toMatchObject({
      active: true,
      inactiveReason: null,
      documentId,
      bound: false,
      allowedOrigins: [SHELL, OTHER_ALLOWED],
      helloPosts: 1,
    });
    const instance = Object.getOwnPropertyDescriptor(window, '__pacsaiEmbedBridgeInstance');
    expect(instance).toMatchObject({ enumerable: false, writable: false, configurable: false });
    expect(Object.keys(window)).not.toContain('__pacsaiEmbedBridgeInstance');
  });

  it('is one bridge per document, across calls and module copies', () => {
    const handle = browser.installEmbedBridge();
    expect(browser.installEmbedBridge()).toBe(handle);
    expect(browser.getEmbedBridge()).toBe(handle);
    let copy: typeof BrowserModule | null = null;
    jest.isolateModules(() => {
      copy = require('./browser');
    });
    expect(copy).not.toBeNull();
    expect(copy!.getEmbedBridge()).toBe(handle);
    expect(copy!.installEmbedBridge()).toBe(handle);
    expect(posted()).toHaveLength(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('repeats the hello on the window clock', () => {
    jest.advanceTimersByTime(500);
    expect(postedOf('viewer.hello')).toHaveLength(2);
    jest.advanceTimersByTime(1000);
    expect(postedOf('viewer.hello')).toHaveLength(3);
  });

  it('binds on the parent’s shell.hello, from message events of the window', () => {
    deliver({ protocol: 'oidc' }, 'https://keycloak.test', { silentRenewFrame: true });
    deliver(
      buildEmbedMessage('shell.hello', { nonce: NONCE, caseGeneration: 1, payload: { documentId } }),
      SHELL,
      { notTheParent: true }
    );
    expect(hook().getState()).toMatchObject({ bound: false, ignored: 1, dropped: { 'bad-source': 1 } });
    deliver(buildEmbedMessage('shell.hello', { nonce: NONCE, caseGeneration: 1, payload: { documentId } }));
    const state = hook().getState();
    expect(state).toMatchObject({ bound: true, parentOrigin: SHELL, caseGeneration: 1 });
    expect(JSON.stringify(state)).not.toContain(NONCE);
    jest.advanceTimersByTime(60000);
    expect(postedOf('viewer.hello')).toHaveLength(3);
  });

  it('advertises the in-document case switch after each accepted shell.hello', () => {
    const caps = () =>
      buildEmbedMessage('viewer.caps', {
        nonce: NONCE,
        caseGeneration: 1,
        payload: { documentId, caps: ['case-switch'] },
      });
    expect(postedOf('viewer.caps')).toEqual([{ message: caps(), targetOrigin: SHELL }]);
    // The shell answered a second hello of ours: an idempotent re-hello, answered again.
    const rehello = { nonce: NONCE, caseGeneration: 1, payload: { documentId } };
    deliver(buildEmbedMessage('shell.hello', rehello));
    expect(postedOf('viewer.caps')).toEqual([
      { message: caps(), targetOrigin: SHELL },
      { message: caps(), targetOrigin: SHELL },
    ]);
    expect(hook().getState()).toMatchObject({
      caps: ['case-switch'],
      routeTarget: studyRefFor('1.2.3'),
    });
  });

  it('reports the matching render as ready once the study is bound', () => {
    deliver(
      buildEmbedMessage('shell.study', {
        nonce: NONCE,
        caseGeneration: 1,
        payload: { studyInstanceUid: '1.2.3', gatewayAet: 'GW_1' },
      })
    );
    expect(popstates).toEqual([]);
    mark('image_rendered_matching_study');
    expect(postedOf('viewer.ready')).toEqual([
      {
        message: buildEmbedMessage('viewer.ready', {
          nonce: NONCE,
          caseGeneration: 1,
          payload: { documentId, attemptId: 'att-1', attemptGeneration: 1, shown: true },
        }),
        targetOrigin: SHELL,
      },
    ]);
  });

  it('switches study in the document: the query rebuilt for the case, the router’s state kept, one popstate', () => {
    expect(requestFreshGeneration).not.toHaveBeenCalled();
    deliver(
      buildEmbedMessage('shell.study', {
        nonce: NONCE,
        caseGeneration: 2,
        payload: { studyInstanceUid: '1.2.4', gatewayAet: 'GW_3' },
      })
    );
    expect(window.location.pathname).toBe('/viewer/viewer');
    expect(window.location.hash).toBe('#frag');
    // Only the case's study, the document's gateways and the attempt's own
    // params: A's series, initial image, protocol, stage and token are gone.
    expect([...new URLSearchParams(window.location.search).entries()]).toEqual([
      ['StudyInstanceUIDs', '1.2.4'],
      ['gatewayAET', 'GW_1'],
      ['gatewayAET', 'GW_3'],
      ['attempt', 'att-1'],
      ['attemptT0', '1727740800000'],
    ]);
    expect(window.history.state).toEqual({ idx: 0, key: 'k1' });
    expect(popstates).toEqual([{ idx: 0, key: 'k1' }]);
    // The next mode entry opens a new attempt generation (m6-case-switch.md §6).
    expect(requestFreshGeneration).toHaveBeenCalledTimes(1);
    expect(hook().getState()).toMatchObject({
      caseGeneration: 2,
      boundAttemptGeneration: null,
      routeTarget: studyRefFor('1.2.4'),
      requestedAtGeneration: 1,
      pendingStudyRef: studyRefFor('1.2.4'),
    });

    // The mode re-enters: attempt.begin opens generation 2 for the new study.
    trace.generation = 2;
    trace.studyRef = studyRefFor('1.2.4');
    mark('metadata_loaded');
    expect(hook().getState()).toMatchObject({ boundAttemptGeneration: 2 });
    mark('image_rendered_matching_study');
    expect(postedOf('viewer.ready').map(p => p.message.caseGeneration)).toEqual([1, 2]);
  });

  it('answers another gateway with STUDY_GATEWAY_MISMATCH and leaves the URL alone', () => {
    const before = window.location.href;
    deliver(
      buildEmbedMessage('shell.study', {
        nonce: NONCE,
        caseGeneration: 3,
        payload: { studyInstanceUid: '1.2.5', gatewayAet: 'GW_2' },
      })
    );
    expect(window.location.href).toBe(before);
    expect(postedOf('viewer.error').map(p => p.message.payload)).toEqual([
      { documentId, code: 'STUDY_GATEWAY_MISMATCH', stage: 'launch' },
    ]);
  });

  it('passes the auth paths and the visibility through the handle', () => {
    const handle = browser.getEmbedBridge()!;
    handle.authRequired();
    handle.authRequired('AUTH_UNAVAILABLE');
    expect(postedOf('viewer.error').map(p => p.message.payload)).toEqual([
      { documentId, code: 'STUDY_GATEWAY_MISMATCH', stage: 'launch' },
      { documentId, code: 'AUTH_REQUIRED', stage: 'auth_ready' },
      { documentId, code: 'AUTH_UNAVAILABLE', stage: 'auth_ready' },
    ]);
    const states: string[] = [];
    handle.onVisibilityChange(state => states.push(state));
    deliver(
      buildEmbedMessage('shell.visibility', {
        nonce: NONCE,
        caseGeneration: 3,
        payload: { state: 'parked', width: 903, height: 869 },
      })
    );
    expect(states).toEqual(['parked']);
    expect(handle.getState().suspended).toBe(true);
  });

  it('shows the case on the hook as refs only: display sets, session studies, roles, active study', () => {
    const current = '1.2.4';
    const prior = '1.2.4.1.99';
    const sibling = '1.2.4.2.98';
    const offered = '9.9.9';
    const empty = {
      caseGeneration: 3,
      displaySetStudies: [],
      sessionStudies: [],
      roles: { priors: [], siblings: [], availablePriors: [] },
      activeStudy: null,
    };
    // Before the cornerstone extension published window.services.
    expect(hook().getState().caseView).toEqual(empty);

    const services = window as unknown as { services?: unknown };
    services.services = {
      displaySetService: {
        getActiveDisplaySets: () => [
          { StudyInstanceUID: current },
          { StudyInstanceUID: prior },
          { StudyInstanceUID: current },
          {},
        ],
      },
      hangingProtocolService: { getState: () => ({ activeStudyUID: current }) },
    };
    setSessionStudies([
      { uid: current, label: 'CT HEAD WO' },
      { uid: sibling, label: 'CT CERVICAL SPINE' },
    ]);
    setComparisonRoles({ priors: [prior], siblings: [sibling] });
    setAvailablePriors([
      { uid: prior, qualifying: true },
      { uid: offered, qualifying: false },
    ]);
    expect(hook().getState().caseView).toEqual({
      caseGeneration: 3,
      displaySetStudies: [studyRefFor(current), studyRefFor(prior)].sort(),
      sessionStudies: [studyRefFor(current), studyRefFor(sibling)],
      roles: {
        priors: [studyRefFor(prior)],
        siblings: [studyRefFor(sibling)],
        availablePriors: [studyRefFor(prior), studyRefFor(offered)],
      },
      activeStudy: studyRefFor(current),
    });
    const text = JSON.stringify(hook().getState());
    for (const value of [current, prior, sibling, offered, 'CT HEAD']) {
      expect(text).not.toContain(value);
    }

    // Read lazily, every call: the hanging protocol's study before a protocol
    // is set, and a service that throws, never break the hook.
    services.services = {
      displaySetService: {
        getActiveDisplaySets: () => {
          throw new Error('not ready');
        },
      },
      hangingProtocolService: {
        getState: () => undefined,
        activeStudy: { StudyInstanceUID: prior },
      },
    };
    clearComparisonRoles();
    expect(hook().getState().caseView).toEqual({ ...empty, activeStudy: studyRefFor(prior) });
    delete services.services;
    expect(hook().getState().caseView).toEqual(empty);
  });

  it('re-enters the route it was opened on: a previous case’s not-found page does not keep the next one out', () => {
    // The case's study query came back empty: OHIF navigated to its not-found
    // page (PanelStudyBrowserTracking), a push that drops the query as well.
    window.history.pushState({ idx: 1, key: 'k2' }, '', '/viewer/notfoundstudy');
    const before = popstates.length;
    deliver(
      buildEmbedMessage('shell.study', {
        nonce: NONCE,
        caseGeneration: 4,
        payload: { studyInstanceUid: '1.2.6', gatewayAet: 'GW_1' },
      })
    );
    // The Mode route again, so the mode is entered and begins the new study.
    expect(window.location.pathname).toBe('/viewer/viewer');
    // The attempt's own params, as the document was opened, though the URL lost them.
    expect([...new URLSearchParams(window.location.search).entries()]).toEqual([
      ['StudyInstanceUIDs', '1.2.6'],
      ['gatewayAET', 'GW_1'],
      ['gatewayAET', 'GW_3'],
      ['attempt', 'att-1'],
      ['attemptT0', '1727740800000'],
    ]);
    expect(window.history.state).toEqual({ idx: 1, key: 'k2' });
    expect(popstates.slice(before)).toEqual([{ idx: 1, key: 'k2' }]);
    expect(hook().getState()).toMatchObject({
      caseGeneration: 4,
      routeTarget: studyRefFor('1.2.6'),
      pendingStudyRef: studyRefFor('1.2.6'),
    });
  });
});
