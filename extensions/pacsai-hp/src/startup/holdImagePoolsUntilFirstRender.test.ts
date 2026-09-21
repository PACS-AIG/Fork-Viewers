import { holdImagePoolsUntilFirstRender, HELD_POOL_TYPES } from './holdImagePoolsUntilFirstRender';

function fakePool(limits: Record<string, number>) {
  const calls: Array<[string, number]> = [];
  let grabs = 0;
  return {
    calls,
    get grabs() {
      return grabs;
    },
    pool: {
      getMaxSimultaneousRequests: (t: string) => limits[t],
      setMaxSimultaneousRequests: (t: string, n: number) => {
        limits[t] = n;
        calls.push([t, n]);
      },
      startGrabbing: () => {
        grabs++;
      },
    },
    limits,
  };
}

function fakeClock() {
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  return {
    timers,
    setTimeout: (fn: () => void, ms: number) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (h: unknown) => {
      (h as { cancelled: boolean }).cancelled = true;
    },
    fire: () => timers.filter(t => !t.cancelled).forEach(t => t.fn()),
  };
}

function fakeSignal() {
  let fire: (() => void) | null = null;
  let unsubscribed = 0;
  return {
    onFirstRender: (listener: () => void) => {
      fire = listener;
      return () => {
        unsubscribed++;
      };
    },
    render: () => fire?.(),
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

describe('holdImagePoolsUntilFirstRender', () => {
  it('holds thumbnail and prefetch at 0, never interaction, and restores the exact limits on first render', () => {
    const { pool, limits, calls } = fakePool({ interaction: 100, thumbnail: 75, prefetch: 25, compute: 10 });
    const clock = fakeClock();
    const signal = fakeSignal();
    const hold = holdImagePoolsUntilFirstRender({ pool, onFirstRender: signal.onFirstRender, ...clock });
    expect(limits).toEqual({ interaction: 100, thumbnail: 0, prefetch: 0, compute: 10 });
    expect(hold.released).toBe(false);
    expect(hold.saved).toEqual({ thumbnail: 75, prefetch: 25 });
    signal.render();
    expect(limits).toEqual({ interaction: 100, thumbnail: 75, prefetch: 25, compute: 10 });
    expect(hold.released).toBe(true);
    expect(hold.reason).toBe('first_render');
    expect(calls.filter(([t]) => t === 'interaction')).toEqual([]);
    expect(HELD_POOL_TYPES).toEqual(['thumbnail', 'prefetch']);
  });

  it('wakes the pool on release (raising a limit alone leaves queued requests asleep)', () => {
    const fp = fakePool({ thumbnail: 5, prefetch: 20 });
    const clock = fakeClock();
    const signal = fakeSignal();
    holdImagePoolsUntilFirstRender({ pool: fp.pool, onFirstRender: signal.onFirstRender, ...clock });
    expect(fp.grabs).toBe(0);
    signal.render();
    expect(fp.grabs).toBe(1);
  });

  it('releases on the timeout when no viewport ever renders, and cancels the timer otherwise', () => {
    const a = fakePool({ thumbnail: 5, prefetch: 20 });
    const clockA = fakeClock();
    const holdA = holdImagePoolsUntilFirstRender({ pool: a.pool, onFirstRender: () => () => undefined, timeoutMs: 8000, ...clockA });
    expect(clockA.timers[0].ms).toBe(8000);
    clockA.fire();
    expect(holdA.released).toBe(true);
    expect(holdA.reason).toBe('timeout');
    expect(a.limits).toEqual({ thumbnail: 5, prefetch: 20 });

    const b = fakePool({ thumbnail: 5, prefetch: 20 });
    const clockB = fakeClock();
    const signal = fakeSignal();
    holdImagePoolsUntilFirstRender({ pool: b.pool, onFirstRender: signal.onFirstRender, ...clockB });
    signal.render();
    expect(clockB.timers[0].cancelled).toBe(true);
    expect(signal.unsubscribed).toBe(1);
  });

  it('is idempotent: a second release changes nothing and does not wake the pool twice', () => {
    const fp = fakePool({ thumbnail: 5, prefetch: 20 });
    const clock = fakeClock();
    const signal = fakeSignal();
    const hold = holdImagePoolsUntilFirstRender({ pool: fp.pool, onFirstRender: signal.onFirstRender, ...clock });
    hold.release('mode_exit');
    signal.render();
    clock.fire();
    expect(fp.grabs).toBe(1);
    expect(hold.reason).toBe('mode_exit');
    expect(fp.calls).toEqual([
      ['thumbnail', 0],
      ['prefetch', 0],
      ['thumbnail', 5],
      ['prefetch', 20],
    ]);
  });

  it('holds nothing when the pools are already at 0 or unknown, and reports itself released', () => {
    const fp = fakePool({ thumbnail: 0 });
    const clock = fakeClock();
    const hold = holdImagePoolsUntilFirstRender({ pool: fp.pool, onFirstRender: () => () => undefined, ...clock });
    expect(hold.released).toBe(true);
    expect(fp.calls).toEqual([]);
    expect(clock.timers).toEqual([]);
  });
});
