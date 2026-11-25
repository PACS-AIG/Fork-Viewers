/**
 * RS-36: the reading-system pane's place in the document.
 *
 * Runtime switches (the deploy repo's config.js sets them as it sets
 * PACSAI_READING_DOCK; the end-to-end harness serves its own):
 *   - `window.PACSAI_READING_SYSTEM_API`: the base path of the reading
 *     system's API on this origin (on dev, the app's proxy route, which holds
 *     the token). Unset or empty: no pane, nothing is fetched.
 *   - `window.PACSAI_READING_SYSTEM_MODE`: `fixture` to read the system's
 *     fixture mode (local and the gate); anything else reads `clinical`, so a
 *     viewer never shows a fixture document unless told to.
 *   - `window.PACSAI_READING_SYSTEM_POLL_MS`: how often the study's versions
 *     are read again (default 2500 ms, at least 500).
 *
 * The pane lives in the reading dock's report column (WeiWei, 20 Nov 2026:
 * "Inside report column"), so it needs the dock (READING_DOCK); without a
 * dock there is no pane. One controller per document; the pane follows the
 * dock's column (a dock made again after a leave has a column of its own).
 * The harness reads `window.__pacsaiReadingSystem.getState()`, which names
 * the study by reference, never by UID.
 *
 * The study's anatomy layers (anatomy/) follow the pane: they are read once
 * the reading system serves the study (the pane is ready) and drawn on the
 * viewports by one overlay per document, which the dock's services let bring
 * a structure into view.
 */
import { studyRefFor } from '@ohif/core/src/utils/attempt/attemptTrace';
import {
  createAnatomyOverlay,
  type AnatomyOverlay,
  type CornerstoneApi,
  type OverlayServices,
} from './anatomy/anatomyOverlay';
import { anatomy3dHarness } from './anatomy/Anatomy3DView';
import { createAnatomyStore, webDigest, type AnatomyStore } from './anatomy/anatomyStore';
import { platformGunzip } from './anatomy/nifti';
import type { RsMode } from './rsContract';
import { createRsClient, normalizeBase } from './rsClient';
import { createRsController, type RsController } from './rsController';
import { freshId, type RsSelection } from './rsEvents';
import { createRsHost, type RsHost } from './rsHost';

declare global {
  interface Window {
    PACSAI_READING_SYSTEM_API?: unknown;
    PACSAI_READING_SYSTEM_MODE?: unknown;
    PACSAI_READING_SYSTEM_POLL_MS?: unknown;
  }
}

export const DEFAULT_POLL_MS = 2500;
export const MIN_POLL_MS = 500;
/** The reader's role in the events (the contract's `reader.role`). */
export const READER_ROLE = 'radiologist';

export interface ReadingSystemConfig {
  base: string;
  mode: RsMode;
  pollMs: number;
}

/** The pane's switches, or null when the reading system is not configured. */
export function readingSystemConfig(win: Window = window): ReadingSystemConfig | null {
  const base = normalizeBase(win.PACSAI_READING_SYSTEM_API);
  if (!base) {
    return null;
  }
  const mode: RsMode =
    String(win.PACSAI_READING_SYSTEM_MODE ?? '')
      .trim()
      .toLowerCase() === 'fixture'
      ? 'fixture'
      : 'clinical';
  const poll = Number(win.PACSAI_READING_SYSTEM_POLL_MS);
  return {
    base,
    mode,
    pollMs: Number.isFinite(poll) && poll > 0 ? Math.max(MIN_POLL_MS, poll) : DEFAULT_POLL_MS,
  };
}

export const readingSystemEnabled = (win: Window = window): boolean =>
  readingSystemConfig(win) !== null;

// The viewer's signed-in user, for the events' reader (the mode hands in OHIF's
// user authentication service, as it does for the dock).
let userSource: (() => unknown) | null = null;
export function setReadingSystemUser(source: (() => unknown) | null): void {
  userSource = typeof source === 'function' ? source : null;
}
function readerId(): string {
  try {
    const user = userSource?.() as { profile?: Record<string, unknown> } | null | undefined;
    const p = user?.profile ?? {};
    for (const key of ['preferred_username', 'email', 'sub']) {
      const v = p[key];
      if (typeof v === 'string' && v.trim()) {
        return v.trim();
      }
    }
  } catch (_) {
    /* no user */
  }
  return 'viewer';
}

// The viewer's services (the mode hands them in, as it does for the dock): the
// anatomy overlay brings a structure into a viewport with them.
let viewerServices: OverlayServices | null = null;
export function setReadingSystemServices(services: unknown): void {
  viewerServices = services && typeof services === 'object' ? (services as OverlayServices) : null;
}

// Cornerstone, as the extension hands it over at its registration: without it
// (a test, a page without viewports) the anatomy is listed but not drawn.
let cornerstoneApi: CornerstoneApi | null = null;
export function setReadingSystemCornerstone(api: CornerstoneApi | null): void {
  const usable =
    api &&
    typeof api.eventTarget?.addEventListener === 'function' &&
    typeof api.getEnabledElement === 'function' &&
    typeof api.getRenderingEngines === 'function' &&
    typeof api.metaData?.get === 'function' &&
    typeof api.Enums?.Events?.IMAGE_RENDERED === 'string';
  cornerstoneApi = usable ? api : null;
}

const selectionListeners = new Set<(s: RsSelection) => void>();
/** RS-38's seam: told when the reader selects a finding in the pane. */
export function onReadingSystemSelection(listener: (s: RsSelection) => void): () => void {
  selectionListeners.add(listener);
  return () => selectionListeners.delete(listener);
}

let controller: RsController | null = null;
let controllerKey = '';
let host: RsHost | null = null;
let offDock: (() => void) | null = null;
let anatomy: AnatomyStore | null = null;
let overlay: AnatomyOverlay | null = null;
let offAnatomyFollow: (() => void) | null = null;
// The study the pane was entered for (the anatomy follows it once it is served).
let enteredStudy: string | null = null;

/** The reader's anatomy layer settings, in this browser. */
export const ANATOMY_SETTINGS_KEY = 'pacsai.anatomyLayers';

/** What the pane needs of the reading dock: its report column and its lifetime. */
export interface DockForReadingSystem {
  reportColumn: () => HTMLElement;
  setReadingSystemInset: (px: number) => void;
  isGone: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

/** This document's controller, while the reading system is configured and entered. */
export function currentReadingSystem(): RsController | null {
  return controller;
}

function ensureController(win: Window, cfg: ReadingSystemConfig): RsController {
  const key = `${cfg.base}|${cfg.mode}|${cfg.pollMs}`;
  if (controller && key === controllerKey) {
    return controller;
  }
  controller?.leave();
  offAnatomyFollow?.();
  anatomy?.leave();
  controllerKey = key;
  const client = createRsClient({
    base: cfg.base,
    mode: cfg.mode,
    fetchFn: (url, init) => win.fetch(url, init as RequestInit),
  });
  anatomy = createAnatomyStore({
    client,
    digest: webDigest(win),
    gunzip: platformGunzip(),
    yieldNow: () => new Promise(resolve => win.setTimeout(resolve, 0)),
    storage: {
      get: () => {
        try {
          return win.localStorage.getItem(ANATOMY_SETTINGS_KEY);
        } catch (_) {
          return null;
        }
      },
      set: value => {
        try {
          win.localStorage.setItem(ANATOMY_SETTINGS_KEY, value);
        } catch (_) {
          /* a private window */
        }
      },
    },
    studyRef: studyRefFor,
  });
  controller = createRsController({
    client,
    reader: () => ({ id: readerId(), role: READER_ROLE }),
    sessionId: freshId(win.crypto),
    newId: () => freshId(win.crypto),
    now: () => new Date(),
    pollMs: cfg.pollMs,
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    clearTimer: handle => win.clearTimeout(handle as number),
    isHidden: () => win.document.hidden === true,
    studyRef: studyRefFor,
    onSelect: s => selectionListeners.forEach(l => l(s)),
  });
  // The anatomy belongs to a served study: read once the pane is ready for it,
  // let go when the study is not served or the pane leaves.
  const c = controller;
  const a = anatomy;
  offAnatomyFollow = c.subscribe(() => {
    const phase = c.getSnapshot().phase;
    if (phase === 'ready' && enteredStudy) {
      a.enter(enteredStudy);
    } else if (phase === 'not_served' || phase === 'idle') {
      a.leave();
    }
  });
  installHarnessHook(win);
  return controller;
}

/** The overlay that draws the anatomy on the viewports (one per document). */
function ensureOverlay(win: Window): void {
  if (overlay || !anatomy || !cornerstoneApi) {
    return;
  }
  overlay = createAnatomyOverlay({
    store: anatomy,
    services: viewerServices,
    cornerstone: cornerstoneApi,
    win,
  });
}

/** This document's anatomy layers, while the reading system is configured and entered. */
export function currentAnatomy(): AnatomyStore | null {
  return anatomy;
}

/**
 * A route entry for this study, after the dock's own `enter` (radcopilot's
 * onModeInit and onModeEnter). Idempotent. Without a dock (READING_DOCK off)
 * there is no pane. The pane goes when the dock does (leaving the mode), and
 * comes back in the column of the dock made at the next entry.
 */
export function enterReadingSystem(
  study: string | null,
  dock: DockForReadingSystem | null,
  win: Window = window
): void {
  const cfg = readingSystemConfig(win);
  if (!cfg || !dock || dock.isGone()) {
    return;
  }
  const column = dock.reportColumn();
  if (study && study !== enteredStudy) {
    // Another study: its anatomy is read once the pane is ready for it.
    anatomy?.leave();
    enteredStudy = study;
  }
  const c = ensureController(win, cfg);
  ensureOverlay(win);
  if (!host || host.column !== column) {
    host?.destroy();
    offDock?.();
    host = createRsHost({
      win,
      column,
      controller: c,
      anatomy,
      setInset: px => dock.setReadingSystemInset(px),
    });
    offDock = dock.subscribe(() => {
      if (dock.isGone()) {
        leaveReadingSystem();
      }
    });
  }
  if (study) {
    c.enter(study);
  }
}

/** The dock went (leaving the mode): the pane goes with its column. */
export function leaveReadingSystem(): void {
  offDock?.();
  offDock = null;
  host?.destroy();
  host = null;
  overlay?.destroy();
  overlay = null;
  enteredStudy = null;
  controller?.leave();
  anatomy?.leave();
}

let hookInstalled = false;
function installHarnessHook(win: Window): void {
  if (hookInstalled) {
    return;
  }
  hookInstalled = true;
  try {
    // Read-only: the state names the study by reference, never by UID.
    Object.defineProperty(win, '__pacsaiReadingSystem', {
      value: Object.freeze({
        getState: () => {
          const s = controller?.harnessState();
          return s
            ? {
                ...s,
                anatomy: anatomy?.harnessState() ?? null,
                anatomyOverlay: overlay?.harnessState() ?? null,
                anatomy3d: anatomy3dHarness(),
              }
            : null;
        },
      }),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  } catch (_) {
    /* defined already */
  }
}
