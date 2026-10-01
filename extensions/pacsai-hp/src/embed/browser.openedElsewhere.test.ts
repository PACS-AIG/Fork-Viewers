/**
 * The adapter in a framed document opened on a URL that names no study (the
 * study list, then a study picked in it): the path it was opened on is no Mode
 * route, so a switch keeps the path the document is on. Its own file: the
 * bridge's window properties are read-only, one document per file.
 */
import type * as BrowserModule from './browser';
import { buildEmbedMessage } from './embedProtocol';
import { studyRefFor } from '../../../../platform/core/src/utils/attempt/attemptTrace';

const SHELL = 'http://localhost:3000';
const NONCE = 'nonceABCDEFGHIJKLMNOPq';

const parent = { postMessage: jest.fn() };
let browser: typeof BrowserModule;

function deliver(data: unknown) {
  const event = new Event('message');
  Object.defineProperties(event, {
    data: { value: data },
    origin: { value: SHELL },
    source: { value: parent },
  });
  window.dispatchEvent(event);
}

beforeAll(() => {
  jest.useFakeTimers();
  Object.defineProperty(window, 'self', { value: { notTheTop: true }, configurable: true });
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  (window as unknown as { PACSAI_EMBED_ORIGINS: unknown }).PACSAI_EMBED_ORIGINS = [SHELL];
  window.history.replaceState({ idx: 0, key: 'k1' }, '', '/viewer/?gatewayAET=GW_1&attempt=att-9&attemptT0=1727740800000');
  jest.doMock('@ohif/core', () => ({
    utils: {
      attempt: {
        subscribe: () => () => undefined,
        snapshot: () => ({ attemptId: 'att-9', generation: 1, studyRef: 'none', events: [] }),
        requestFreshGeneration: jest.fn(),
      },
      studyRefFor,
    },
  }));
  browser = require('./browser');
});

afterAll(() => {
  jest.useRealTimers();
});

it('keeps the path the document is on, and the attempt params it was opened with', () => {
  expect(browser.installEmbedBridge()).not.toBeNull();
  const documentId = parent.postMessage.mock.calls[0][0].payload.documentId;
  // The reader picked a study in the list: OHIF's own navigation to the Mode route.
  window.history.pushState({ idx: 1, key: 'k2' }, '', '/viewer/viewer?StudyInstanceUIDs=1.2.3&gatewayAET=GW_1');
  deliver(buildEmbedMessage('shell.hello', { nonce: NONCE, caseGeneration: 1, payload: { documentId } }));
  deliver(
    buildEmbedMessage('shell.study', {
      nonce: NONCE,
      caseGeneration: 1,
      payload: { studyInstanceUid: '1.2.4', gatewayAet: 'GW_1' },
    })
  );
  expect(window.location.pathname).toBe('/viewer/viewer');
  expect([...new URLSearchParams(window.location.search).entries()]).toEqual([
    ['StudyInstanceUIDs', '1.2.4'],
    ['gatewayAET', 'GW_1'],
    ['attempt', 'att-9'],
    ['attemptT0', '1727740800000'],
  ]);
  const state = (window as unknown as { __pacsaiEmbed: { getState: () => Record<string, unknown> } }).__pacsaiEmbed.getState();
  expect(state).toMatchObject({ routeTarget: studyRefFor('1.2.4'), pendingStudyRef: studyRefFor('1.2.4') });
});
