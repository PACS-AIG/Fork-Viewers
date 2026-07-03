import { eventTarget, Enums, getEnabledElement, utilities as csUtils } from '@cornerstonejs/core';

/**
 * Momentum (flick) scrolling for stack viewports (PACS AI): a fast run of mouse-wheel
 * detents followed by a pause makes the stack COAST onward with exponential decay —
 * flick-and-coast through the long stacks (all-in-one composites, CTA runoffs,
 * whole-spine) instead of ratcheting the wheel the whole way.
 *
 * Design constraints:
 *  - DISCRETE WHEELS ONLY: pixel-mode deltas under MIN_DETENT_PX (trackpads / smooth
 *    wheels) are ignored — those devices ship their own OS inertia and stacking a
 *    second one overshoots.
 *  - The coast navigates via the SAME call as the scrollbar/minimap (jumpToSlice with
 *    debounceLoading), so the scroll synchronizers treat it as a user scroll — the
 *    synced pane follows and the (non-consuming) echo guards apply.
 *  - Any new input kills the coast instantly: a wheel tick, any pointerdown on the
 *    element, or the element being disabled.
 *  - Stack viewports only (the coast bails unless the viewport has stack index
 *    getters); reaching either end of the stack stops it.
 *
 * Kill switch: window.PACSAI_FLAGS = { disableMomentumScroll: true }.
 * DEBUGGING: window.PACSAI_DEBUG_MOMENTUM = true logs coast start (velocity), stop
 * (reason), and rejected flicks — enough to pinpoint "why didn't/did it coast".
 */

const flags = () => (window as any).PACSAI_FLAGS ?? {};
const verbose = () => (window as any).PACSAI_DEBUG_MOMENTUM === true;

// Tuning
const MIN_DETENT_PX = 50; // pixel-mode |deltaY| below this = smooth device → no momentum
const SAMPLE_WINDOW_MS = 260; // wheel events inside this window define the flick velocity
const IDLE_MS = 90; // wheel silence before the coast starts
const MIN_FLICK_EVENTS = 3; // fewer detents than this is a scroll, not a flick
const MIN_VELOCITY = 6; // slices/sec needed to start coasting
const DECAY_PER_FRAME = 0.93; // exponential decay at 60fps
const STOP_VELOCITY = 1.5; // slices/sec → stop

function initMomentumScroll(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const attached = new WeakSet<HTMLElement>();

  const onEnabled = (evt: any) => {
    const element: HTMLElement = evt.detail?.element;
    if (!element || attached.has(element)) {
      return;
    }
    attached.add(element);

    let detents: Array<{ t: number; dir: number }> = [];
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    let coasting = false;
    let velocity = 0; // slices/sec, signed
    let residual = 0; // fractional slices carried between frames
    let lastFrameT = 0;

    const stopCoast = (reason?: string) => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (coasting && verbose()) {
        console.log('[pacsai-momentum] stop', { reason });
      }
      coasting = false;
      velocity = 0;
      residual = 0;
    };

    // Stack viewports only — the coast needs index getters.
    const stackViewport = (): any => {
      const vp: any = getEnabledElement(element)?.viewport;
      return vp?.getCurrentImageIdIndex && vp?.getImageIds ? vp : undefined;
    };

    const frame = (t: number) => {
      raf = 0;
      const vp = stackViewport();
      if (!vp) {
        return stopCoast('not a stack viewport');
      }
      const dt = lastFrameT ? Math.min(0.1, (t - lastFrameT) / 1000) : 1 / 60;
      lastFrameT = t;
      velocity *= Math.pow(DECAY_PER_FRAME, dt * 60);
      if (Math.abs(velocity) < STOP_VELOCITY) {
        return stopCoast('decayed');
      }
      residual += velocity * dt;
      const steps = Math.trunc(residual);
      if (steps !== 0) {
        residual -= steps;
        const count = vp.getImageIds().length;
        const cur = vp.getCurrentImageIdIndex();
        const next = Math.min(count - 1, Math.max(0, cur + steps));
        if (next === cur) {
          return stopCoast('stack edge');
        }
        csUtils.jumpToSlice(element, { imageIndex: next, debounceLoading: true });
      }
      raf = requestAnimationFrame(frame);
    };

    const startCoast = () => {
      const now = performance.now();
      const recent = detents.filter(d => now - d.t <= SAMPLE_WINDOW_MS);
      detents = [];
      if (recent.length < MIN_FLICK_EVENTS) {
        return;
      }
      const dir = recent[recent.length - 1].dir;
      if (recent.some(d => d.dir !== dir)) {
        if (verbose()) {
          console.log('[pacsai-momentum] no coast (direction change in flick)');
        }
        return;
      }
      const spanMs = Math.max(1, now - recent[0].t);
      const v = (recent.length / spanMs) * 1000 * dir; // 1 detent = 1 slice
      if (Math.abs(v) < MIN_VELOCITY) {
        if (verbose()) {
          console.log('[pacsai-momentum] no coast (too slow)', { v: Math.round(v * 10) / 10 });
        }
        return;
      }
      if (!stackViewport()) {
        return;
      }
      velocity = v;
      residual = 0;
      lastFrameT = 0;
      coasting = true;
      if (verbose()) {
        console.log('[pacsai-momentum] coast', {
          velocity: Math.round(v * 10) / 10,
          detents: recent.length,
        });
      }
      raf = requestAnimationFrame(frame);
    };

    const onWheel = (e: WheelEvent) => {
      if (flags().disableMomentumScroll === true) {
        stopCoast('disabled');
        return;
      }
      // New input always interrupts a running coast (the wheel tick itself scrolls
      // one slice via the stock scroll tool; we only add the after-flick coast).
      stopCoast(coasting ? 'new wheel input' : undefined);
      if (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(e.deltaY) < MIN_DETENT_PX) {
        detents = []; // smooth device — never coast
        return;
      }
      detents.push({ t: performance.now(), dir: Math.sign(e.deltaY) || 1 });
      clearTimeout(idleTimer);
      idleTimer = setTimeout(startCoast, IDLE_MS);
    };

    const onPointerDown = () => stopCoast('pointer input');

    element.addEventListener('wheel', onWheel, { passive: true });
    element.addEventListener('pointerdown', onPointerDown, true);

    const onDisabled = (dEvt: any) => {
      if (dEvt.detail?.element !== element) {
        return;
      }
      stopCoast('element disabled');
      clearTimeout(idleTimer);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown, true);
      attached.delete(element);
      eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, onDisabled);
    };
    eventTarget.addEventListener(Enums.Events.ELEMENT_DISABLED, onDisabled);
  };

  eventTarget.addEventListener(Enums.Events.ELEMENT_ENABLED, onEnabled);
}

export default initMomentumScroll;
