/**
 * The adapter in a document that is not framed (jsdom's default window): the
 * bridge is inert, and the read-only hook still says why.
 */
import type * as BrowserModule from './browser';

const subscribe = jest.fn(() => () => undefined);
let browser: typeof BrowserModule;

beforeAll(() => {
  (window as unknown as { PACSAI_EMBED_ORIGINS: unknown }).PACSAI_EMBED_ORIGINS = ['http://localhost:3000'];
  jest.doMock('@ohif/core', () => ({
    utils: { attempt: { subscribe, snapshot: () => null }, studyRefFor: (uid: string) => `ref:${uid}` },
  }));
  browser = require('./browser');
});

describe('installEmbedBridge in a top-level document', () => {
  it('returns null, listens to nothing, and reports why on the hook', () => {
    const addEventListener = jest.spyOn(window, 'addEventListener');
    expect(browser.isFramed()).toBe(false);
    expect(browser.installEmbedBridge()).toBeNull();
    expect(addEventListener.mock.calls.filter(([type]) => type === 'message')).toEqual([]);
    expect(subscribe).not.toHaveBeenCalled();

    const hook = (window as unknown as { __pacsaiEmbed: { version: number; getState: () => unknown } })
      .__pacsaiEmbed;
    expect(hook.version).toBe(1);
    expect(hook.getState()).toEqual({
      active: false,
      inactiveReason: 'not-framed',
      documentId: null,
      bound: false,
      parentOrigin: null,
      allowedOrigins: ['http://localhost:3000'],
      caseGeneration: 0,
      boundAttemptGeneration: null,
      suspended: false,
      helloPosts: 0,
      sent: {},
      received: {},
      dropped: {},
      ignored: 0,
      lastReady: null,
      lastError: null,
      pendingErrors: [],
    });
    expect(Object.getOwnPropertyDescriptor(window, '__pacsaiEmbed')).toMatchObject({ writable: false });

    expect(browser.installEmbedBridge()).toBeNull();
    expect(browser.getEmbedBridge()).toBeNull();
    addEventListener.mockRestore();
  });

  it('counts a top that refuses to be read as framed', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'top');
    Object.defineProperty(window, 'top', {
      get() {
        throw new Error('SecurityError');
      },
      configurable: true,
    });
    try {
      expect(browser.isFramed()).toBe(true);
    } finally {
      if (original) {
        Object.defineProperty(window, 'top', original);
      }
    }
    expect(browser.isFramed()).toBe(false);
  });
});
