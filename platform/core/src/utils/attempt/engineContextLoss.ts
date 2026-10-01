/**
 * The rendering engine's offscreen-canvas context-loss listener (Rev 11
 * milestone 6 part 2, the in-page case switch).
 *
 * Every in-document case switch destroys the rendering engine and builds a new
 * one (the mode's onModeExit calls cornerstoneViewportService.destroy()), and
 * vtk frees a destroyed engine's WebGL context only when its canvas is
 * collected: RenderWindow.delete never calls WEBGL_lose_context. A browser that
 * force-loses an old context once too many are live then fired the old
 * engine's listener, which recorded WEBGL_CONTEXT_LOST_OFFSCREEN into the
 * CURRENT generation, and the embed bridge posted viewer.error for a healthy
 * case. So the listener is pinned to the generation the engine was made in, and
 * removed when the engine is destroyed.
 *
 * Best effort, as observing the engine always was: its internals are not ours.
 */
type EngineLike = {
  offscreenMultiRenderWindow?: {
    getOpenGLRenderWindow?: () => { getCanvas?: () => HTMLCanvasElement | null } | null;
  };
  destroy?: (...args: unknown[]) => unknown;
};

export function watchEngineContextLoss(
  engine: unknown,
  {
    generation,
    onLost,
  }: {
    /** The trace's generation now. */
    generation: () => number;
    /** Record the loss (only for the engine's own generation). */
    onLost: () => void;
  }
): void {
  const e = engine as EngineLike;
  const canvas = e?.offscreenMultiRenderWindow?.getOpenGLRenderWindow?.()?.getCanvas?.();
  if (!canvas?.addEventListener) {
    return;
  }
  const madeIn = generation();
  const listener = () => {
    if (generation() === madeIn) {
      onLost();
    }
  };
  canvas.addEventListener('webglcontextlost', listener);
  // RenderingEngine.destroy is a prototype method: an own property on this
  // instance shadows it for every caller (the viewport service's destroy and
  // resetRenderingEngine both call engine.destroy()).
  const destroy = e.destroy;
  if (typeof destroy !== 'function') {
    return;
  }
  e.destroy = function (this: unknown, ...args: unknown[]) {
    canvas.removeEventListener?.('webglcontextlost', listener);
    return destroy.apply(this, args);
  };
}

export default watchEngineContextLoss;
