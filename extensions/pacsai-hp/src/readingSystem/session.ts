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
 */
import { studyRefFor } from '@ohif/core/src/utils/attempt/attemptTrace';
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

export const readingSystemEnabled = (win: Window = window): boolean => readingSystemConfig(win) !== null;

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
  controllerKey = key;
  controller = createRsController({
    client: createRsClient({
      base: cfg.base,
      mode: cfg.mode,
      fetchFn: (url, init) => win.fetch(url, init as RequestInit),
    }),
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
  installHarnessHook(win);
  return controller;
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
  const c = ensureController(win, cfg);
  if (!host || host.column !== column) {
    host?.destroy();
    offDock?.();
    host = createRsHost({ win, column, controller: c, setInset: px => dock.setReadingSystemInset(px) });
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
  controller?.leave();
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
      value: Object.freeze({ getState: () => controller?.harnessState() ?? null }),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  } catch (_) {
    /* defined already */
  }
}
