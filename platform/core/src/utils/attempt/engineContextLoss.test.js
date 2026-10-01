/**
 * The offscreen-canvas context-loss listener (Rev 11 milestone 6 part 2): each
 * in-document case switch builds a new rendering engine and leaves the old
 * one's WebGL context to the garbage collector. A loss on an old engine must
 * not fail the current case: the listener is pinned to the generation the
 * engine was made in, and removed when the engine is destroyed. Over a fake
 * engine (a real jsdom canvas), then through the attempt recorder's
 * observeEngine.
 */
import { watchEngineContextLoss } from './engineContextLoss';
import { attempt } from './attempt';

/** A rendering engine as observeEngine reads it: its offscreen canvas and destroy(). */
function fakeEngine() {
  const canvas = document.createElement('canvas');
  const engine = {
    destroyed: 0,
    offscreenMultiRenderWindow: { getOpenGLRenderWindow: () => ({ getCanvas: () => canvas }) },
    destroy() {
      this.destroyed += 1;
    },
  };
  const loseContext = () => canvas.dispatchEvent(new Event('webglcontextlost'));
  return { engine, canvas, loseContext };
}

describe('watchEngineContextLoss', () => {
  it("records a loss in the engine's own generation", () => {
    const now = { generation: 1 };
    const onLost = jest.fn();
    const { engine, loseContext } = fakeEngine();
    watchEngineContextLoss(engine, { generation: () => now.generation, onLost });
    loseContext();
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('records nothing for a loss after the case moved on to a new generation', () => {
    const now = { generation: 1 };
    const onLost = jest.fn();
    const { engine, loseContext } = fakeEngine();
    watchEngineContextLoss(engine, { generation: () => now.generation, onLost });
    now.generation = 2; // an in-document switch; this engine is the previous case's
    loseContext();
    expect(onLost).not.toHaveBeenCalled();
  });

  it('removes the listener when the engine is destroyed, and still destroys it', () => {
    const now = { generation: 1 };
    const onLost = jest.fn();
    const { engine, canvas, loseContext } = fakeEngine();
    const remove = jest.spyOn(canvas, 'removeEventListener');
    watchEngineContextLoss(engine, { generation: () => now.generation, onLost });
    engine.destroy();
    expect(engine.destroyed).toBe(1);
    expect(remove).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
    loseContext(); // same generation: only the removal keeps this silent
    expect(onLost).not.toHaveBeenCalled();
  });

  it('does nothing for an engine without an offscreen canvas (CPU rendering, half-built)', () => {
    const onLost = jest.fn();
    expect(() =>
      watchEngineContextLoss({ destroy() {} }, { generation: () => 1, onLost })
    ).not.toThrow();
    expect(() => watchEngineContextLoss(null, { generation: () => 1, onLost })).not.toThrow();
  });
});

describe('attempt.observeEngine', () => {
  const offscreenLosses = () =>
    attempt
      .snapshot()
      .events.filter(e => e.error?.code === 'WEBGL_CONTEXT_LOST_OFFSCREEN')
      .map(e => e.generation);

  it("fails only the engine's own generation, and not after the engine is destroyed", () => {
    const generationA = attempt.begin('1.2.840.99.501');
    const a = fakeEngine();
    attempt.observeEngine(a.engine);
    a.loseContext();
    expect(offscreenLosses()).toEqual([generationA]);

    const generationB = attempt.begin('1.2.840.99.502'); // the switch to B
    expect(generationB).toBe(generationA + 1);
    a.engine.destroy(); // the mode's exit
    const b = fakeEngine();
    attempt.observeEngine(b.engine);
    a.loseContext(); // the browser reclaims A's old context
    expect(offscreenLosses()).toEqual([generationA]);

    b.loseContext(); // B's own engine
    expect(offscreenLosses()).toEqual([generationA, generationB]);
  });
});
