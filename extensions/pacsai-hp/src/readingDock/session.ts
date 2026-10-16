/**
 * Rev 11 milestone 6, approach C, phase 1: the one reading dock of this
 * document, its runtime switch, and the harness's read-only view of it.
 *
 * READING_DOCK (the deploy repo's config.js renders it into
 * window.PACSAI_READING_DOCK at container start): `1|true|on|yes` turns the
 * dock on; anything else, unset included, leaves it off, and the radcopilot
 * route is then a plain viewer with no report column.
 */
import { createReadingDock, isErrorPath, isReadingPath, type ReadingDock } from './readingDock';
import { loadIsland } from './islandLoader';

declare global {
  interface Window {
    PACSAI_READING_DOCK?: unknown;
    __pacsaiReading?: unknown;
  }
}

export function readingDockEnabled(win: Window = window): boolean {
  const flag = String(win.PACSAI_READING_DOCK ?? '')
    .trim()
    .toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(flag);
}

// The app's own sign-in pop-up (app repo src/app/lib/appSignIn.ts, P3): a
// same-origin page that signs in through Keycloak and closes itself.
const APP_SIGN_IN_PATH = '/auth/popup';
const APP_SIGN_IN_WINDOW = 'pacsaiAppSignIn';
const appSignInFeatures = (screen: { availWidth: number; availHeight: number }): string => {
  const w = Math.min(520, Math.max(320, screen.availWidth - 40));
  const h = Math.min(680, Math.max(400, screen.availHeight - 40));
  const left = Math.max(0, Math.round((screen.availWidth - w) / 2));
  const top = Math.max(0, Math.round((screen.availHeight - h) / 2));
  return `width=${w},height=${h},left=${left},top=${top},toolbar=0,location=1,menubar=0`;
};

let current: ReadingDock | null = null;
const changeListeners = new Set<() => void>();

/** This document's dock, while there is one. */
export function currentReadingDock(): ReadingDock | null {
  return current && !current.isGone() ? current : null;
}

/** Told when the document's dock is made again (after a leave). */
export function onReadingDockChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** The dock, made the first time a radcopilot route is entered (or again after a leave). */
export function ensureReadingDock(): ReadingDock {
  if (currentReadingDock()) {
    return current as ReadingDock;
  }
  current = createReadingDock({
    win: window,
    load: () =>
      loadIsland({
        fetchFn: (url, init) => window.fetch(url, init as RequestInit),
        // Served by the app on this origin at run time: never bundled.
        importFn: url => import(/* webpackIgnore: true */ url),
      }),
    isReadingPath,
    isErrorPath,
    openAppSignIn: () =>
      window.open(APP_SIGN_IN_PATH, APP_SIGN_IN_WINDOW, appSignInFeatures(window.screen)),
  });
  installHarnessHook();
  changeListeners.forEach(listener => listener());
  return current;
}

let hookInstalled = false;
function installHarnessHook(): void {
  if (hookInstalled) {
    return;
  }
  hookInstalled = true;
  try {
    // Read-only: the dock's snapshot names studies by reference, never by UID.
    Object.defineProperty(window, '__pacsaiReading', {
      value: Object.freeze({ getState: () => currentReadingDock()?.getSnapshot() ?? null }),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  } catch (_) {
    /* defined already */
  }
}
