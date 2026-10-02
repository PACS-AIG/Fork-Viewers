/**
 * Rev 11 milestone 6: what the report window's Report mode pauses beyond the
 * thumbnail pool (imagePoolGovernor.ts). The frame is parked off screen at a
 * real size, and a frame on the report window's own origin is not throttled
 * by the browser, so without these a playing clip and every render request
 * keep the GPU busy while the reader dictates.
 *
 * - The render gate: while parked, Cornerstone's RenderingEngine schedules no
 *   animation frame. Its render requests still collect (the engine's own
 *   `_needsRender`), and the return to Images schedules them in one frame, so
 *   what changed while parked is drawn at once and only once.
 * - The cine pause: a clip playing when the frame parks is paused, and a clip
 *   that would start while parked (autoplay as a case loads) does not start.
 *   On the return each resumes, but only while its viewport still shows the
 *   display sets it showed: a case switched while parked never inherits A's
 *   clip.
 *
 * Pure: the browser wiring is installParkedSuspend.ts.
 */

/** The part of Cornerstone's RenderingEngine (2.17.2) the gate needs. */
export interface GatedRenderingEngine {
  /** Schedules one animation frame for the viewports flagged to render. */
  _render(): void;
}

/** The prototype the gate patches: every engine, including one made later. */
export interface RenderingEnginePrototype {
  _render?: (this: GatedRenderingEngine) => void;
  __pacsaiRenderGate?: RenderGate;
}

export interface RenderGate {
  /** False when the engine has no `_render` to gate (a Cornerstone that renamed it). */
  readonly installed: boolean;
  pause(): void;
  /** Ends the pause and schedules what collected, once per engine. */
  resume(): void;
  isPaused(): boolean;
  /** Engines that asked for a frame during the current pause. */
  deferredEngines(): number;
}

/**
 * Gate the prototype's `_render`. Installed once per prototype: a second call
 * returns the first gate.
 */
export function createRenderGate(
  proto: RenderingEnginePrototype,
  getEngines: () => readonly GatedRenderingEngine[]
): RenderGate {
  if (proto.__pacsaiRenderGate) {
    return proto.__pacsaiRenderGate;
  }
  const original = proto._render;
  if (typeof original !== 'function') {
    return {
      installed: false,
      pause: () => undefined,
      resume: () => undefined,
      isPaused: () => false,
      deferredEngines: () => 0,
    };
  }
  let paused = false;
  const deferred = new Set<GatedRenderingEngine>();
  proto._render = function gatedRender(this: GatedRenderingEngine) {
    if (paused) {
      deferred.add(this);
      return;
    }
    return original.call(this);
  };
  const gate: RenderGate = {
    installed: true,
    pause: () => {
      paused = true;
    },
    resume: () => {
      if (!paused) {
        return;
      }
      paused = false;
      deferred.clear();
      // Every live engine, not only the deferred ones: `_render` schedules
      // nothing when no viewport is flagged, and a destroyed engine is not
      // among them.
      let engines: readonly GatedRenderingEngine[] = [];
      try {
        engines = getEngines();
      } catch (_) {
        /* no engine list: nothing to schedule */
      }
      for (const engine of engines) {
        try {
          engine._render();
        } catch (_) {
          /* one engine must not keep the others from drawing */
        }
      }
    },
    isPaused: () => paused,
    deferredEngines: () => deferred.size,
  };
  proto.__pacsaiRenderGate = gate;
  return gate;
}

/** The part of OHIF's CineService the pause needs. */
export interface CineLike {
  getState(): { cines?: Record<string, { isPlaying?: boolean; frameRate?: number } | undefined> } | undefined;
  setCine(arg: { id: string; isPlaying?: boolean; frameRate?: number }): unknown;
  playClip(element: unknown, options?: { viewportId?: string; framesPerSecond?: number }): unknown;
}

/** What a viewport shows (its display sets, as one key), or null when it is gone. */
export type ViewportShows = (viewportId: string) => string | null;

export interface CinePause {
  park(): void;
  show(): void;
  /** The clips waiting for the return, by viewport. */
  waiting(): Array<{ viewportId: string; frameRate: number | undefined }>;
}

/**
 * Pause the cine service's clips while parked. Wraps the service's
 * `playClip` once, so a clip asked for while parked is recorded instead of
 * started, and its viewport's cine state is set back to paused.
 */
export function createCinePause(cine: CineLike, shows: ViewportShows): CinePause {
  let parked = false;
  const waiting = new Map<string, { frameRate: number | undefined; shows: string | null }>();
  const showsSafely = (viewportId: string): string | null => {
    try {
      return shows(viewportId);
    } catch (_) {
      return null;
    }
  };
  const pauseOne = (viewportId: string, frameRate: number | undefined): void => {
    waiting.set(viewportId, { frameRate, shows: showsSafely(viewportId) });
    try {
      cine.setCine({ id: viewportId, isPlaying: false });
    } catch (_) {
      /* the cine state is not mounted yet: nothing is playing */
    }
  };

  const playClip = cine.playClip;
  cine.playClip = function pausablePlayClip(element, options) {
    const viewportId = options?.viewportId;
    if (parked && typeof viewportId === 'string' && viewportId) {
      pauseOne(viewportId, options?.framesPerSecond);
      return undefined;
    }
    return playClip.call(this, element, options);
  };

  const cines = (): Record<string, { isPlaying?: boolean; frameRate?: number } | undefined> => {
    try {
      return cine.getState()?.cines ?? {};
    } catch (_) {
      // The default CineService throws until the provider mounts.
      return {};
    }
  };

  return {
    park: () => {
      if (parked) {
        return;
      }
      parked = true;
      for (const [viewportId, state] of Object.entries(cines())) {
        if (state?.isPlaying === true) {
          pauseOne(viewportId, state.frameRate);
        }
      }
    },
    show: () => {
      if (!parked) {
        return;
      }
      parked = false;
      const now = cines();
      const entries = Array.from(waiting.entries());
      waiting.clear();
      for (const [viewportId, w] of entries) {
        const current = showsSafely(viewportId);
        if (current === null || current !== w.shows || now[viewportId]?.isPlaying === true) {
          continue;
        }
        try {
          cine.setCine({ id: viewportId, isPlaying: true, frameRate: w.frameRate });
        } catch (_) {
          /* the clip stays paused; the reader can press play */
        }
      }
    },
    waiting: () =>
      Array.from(waiting.entries()).map(([viewportId, w]) => ({ viewportId, frameRate: w.frameRate })),
  };
}
