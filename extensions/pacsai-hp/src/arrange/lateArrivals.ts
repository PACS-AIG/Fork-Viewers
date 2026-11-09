/**
 * Rev 11 milestone 7, PR 3 (B31, N06; docs/12 §4): images that arrive after
 * the reader has started reading do not move the layout under them.
 *
 * Until the reader touches the images, the automatic re-hangs (the prior
 * loader's, as the comparison or the current study's late series arrive, and
 * the all-in-one refresh's) run as before: late metadata may still improve the
 * hanging. Once the reader has scrolled, measured, changed a series or
 * adjusted the presentation, a session interaction latch is set, and an
 * automatic re-hang no longer runs: it is held as the case's update (the
 * latest one kept) and the reading window's header offers it, "New images
 * available · Update layout". While an Arrange preview is open the re-hangs
 * wait too, and one held only for it runs when Arrange closes untouched.
 *
 * Outside the reading window nothing is latched or held: every re-hang runs,
 * as before.
 */

/** What set the latch: input on the images, the rail or a tool, or a layout the reader chose. */
export type LatchReason = 'scroll' | 'images' | 'series' | 'tool' | 'keys' | 'browsing' | 'arrange';

/** A held re-hang brings images that arrived since the layout was hung, or only another layout. */
export type HeldKind = 'images' | 'layout';

export interface HeldUpdate {
  kind: HeldKind;
  /** For a `layout` update that is the reader's preset: its study type's label. */
  label: string | null;
}

export interface LateView {
  latched: boolean;
  held: HeldUpdate | null;
}

/** This case's counts, for the probes: no study data. */
export interface LateCounts {
  enabled: boolean;
  latched: boolean;
  reason: LatchReason | null;
  held: HeldKind | null;
  /** Automatic re-hangs that ran (the viewer untouched, or outside the reading window). */
  ran: number;
  /** Automatic re-hangs held for the reader. */
  holds: number;
  /** Automatic re-hangs held with nothing to offer: no images arrived, the layout on screen kept. */
  drops: number;
  /** Update layout. */
  updates: number;
  /** Held only for an open Arrange, run when it closed untouched. */
  released: number;
  /** The hanging service's protocol or layout changes seen in the reading window. */
  protocolChanges: number;
}

type DisplaySetLike = {
  displaySetInstanceUID?: string;
  isAllInOne?: boolean;
  numImageFrames?: number;
  unsupported?: boolean;
};

type Subscription = { unsubscribe?: () => void } | undefined;

export interface LateServices {
  hangingProtocolService?: {
    subscribe?: (event: string, callback: (...args: unknown[]) => void) => Subscription;
    EVENTS?: Record<string, string>;
  };
  displaySetService?: { getActiveDisplaySets?: () => DisplaySetLike[] };
}

type Listener = () => void;

const listeners = new Set<Listener>();
let enabled = false;
let latch: LatchReason | null = null;
let pending: (HeldUpdate & { run: () => void }) | null = null;
let view: LateView = { latched: false, held: null };
let holding: () => boolean = () => false;
let hungImages: Set<string> | null = null;
const tally = { ran: 0, holds: 0, drops: 0, updates: 0, released: 0, protocolChanges: 0 };

function notify(): void {
  view = {
    latched: latch !== null,
    held: pending ? { kind: pending.kind, label: pending.label } : null,
  };
  listeners.forEach(listener => {
    try {
      listener();
    } catch (_) {
      /* a listener's failure is its own */
    }
  });
}

function holdingNow(): boolean {
  try {
    return holding();
  } catch (_) {
    return false;
  }
}

function runHeld(run: () => void): void {
  try {
    run();
  } catch (error) {
    console.warn('[pacsai-hp] the held layout update failed', error);
  }
}

// ---- the images the layout on screen was hung with ------------------------

/** The display sets that are images: no all-in-one composite, no shell, no frameless set (SR). */
function imageUIDs(sets: ReadonlyArray<DisplaySetLike>): string[] {
  return sets
    .filter(
      ds =>
        !!ds?.displaySetInstanceUID &&
        ds.isAllInOne !== true &&
        ds.unsupported !== true &&
        (ds.numImageFrames ?? 0) > 0
    )
    .map(ds => ds.displaySetInstanceUID as string);
}

/** The hanging service hung the case (or changed its layout) over these display sets. */
export function noteHung(sets: ReadonlyArray<DisplaySetLike>): void {
  hungImages = new Set(imageUIDs(sets));
  tally.protocolChanges++;
}

/**
 * Whether images arrived since the layout on screen was hung: a series that
 * was not loaded then, or that was a shell the hanging could not use. Unknown
 * (no hang seen) counts as arrived.
 */
export function newImagesSinceHang(sets: ReadonlyArray<DisplaySetLike>): boolean {
  if (!hungImages) {
    return true;
  }
  const hung = hungImages;
  return imageUIDs(sets).some(uid => !hung.has(uid));
}

let watching: { service: unknown; off: () => void } | null = null;

function watchHanging(services: LateServices | undefined): void {
  const hps = services?.hangingProtocolService;
  const event = hps?.EVENTS?.PROTOCOL_CHANGED;
  if (!hps?.subscribe || !event || watching?.service === hps) {
    return;
  }
  watching?.off();
  const displaySets = () => {
    try {
      return services?.displaySetService?.getActiveDisplaySets?.() ?? [];
    } catch (_) {
      return [];
    }
  };
  const subscription = hps.subscribe(event, () => noteHung(displaySets()));
  watching = { service: hps, off: () => subscription?.unsubscribe?.() };
}

// ---- the latch ------------------------------------------------------------

/** Never image input: the report, the reading controls, menus, dialogs and fields. */
const NOT_IMAGES = [
  '[data-pacsai-reading-column]',
  '[data-pacsai-reading-island]',
  '[data-cy="pacsai-reading-controls"]',
  '[data-cy="pacsai-late-layout"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');
const VIEWPORTS = '[data-cy="viewport-grid"]';
const RAIL =
  '[data-cy="study-browser-thumbnail"],[data-cy="study-browser-thumbnail-no-image"],[data-cy="thumbnail-list"]';
const TOOLS = '[data-tool]';
/** Keys that only modify, move the focus, close or call the report (F4) or the modes (Alt+1/2/3). */
const NOT_IMAGE_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Hyper',
  'Super',
  'Fn',
  'FnLock',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Tab',
  'Escape',
  'ContextMenu',
  'Unidentified',
  'Dead',
]);

export interface InputLike {
  type: string;
  target: EventTarget | null;
  key?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

function elementOf(target: EventTarget | null): Element | null {
  if (!target) {
    return null;
  }
  const node = target as Node & { closest?: unknown; body?: Element | null };
  if (typeof node.closest === 'function') {
    return node as unknown as Element;
  }
  if (node.nodeType === 9) {
    return node.body ?? null; // the document: keys with nothing focused
  }
  return node.parentElement ?? null;
}

/**
 * Whether an input is the reader working the images (docs/12 §4: scrolled,
 * measured, changed a series or adjusted the presentation), and how: a wheel
 * or a press on the viewports, the series rail or an image tool, a key with
 * nothing but the viewer focused. The report, the reading controls and
 * Arrange, menus, dialogs and fields never count.
 */
export function classifyInteraction(input: InputLike): LatchReason | null {
  const el = elementOf(input.target);
  if (el?.closest(NOT_IMAGES)) {
    return null;
  }
  const inViewports = !!el?.closest(VIEWPORTS);
  switch (input.type) {
    case 'wheel':
      return inViewports ? 'scroll' : null;
    case 'pointerdown':
      if (inViewports) {
        return 'images';
      }
      if (el?.closest(RAIL)) {
        return 'series';
      }
      return el?.closest(TOOLS) ? 'tool' : null;
    case 'dblclick':
    case 'dragstart':
      if (el?.closest(RAIL)) {
        return 'series';
      }
      return inViewports ? 'images' : null;
    case 'drop':
      return inViewports ? 'series' : null;
    case 'keydown': {
      if (input.altKey || input.ctrlKey || input.metaKey) {
        return null;
      }
      const key = input.key ?? '';
      if (!key || NOT_IMAGE_KEYS.has(key) || /^F\d{1,2}$/.test(key)) {
        return null;
      }
      return 'keys';
    }
    default:
      return null;
  }
}

const LATCH_EVENTS = ['pointerdown', 'wheel', 'dblclick', 'dragstart', 'drop', 'keydown'];
let listening = false;

function installLatchListeners(): void {
  if (listening || typeof document === 'undefined') {
    return;
  }
  listening = true;
  const onInput = (event: Event) => {
    if (!enabled || latch) {
      return;
    }
    const reason = classifyInteraction(event as unknown as InputLike);
    if (reason) {
      latchInteraction(reason);
    }
  };
  LATCH_EVENTS.forEach(type =>
    document.addEventListener(type, onInput, { capture: true, passive: true })
  );
}

/**
 * The reader worked the images or chose a layout: from now on in this case an
 * automatic re-hang waits for them. `hung`: the choice re-hung the case over
 * everything loaded (a browsing switch, Use this case, Reset), so an update
 * held before it has nothing left to bring and goes.
 */
export function latchInteraction(
  reason: LatchReason,
  { hung = false }: { hung?: boolean } = {}
): void {
  if (!enabled) {
    return;
  }
  const before = latch;
  latch = latch ?? reason;
  const dropped = hung && pending !== null;
  if (dropped) {
    pending = null;
  }
  if (before !== latch || dropped) {
    notify();
  }
}

/** Whether the reader has worked the images in this case (the reading window only). */
export function interactionLatched(): boolean {
  return enabled && latch !== null;
}

// ---- the case -------------------------------------------------------------

/**
 * A case enters: its latch and update start clear. `on` in the reading window
 * (the dock enabled), where the latch listens and the hanging is watched.
 */
export function lateCaseEntered(on: boolean, services?: LateServices): void {
  enabled = on;
  latch = null;
  pending = null;
  hungImages = null;
  Object.keys(tally).forEach(key => {
    tally[key as keyof typeof tally] = 0;
  });
  if (on) {
    installLatchListeners();
    watchHanging(services);
  }
  notify();
}

/** The reading window's case is left: nothing is latched or held until a case enters again. */
export function lateCaseLeft(): void {
  enabled = false;
  latch = null;
  pending = null;
  hungImages = null;
  notify();
}

/** Another study of the session in focus (focusSessionStudy): its own hang, its own latch. */
export function lateFocusChanged(): void {
  if (latch === null && pending === null) {
    return;
  }
  latch = null;
  pending = null;
  notify();
}

/** While this answers true (an Arrange preview open), automatic re-hangs wait even untouched. */
export function setLateHold(predicate: () => boolean): void {
  holding = predicate;
}

/** Arrange closed: an update held only for it runs now, the reader not having worked the images. */
export function releaseLateHold(): void {
  if (!enabled || latch || !pending || holdingNow()) {
    return;
  }
  const { run } = pending;
  pending = null;
  tally.released++;
  notify();
  runHeld(run);
}

// ---- the gate -------------------------------------------------------------

export interface AutoRehang {
  /** What the re-hang would bring, asked only when it is held; null: nothing to offer. */
  kind: () => HeldUpdate | null;
  run: () => void;
}

/**
 * An automatic re-hang: it runs while the viewer is untouched (and outside the
 * reading window); once the reader has worked the images, or while Arrange
 * holds a preview, it is held as the case's update when it brings something,
 * the latest kept. A held update with nothing to bring goes: the layout on
 * screen stays as the reader has it.
 */
export function holdOrRun({ kind, run }: AutoRehang): 'ran' | 'held' | 'dropped' {
  if (!enabled || (latch === null && !holdingNow())) {
    tally.ran++;
    run();
    return 'ran';
  }
  let brings: HeldUpdate | null = null;
  try {
    brings = kind();
  } catch (_) {
    brings = null;
  }
  if (!brings) {
    tally.drops++;
    return 'dropped';
  }
  // The latest re-hang is kept (it plans from everything loaded); images that
  // arrived for an earlier one are still news.
  const images = pending?.kind === 'images' || brings.kind === 'images';
  pending = {
    kind: images ? 'images' : 'layout',
    label: images ? null : brings.label,
    run,
  };
  tally.holds++;
  notify();
  return 'held';
}

/** Update layout: the held re-hang runs now. False when nothing is held. */
export function updateLayout(): boolean {
  if (!enabled || !pending) {
    return false;
  }
  const { run } = pending;
  pending = null;
  tally.updates++;
  notify();
  runHeld(run);
  return true;
}

// ---- reading it -----------------------------------------------------------

/** The header's view of it (stable between changes). */
export function lateView(): LateView {
  return view;
}

export function subscribeLate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function lateCounts(): LateCounts {
  return {
    enabled,
    latched: latch !== null,
    reason: latch,
    held: pending?.kind ?? null,
    ...tally,
  };
}
