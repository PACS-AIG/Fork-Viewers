import {
  createRenderLog,
  installRenderLogHook,
  RENDER_LOG_CAPACITY,
  RENDER_LOG_KEY,
  RENDER_LOG_VERSION,
} from './renderLog';

describe('createRenderLog', () => {
  it('records each render with its time, generation and deduplicated refs, oldest first', () => {
    const log = createRenderLog();
    log.record({ tMs: 1234.4, generation: 1, studyRefs: ['fnv1a64:aa', 'fnv1a64:aa', 'fnv1a64:bb'], activeRef: 'fnv1a64:aa' });
    log.record({ tMs: 1300.6, generation: 2, studyRefs: ['fnv1a64:bb'], activeRef: 'fnv1a64:bb' });
    log.record({ tMs: 1400, generation: null, studyRefs: [] });
    log.record({ tMs: Number.NaN, studyRefs: [], activeRef: 42 as unknown as string });
    expect(log.entries()).toEqual([
      { tMs: 1234, generation: 1, studyRefs: ['fnv1a64:aa', 'fnv1a64:bb'], activeRef: 'fnv1a64:aa' },
      { tMs: 1301, generation: 2, studyRefs: ['fnv1a64:bb'], activeRef: 'fnv1a64:bb' },
      { tMs: 1400, generation: null, studyRefs: [], activeRef: null },
      { tMs: 0, generation: null, studyRefs: [], activeRef: null },
    ]);
  });

  it('keeps at most 200 entries, dropping the oldest', () => {
    expect(RENDER_LOG_CAPACITY).toBe(200);
    const log = createRenderLog();
    for (let i = 0; i < 250; i++) {
      log.record({ tMs: i, generation: 1, studyRefs: ['r'] });
    }
    const entries = log.entries();
    expect(entries).toHaveLength(200);
    expect(entries[0].tMs).toBe(50);
    expect(entries[199].tMs).toBe(249);
  });

  it('hands out copies: a reader cannot change the log', () => {
    const log = createRenderLog(3);
    const refs = ['r1'];
    log.record({ tMs: 1, generation: 1, studyRefs: refs });
    refs.push('r2');
    const first = log.entries();
    first[0].studyRefs.push('tampered');
    first[0].generation = 99;
    first.pop();
    expect(log.entries()).toEqual([{ tMs: 1, generation: 1, studyRefs: ['r1'], activeRef: null }]);
  });
});

describe('installRenderLogHook', () => {
  it('publishes a frozen, read-only hook once per target', () => {
    const target: Record<string, unknown> = {};
    const log = createRenderLog();
    expect(installRenderLogHook(target, log)).toBe(true);
    const hook = target[RENDER_LOG_KEY] as { version: number; entries: () => unknown[] };
    expect(Object.getOwnPropertyDescriptor(target, RENDER_LOG_KEY)).toMatchObject({
      writable: false,
      configurable: false,
      enumerable: true,
    });
    expect(Object.isFrozen(hook)).toBe(true);
    expect(hook.version).toBe(RENDER_LOG_VERSION);
    expect(RENDER_LOG_VERSION).toBe(1);
    expect(Object.keys(hook).sort()).toEqual(['entries', 'version']);

    log.record({ tMs: 5, generation: 1, studyRefs: ['r'] });
    expect(hook.entries()).toEqual([{ tMs: 5, generation: 1, studyRefs: ['r'], activeRef: null }]);

    // A second install (another module copy) cannot replace it.
    expect(installRenderLogHook(target, createRenderLog())).toBe(false);
    expect(target[RENDER_LOG_KEY]).toBe(hook);
    expect(() => {
      'use strict';
      (target as { [RENDER_LOG_KEY]: unknown })[RENDER_LOG_KEY] = null;
    }).toThrow();
    expect(target[RENDER_LOG_KEY]).toBe(hook);
  });
});
