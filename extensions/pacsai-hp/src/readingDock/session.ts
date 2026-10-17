/**
 * Rev 11 milestone 6, approach C, phase 1: the one reading dock of this
 * document, its runtime switch, and the harness's read-only view of it.
 *
 * READING_DOCK (the deploy repo's config.js renders it into
 * window.PACSAI_READING_DOCK at container start): `1|true|on|yes` turns the
 * dock on; anything else, unset included, leaves it off, and the radcopilot
 * route is then a plain viewer with no report column.
 */
import { utils } from '@ohif/core';
import {
  createReadingDock,
  isErrorPath,
  isReadingPath,
  type ReadingChannelDeps,
  type ReadingDock,
} from './readingDock';
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

/**
 * Phase 2: the channel to the worklist that opened this window. The opener
 * counts only while it is open and of this origin (a cross-origin opener
 * throws on its location). The document's gateways and route are read when
 * the dock is made, at the first route entry (the data sources were built for
 * that URL's gateways). The switch is the viewer's in-document one, as the
 * embed bridge's switchStudy makes it: the URL replaced in place, then a
 * popstate so react-router re-enters the mode for the new study, with a fresh
 * attempt generation.
 */
function readingChannelDeps(): ReadingChannelDeps {
  const gateways = new URLSearchParams(window.location.search).getAll('gatewayAET');
  return {
    opener: () => {
      const opener = window.opener as Window | null;
      if (!opener || opener.closed) {
        return null;
      }
      try {
        return opener.location.origin === window.location.origin ? opener : null;
      } catch (_) {
        return null;
      }
    },
    ownOrigin: window.location.origin,
    documentGateways: () => gateways,
    openedPath: window.location.pathname,
    switchTo: href => {
      window.history.replaceState(window.history.state, '', href);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
      try {
        utils.attempt?.requestFreshGeneration?.();
      } catch (_) {
        /* a trace that cannot take it still binds a different study's new generation */
      }
    },
    loadNew: href => window.location.replace(href),
  };
}

/**
 * Phase 2 (PR 3): "Report without images", the app's report-only page (its
 * /reports, alone: no viewer beside it, whatever the workspace arrangement),
 * in the worklist's report window, with the Read's launch. The page claims
 * at open as it always does (the same reader's claim).
 */
const REPORT_WINDOW = 'reportWindow';
function reportOnlyHref(
  studyInstanceUid: string,
  launch?: { attempt: string; attemptT0: number }
): string {
  const q = new URLSearchParams({ studyInstanceUid, wsWindows: 'separate' });
  if (launch) {
    q.set('attempt', launch.attempt);
    q.set('attemptT0', String(launch.attemptT0));
  }
  return `/reports?${q.toString()}`;
}
const reportWindowFeatures = (screen: { width: number; height: number }): string =>
  `width=${Math.round(screen.width / 2)},height=${screen.height},toolbar=0,location=0,menubar=0,top=0,left=0`;

/**
 * Phase 2 (PR 4): the viewer's own signed-in user, its OpenID subject, for
 * the report's identity gate (the app's reader is a subject of the same
 * Keycloak realm). The mode hands in OHIF's user authentication service at
 * its route entries; null before then, or before a sign-in.
 */
let viewerUserSource: (() => unknown) | null = null;
export function setReadingViewerUser(source: (() => unknown) | null): void {
  viewerUserSource = typeof source === 'function' ? source : null;
}
function viewerUserSub(): string | null {
  try {
    const user = viewerUserSource?.() as { profile?: { sub?: unknown } } | null | undefined;
    const sub = user?.profile?.sub;
    return typeof sub === 'string' && sub.length > 0 ? sub : null;
  } catch (_) {
    return null;
  }
}

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
    channel: readingChannelDeps(),
    viewerUser: viewerUserSub,
    openReportOnly: (studyInstanceUid, launch) =>
      window.open(
        reportOnlyHref(studyInstanceUid, launch),
        REPORT_WINDOW,
        reportWindowFeatures(window.screen)
      ),
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
