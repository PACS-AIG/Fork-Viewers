import { createImagePoolGovernor, holdPoolsWhileParked, PARKED_POOL_TYPES } from './imagePoolGovernor';

function fakePool(limits: Record<string, number | undefined>) {
  const calls: Array<[string, number]> = [];
  let grabs = 0;
  return {
    calls,
    limits,
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
  };
}

const deployed = () => fakePool({ interaction: 100, thumbnail: 75, prefetch: 25, compute: 10 });

describe('createImagePoolGovernor', () => {
  it('holds a pool at 0 and restores its exact limit, waking the pool, on release', () => {
    const fp = deployed();
    const governor = createImagePoolGovernor(fp.pool);
    const release = governor.hold('first_render', ['thumbnail', 'prefetch']);
    expect(fp.limits).toEqual({ interaction: 100, thumbnail: 0, prefetch: 0, compute: 10 });
    expect(governor.isHeld('thumbnail')).toBe(true);
    expect(governor.isHeld('interaction')).toBe(false);
    expect(governor.savedLimit('thumbnail')).toBe(75);
    expect(governor.holds()).toEqual([{ reason: 'first_render', types: ['thumbnail', 'prefetch'] }]);
    expect(fp.grabs).toBe(0);

    release();
    expect(fp.limits).toEqual({ interaction: 100, thumbnail: 75, prefetch: 25, compute: 10 });
    expect(fp.grabs).toBe(1);
    expect(governor.isHeld('thumbnail')).toBe(false);
    expect(governor.savedLimit('thumbnail')).toBeUndefined();
    expect(governor.holds()).toEqual([]);
  });

  it('keeps a pool at 0 while ANY hold covers it, and restores the limit saved at the FIRST hold', () => {
    const fp = deployed();
    const governor = createImagePoolGovernor(fp.pool);
    const releaseFirst = governor.hold('first_render', ['thumbnail', 'prefetch']);
    const releaseParked = governor.hold('parked', ['thumbnail', 'prefetch']);
    expect(governor.holds().map(h => h.reason)).toEqual(['first_render', 'parked']);

    releaseFirst();
    expect(fp.limits.thumbnail).toBe(0);
    expect(fp.limits.prefetch).toBe(0);
    expect(fp.grabs).toBe(0);
    expect(governor.isHeld('thumbnail')).toBe(true);
    expect(governor.holds()).toEqual([{ reason: 'parked', types: ['thumbnail', 'prefetch'] }]);

    releaseParked();
    expect(fp.limits).toEqual({ interaction: 100, thumbnail: 75, prefetch: 25, compute: 10 });
    expect(fp.grabs).toBe(1);
    // The pool was set to 0 once and restored once: the second hold never read the 0 as a limit.
    expect(fp.calls).toEqual([
      ['thumbnail', 0],
      ['prefetch', 0],
      ['thumbnail', 75],
      ['prefetch', 25],
    ]);
  });

  it('keeps the limit from before the FIRST hold even when a held pool was raised meanwhile', () => {
    const fp = deployed();
    const governor = createImagePoolGovernor(fp.pool);
    const releaseFirst = governor.hold('first_render', ['thumbnail']);
    fp.pool.setMaxSimultaneousRequests('thumbnail', 50); // someone else wrote the limit
    const releaseParked = governor.hold('parked', ['thumbnail']);
    expect(fp.limits.thumbnail).toBe(0);
    expect(governor.savedLimit('thumbnail')).toBe(75);
    releaseFirst();
    releaseParked();
    expect(fp.limits.thumbnail).toBe(75);
  });

  it('never re-zeroes a type it left alone at its first hold', () => {
    const fp = fakePool({ thumbnail: 0 });
    const governor = createImagePoolGovernor(fp.pool);
    const releaseFirst = governor.hold('a', ['thumbnail']);
    fp.pool.setMaxSimultaneousRequests('thumbnail', 5);
    const releaseSecond = governor.hold('b', ['thumbnail']);
    expect(fp.limits.thumbnail).toBe(5);
    releaseFirst();
    releaseSecond();
    expect(fp.limits.thumbnail).toBe(5);
  });

  it('restores each type when the last hold covering IT goes, whatever the others hold', () => {
    const fp = deployed();
    const governor = createImagePoolGovernor(fp.pool);
    const releaseThumbs = governor.hold('a', ['thumbnail']);
    const releaseBoth = governor.hold('b', ['thumbnail', 'prefetch']);
    releaseBoth();
    expect(fp.limits).toMatchObject({ thumbnail: 0, prefetch: 25 });
    expect(fp.grabs).toBe(1);
    releaseThumbs();
    expect(fp.limits).toMatchObject({ thumbnail: 75, prefetch: 25 });
    expect(fp.grabs).toBe(2);
  });

  it('has an idempotent release', () => {
    const fp = deployed();
    const governor = createImagePoolGovernor(fp.pool);
    const releaseFirst = governor.hold('first_render', ['thumbnail']);
    const releaseParked = governor.hold('parked', ['thumbnail']);
    releaseFirst();
    releaseFirst(); // must not count as the parked hold's release
    expect(fp.limits.thumbnail).toBe(0);
    expect(governor.holds().map(h => h.reason)).toEqual(['parked']);
    releaseParked();
    releaseParked();
    expect(fp.limits.thumbnail).toBe(75);
    expect(fp.grabs).toBe(1);
  });

  it('leaves a type that was at 0 or unknown at its first hold as it was, and does not wake for it', () => {
    const fp = fakePool({ thumbnail: 0 });
    const governor = createImagePoolGovernor(fp.pool);
    const release = governor.hold('first_render', ['thumbnail', 'prefetch']);
    expect(governor.isHeld('thumbnail')).toBe(true);
    expect(governor.savedLimit('thumbnail')).toBeUndefined();
    expect(governor.savedLimit('prefetch')).toBeUndefined();
    release();
    expect(fp.calls).toEqual([]);
    expect(fp.limits).toEqual({ thumbnail: 0 });
    expect(fp.grabs).toBe(0);
  });

  it('counts a type named twice in one hold once', () => {
    const fp = deployed();
    const governor = createImagePoolGovernor(fp.pool);
    const release = governor.hold('x', ['thumbnail', 'thumbnail']);
    expect(governor.holds()).toEqual([{ reason: 'x', types: ['thumbnail'] }]);
    release();
    expect(fp.limits.thumbnail).toBe(75);
    expect(governor.isHeld('thumbnail')).toBe(false);
  });

  it('survives a pool whose wake-up throws or is missing', () => {
    const limits: Record<string, number> = { thumbnail: 5 };
    const governor = createImagePoolGovernor({
      getMaxSimultaneousRequests: t => limits[t],
      setMaxSimultaneousRequests: (t, n) => {
        limits[t] = n;
      },
      startGrabbing: () => {
        throw new Error('protected');
      },
    });
    expect(() => governor.hold('x', ['thumbnail'])()).not.toThrow();
    expect(limits.thumbnail).toBe(5);

    const bare = createImagePoolGovernor({
      getMaxSimultaneousRequests: t => limits[t],
      setMaxSimultaneousRequests: (t, n) => {
        limits[t] = n;
      },
    });
    expect(() => bare.hold('x', ['thumbnail'])()).not.toThrow();
    expect(limits.thumbnail).toBe(5);
  });
});

describe('holdPoolsWhileParked', () => {
  function visibility() {
    let listener: ((state: 'visible' | 'parked') => void) | null = null;
    let unsubscribed = 0;
    return {
      subscribe: (l: (state: 'visible' | 'parked') => void) => {
        listener = l;
        return () => {
          unsubscribed++;
        };
      },
      set: (state: 'visible' | 'parked') => listener?.(state),
      get unsubscribed() {
        return unsubscribed;
      },
    };
  }

  it('holds only the thumbnail pool while parked, and releases it on visible', () => {
    expect(PARKED_POOL_TYPES).toEqual(['thumbnail']);
    const fp = deployed();
    const governor = createImagePoolGovernor(fp.pool);
    const v = visibility();
    holdPoolsWhileParked(governor, v.subscribe);
    expect(fp.calls).toEqual([]);
    v.set('parked');
    expect(governor.holds()).toEqual([{ reason: 'parked', types: ['thumbnail'] }]);
    // Interaction (the frame's current images) and prefetch (the stack's
    // prefetch, and every volume viewport's streaming: Cornerstone's
    // BaseStreamingImageVolume requests as 'prefetch') keep loading, so a
    // return to Images finds its MPR/3D volumes where they were going.
    expect(fp.limits).toEqual({ interaction: 100, thumbnail: 0, prefetch: 25, compute: 10 });
    expect(governor.isHeld('prefetch')).toBe(false);
    expect(governor.isHeld('interaction')).toBe(false);
    v.set('parked'); // idempotent
    expect(governor.holds()).toHaveLength(1);
    v.set('visible');
    v.set('visible');
    expect(governor.holds()).toEqual([]);
    expect(fp.limits).toEqual({ interaction: 100, thumbnail: 75, prefetch: 25, compute: 10 });
    expect(fp.grabs).toBe(1);
    expect(fp.calls).toEqual([
      ['thumbnail', 0],
      ['thumbnail', 75],
    ]);
  });

  it('cannot restore a pool the first-render hold still holds, nor hold one it does not', () => {
    const fp = deployed();
    const governor = createImagePoolGovernor(fp.pool);
    const v = visibility();
    holdPoolsWhileParked(governor, v.subscribe);
    const releaseFirstRender = governor.hold('first_render', ['thumbnail', 'prefetch']);
    v.set('parked');
    v.set('visible'); // the reader chose Images before the first grid render
    expect(fp.limits).toMatchObject({ thumbnail: 0, prefetch: 0 });
    v.set('parked');
    releaseFirstRender(); // the first grid render while parked: prefetch opens, thumbnails wait
    expect(fp.limits).toMatchObject({ thumbnail: 0, prefetch: 25 });
    v.set('visible');
    expect(fp.limits).toMatchObject({ thumbnail: 75, prefetch: 25 });
  });

  it('unsubscribes and releases a hold in force', () => {
    const fp = deployed();
    const governor = createImagePoolGovernor(fp.pool);
    const v = visibility();
    const stop = holdPoolsWhileParked(governor, v.subscribe);
    v.set('parked');
    stop();
    expect(v.unsubscribed).toBe(1);
    expect(governor.holds()).toEqual([]);
    expect(fp.limits.thumbnail).toBe(75);
  });
});
