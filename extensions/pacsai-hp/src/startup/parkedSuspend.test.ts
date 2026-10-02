import { createCinePause, createRenderGate, type CineLike } from './parkedSuspend';

/** A stand-in for Cornerstone's RenderingEngine: `_render` schedules a frame when a viewport is flagged. */
function fakeEngineClass() {
  const frames: string[] = [];
  class Engine {
    name: string;
    needsRender = new Set<string>();
    frameSet = false;
    constructor(name: string) {
      this.name = name;
    }
    renderViewport(id: string) {
      this.needsRender.add(id);
      this._render();
    }
    _render() {
      if (this.needsRender.size > 0 && !this.frameSet) {
        this.frameSet = true;
        frames.push(this.name);
      }
    }
    runFrame() {
      this.frameSet = false;
      this.needsRender.clear();
    }
  }
  return { Engine, frames };
}

describe('createRenderGate', () => {
  it('schedules no frame while paused, and one per engine with flagged viewports on resume', () => {
    const { Engine, frames } = fakeEngineClass();
    const a = new Engine('a');
    const b = new Engine('b');
    const idle = new Engine('idle');
    const gate = createRenderGate(Engine.prototype, () => [a, b, idle]);
    expect(gate.installed).toBe(true);

    a.renderViewport('v1');
    expect(frames).toEqual(['a']);
    a.runFrame();

    gate.pause();
    a.renderViewport('v1');
    a.renderViewport('v2');
    b.renderViewport('v3');
    expect(frames).toEqual(['a']);
    expect(gate.deferredEngines()).toBe(2);
    expect(a.needsRender).toEqual(new Set(['v1', 'v2']));

    gate.resume();
    expect(frames).toEqual(['a', 'a', 'b']);
    expect(gate.deferredEngines()).toBe(0);
    expect(gate.isPaused()).toBe(false);
  });

  it('gates an engine made during the pause (a Report-first frame), since the gate is on the prototype', () => {
    const { Engine, frames } = fakeEngineClass();
    const engines: InstanceType<typeof Engine>[] = [];
    const gate = createRenderGate(Engine.prototype, () => engines);
    gate.pause();
    const late = new Engine('late');
    engines.push(late);
    late.renderViewport('v');
    expect(frames).toEqual([]);
    gate.resume();
    expect(frames).toEqual(['late']);
  });

  it('is installed once per prototype, and a resume without a pause schedules nothing', () => {
    const { Engine, frames } = fakeEngineClass();
    const e = new Engine('e');
    const first = createRenderGate(Engine.prototype, () => [e]);
    const second = createRenderGate(Engine.prototype, () => [e]);
    expect(second).toBe(first);
    e.needsRender.add('v');
    first.resume();
    expect(frames).toEqual([]);
  });

  it('degrades to no gate when the engine has no _render', () => {
    const gate = createRenderGate({}, () => []);
    expect(gate.installed).toBe(false);
    gate.pause();
    expect(gate.isPaused()).toBe(false);
  });

  it('keeps drawing the other engines when one throws or the engine list cannot be read', () => {
    const { Engine, frames } = fakeEngineClass();
    const bad = new Engine('bad');
    const good = new Engine('good');
    bad.needsRender.add('x');
    good.needsRender.add('y');
    let listFails = true;
    const gate = createRenderGate(Engine.prototype, () => {
      if (listFails) {
        throw new Error('no list');
      }
      return [bad, good];
    });
    gate.pause();
    gate.resume();
    expect(frames).toEqual([]);
    listFails = false;
    (bad as unknown as { _render: () => void })._render = () => {
      throw new Error('broken engine');
    };
    gate.pause();
    gate.resume();
    expect(frames).toEqual(['good']);
  });
});

/** A stand-in for OHIF's CineService with the provider's state (setCine sets it at once here). */
function fakeCine(initial: Record<string, { isPlaying?: boolean; frameRate?: number }> = {}) {
  const cines: Record<string, { isPlaying?: boolean; frameRate?: number }> = { ...initial };
  const started: Array<{ viewportId?: string; framesPerSecond?: number }> = [];
  const setCalls: Array<{ id: string; isPlaying?: boolean; frameRate?: number }> = [];
  let mounted = true;
  const service: CineLike = {
    getState: () => {
      if (!mounted) {
        throw new TypeError('this.serviceImplementation._getState is not a function');
      }
      return { cines };
    },
    setCine: arg => {
      setCalls.push(arg);
      const c = (cines[arg.id] ??= { isPlaying: false, frameRate: 24 });
      c.isPlaying = arg.isPlaying ?? c.isPlaying;
      c.frameRate = arg.frameRate ?? c.frameRate;
    },
    playClip: (_element, options) => {
      started.push(options ?? {});
      return 'started';
    },
  };
  return {
    service,
    cines,
    started,
    setCalls,
    unmount: () => {
      mounted = false;
    },
    mount: () => {
      mounted = true;
    },
  };
}

describe('createCinePause', () => {
  it('pauses the playing clips on park and resumes them on show while their viewports show the same images', () => {
    const fc = fakeCine({ left: { isPlaying: true, frameRate: 30 }, right: { isPlaying: false, frameRate: 24 } });
    const shows = { left: 'ds-A1', right: 'ds-A2' } as Record<string, string | null>;
    const pause = createCinePause(fc.service, id => shows[id] ?? null);

    pause.park();
    expect(fc.cines.left.isPlaying).toBe(false);
    expect(fc.cines.right.isPlaying).toBe(false);
    expect(pause.waiting()).toEqual([{ viewportId: 'left', frameRate: 30 }]);

    pause.show();
    expect(fc.cines.left).toEqual({ isPlaying: true, frameRate: 30 });
    expect(fc.cines.right.isPlaying).toBe(false);
    expect(pause.waiting()).toEqual([]);
  });

  it('holds a clip asked for while parked (autoplay as a case loads) and starts it on show', () => {
    const fc = fakeCine();
    const pause = createCinePause(fc.service, () => 'ds-B');
    pause.park();
    const r = fc.service.playClip('el', { viewportId: 'v', framesPerSecond: 20 });
    expect(r).toBeUndefined();
    expect(fc.started).toEqual([]);
    expect(fc.cines.v.isPlaying).toBe(false);
    pause.show();
    expect(fc.cines.v).toEqual({ isPlaying: true, frameRate: 20 });
    // Not parked: playClip goes through.
    expect(fc.service.playClip('el', { viewportId: 'v', framesPerSecond: 20 })).toBe('started');
    expect(fc.started).toEqual([{ viewportId: 'v', framesPerSecond: 20 }]);
  });

  it('never resumes A\'s clip on a viewport that shows another case after a switch while parked', () => {
    const fc = fakeCine({ default: { isPlaying: true, frameRate: 24 } });
    const shows: Record<string, string | null> = { default: 'ds-A' };
    const pause = createCinePause(fc.service, id => shows[id] ?? null);
    pause.park();
    shows.default = 'ds-B';
    pause.show();
    expect(fc.cines.default.isPlaying).toBe(false);
  });

  it('does not resume on a viewport that is gone, and does not touch one already playing again', () => {
    const fc = fakeCine({ a: { isPlaying: true }, b: { isPlaying: true } });
    const shows: Record<string, string | null> = { a: 'ds-1', b: 'ds-2' };
    const pause = createCinePause(fc.service, id => shows[id] ?? null);
    pause.park();
    shows.a = null;
    fc.cines.b.isPlaying = true;
    const before = fc.setCalls.length;
    pause.show();
    expect(fc.setCalls.length).toBe(before);
  });

  it('a later clip for the same viewport replaces the one waiting', () => {
    const fc = fakeCine({ v: { isPlaying: true, frameRate: 24 } });
    const shows: Record<string, string | null> = { v: 'ds-A' };
    const pause = createCinePause(fc.service, id => shows[id] ?? null);
    pause.park();
    shows.v = 'ds-B';
    fc.service.playClip('el', { viewportId: 'v', framesPerSecond: 15 });
    pause.show();
    expect(fc.cines.v).toEqual({ isPlaying: true, frameRate: 15 });
  });

  it('parks before the cine provider mounts (the default service throws) without failing', () => {
    const fc = fakeCine();
    fc.unmount();
    const pause = createCinePause(fc.service, () => 'ds');
    expect(() => pause.park()).not.toThrow();
    expect(pause.waiting()).toEqual([]);
    fc.mount();
    expect(() => pause.show()).not.toThrow();
  });

  it('a park or show repeated is a no-op, and a clip without a viewport id is never held', () => {
    const fc = fakeCine({ v: { isPlaying: true } });
    const pause = createCinePause(fc.service, () => 'ds');
    pause.park();
    pause.park();
    expect(pause.waiting()).toEqual([{ viewportId: 'v', frameRate: undefined }]);
    expect(fc.service.playClip('el', {})).toBe('started');
    pause.show();
    pause.show();
    expect(fc.cines.v.isPlaying).toBe(true);
  });
});
