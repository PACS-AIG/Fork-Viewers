/**
 * The embed bridge's suspend, in the browser: while the report window parks
 * this frame (its Report mode) the thumbnail pool waits (browserImagePoolGovernor),
 * Cornerstone renders nothing, and clips are paused (parkedSuspend.ts). Once
 * per document; a park that arrived before this ran is replayed to the
 * listener, so a Report-first frame is quiet from its first render request.
 */
import { RenderingEngine, getRenderingEngines } from '@cornerstonejs/core';
import { installParkedPoolHold } from './browserImagePoolGovernor';
import type { EmbedVisibilitySubscribe } from './imagePoolGovernor';
import {
  createCinePause,
  createRenderGate,
  type CineLike,
  type GatedRenderingEngine,
  type RenderingEnginePrototype,
} from './parkedSuspend';

interface SuspendServices {
  cineService?: unknown;
  viewportGridService?: {
    getState?: () => { viewports?: Map<string, { displaySetInstanceUIDs?: readonly string[] }> } | undefined;
  };
}

let installed = false;

const isCineLike = (s: unknown): s is CineLike =>
  !!s &&
  typeof (s as CineLike).getState === 'function' &&
  typeof (s as CineLike).setCine === 'function' &&
  typeof (s as CineLike).playClip === 'function';

export function installParkedSuspend(
  onVisibilityChange: EmbedVisibilitySubscribe,
  services: SuspendServices
): void {
  if (installed) {
    return;
  }
  installed = true;
  installParkedPoolHold(onVisibilityChange);

  const gate = createRenderGate(
    RenderingEngine.prototype as unknown as RenderingEnginePrototype,
    () => getRenderingEngines() as unknown as GatedRenderingEngine[]
  );
  if (!gate.installed) {
    console.warn('[pacsai-hp] RenderingEngine has no _render: the viewer keeps rendering while parked');
  }
  const { cineService, viewportGridService } = services;
  const cine = isCineLike(cineService)
    ? createCinePause(cineService, viewportId => {
        const uids = viewportGridService?.getState?.()?.viewports?.get(viewportId)?.displaySetInstanceUIDs;
        return Array.isArray(uids) && uids.length ? uids.join('\\') : null;
      })
    : null;

  onVisibilityChange(state => {
    if (state === 'parked') {
      cine?.park();
      gate.pause();
    } else {
      gate.resume();
      cine?.show();
    }
  });
}
