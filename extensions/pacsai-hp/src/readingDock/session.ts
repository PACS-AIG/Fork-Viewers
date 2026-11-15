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
import { signOutOfApp } from './appSignOut';
import { createViewerPlace, type ViewerServices } from './viewerPlace';

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
/** 21 Oct: the app's own sign-in page, and its own sign-out page (which asks). */
const APP_SIGN_IN_PAGE = '/auth/signin';
const APP_SIGN_OUT_PAGE = '/api/auth/signout';
/**
 * The mark on a user the viewer was handed (the platform's preInitSignIn
 * SHELL_USER_MARK; the reading window's app sign-in uses it too). Repeated
 * here: the platform imports this package, not the other way round.
 */
const APP_USER_MARK = 'pacsai_shell_auth';
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
/** 21 Oct: the viewer's user was handed by the app (the platform's appSignIn marks it). */
function viewerUserIsApp(): boolean {
  try {
    const user = viewerUserSource?.() as { profile?: Record<string, unknown> } | null | undefined;
    return user?.profile?.[APP_USER_MARK] === true;
  } catch (_) {
    return false;
  }
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

/**
 * F58: OHIF's services, for the viewer's half of a held place (./viewerPlace).
 * The mode hands them in at its route entries; null before then.
 */
let viewerServices: ViewerServices | null = null;
export function setReadingViewerServices(services: unknown): void {
  const s = services as Partial<ViewerServices> | null | undefined;
  viewerServices =
    s && s.viewportGridService && s.cornerstoneViewportService && s.displaySetService
      ? (s as ViewerServices)
      : null;
  watchSelection(viewerServices);
}

/**
 * Rev 11 milestone 25, PR 6 (F61's selection message, F87): what the reader is
 * looking at changes when the active viewport or the grid does (OHIF's grid
 * events), when a viewport shows another image (cornerstone's new-image events,
 * fired on the viewport's element: taken at the document as they pass, every
 * viewport's) and when a measurement is selected or let go (OHIF's measurement
 * events). Each tells the dock, which tells the island at most once a
 * SELECTION_EVERY_MS. One watch per services object.
 */
const NEW_IMAGE_EVENTS = ['CORNERSTONE_STACK_NEW_IMAGE', 'CORNERSTONE_VOLUME_NEW_IMAGE'] as const;
type PubSubLike = {
  subscribe?: (event: string, callback: () => void) => { unsubscribe?: () => void } | undefined;
  EVENTS?: Record<string, string>;
};
let watchedServices: ViewerServices | null = null;
let stopWatching: (() => void) | null = null;
function watchSelection(services: ViewerServices | null): void {
  if (services === watchedServices) {
    return;
  }
  stopWatching?.();
  stopWatching = null;
  watchedServices = services;
  if (!services) {
    return;
  }
  const changed = () => currentReadingDock()?.selectionChanged();
  const stops: Array<() => void> = [];
  const listen = (service: unknown, names: readonly string[]) => {
    const pubSub = service as PubSubLike | null | undefined;
    for (const name of names) {
      const event = pubSub?.EVENTS?.[name];
      if (!event || typeof pubSub?.subscribe !== 'function') {
        continue;
      }
      try {
        const sub = pubSub.subscribe(event, changed);
        if (typeof sub?.unsubscribe === 'function') {
          stops.push(() => sub.unsubscribe?.());
        }
      } catch (_) {
        /* that event is not watched */
      }
    }
  };
  listen(services.viewportGridService, [
    'ACTIVE_VIEWPORT_ID_CHANGED',
    'GRID_STATE_CHANGED',
    'VIEWPORTS_READY',
  ]);
  listen(services.measurementService, [
    'MEASUREMENT_UPDATED',
    'MEASUREMENT_REMOVED',
    'MEASUREMENTS_CLEARED',
  ]);
  for (const type of NEW_IMAGE_EVENTS) {
    document.addEventListener(type, changed, true);
    stops.push(() => document.removeEventListener(type, changed, true));
  }
  stopWatching = () => stops.forEach(stop => stop());
}

/**
 * Milestone 25, PR 6 (F05): OHIF's hotkeys (the commands module hands the
 * manager in at registration), told to the island as the viewer's own keys so
 * the report refuses a sign key one of them has. Read at the moment: a reader's
 * own remapping in OHIF's preferences counts.
 */
type HotkeysManagerLike = {
  hotkeyDefinitions?: Record<string, { label?: unknown; keys?: unknown } | null | undefined>;
};
let readingHotkeys: HotkeysManagerLike | null = null;
export function setReadingHotkeys(manager: unknown): void {
  readingHotkeys = manager && typeof manager === 'object' ? (manager as HotkeysManagerLike) : null;
}
export function readingViewerHotkeys(): Array<{ label: string; keys: string[] }> {
  const definitions = readingHotkeys?.hotkeyDefinitions;
  if (!definitions || typeof definitions !== 'object') {
    return [];
  }
  const out: Array<{ label: string; keys: string[] }> = [];
  for (const d of Object.values(definitions)) {
    const keys = Array.isArray(d?.keys)
      ? d.keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
      : typeof d?.keys === 'string' && d.keys
        ? [d.keys]
        : [];
    if (keys.length) {
      out.push({ label: typeof d?.label === 'string' ? d.label : '', keys });
    }
  }
  return out;
}

/** Milestone 7 (Arrange): the same services, as the mode handed them in (null before). */
export function readingViewerServices(): Record<string, unknown> | null {
  return viewerServices as unknown as Record<string, unknown> | null;
}

/** Milestone 7 (Arrange): F58's images place, over those services (one per document). */
let arrangePlace: ReturnType<typeof createViewerPlace> | null = null;
export function readingViewerPlace(): ReturnType<typeof createViewerPlace> | null {
  if (!viewerServices) {
    return null;
  }
  if (!arrangePlace) {
    arrangePlace = createViewerPlace(() => viewerServices, window);
  }
  return arrangePlace;
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
    viewerUserIsApp,
    signOutOfApp: () =>
      signOutOfApp({
        fetchFn: (url, init) => window.fetch(url, init as RequestInit),
        storage: (() => {
          try {
            return window.localStorage;
          } catch (_) {
            return null;
          }
        })(),
      }),
    leaveAfterSignOut: signedOut => {
      if (!signedOut) {
        window.location.assign(APP_SIGN_OUT_PAGE);
        return;
      }
      // A window the worklist opened closes; one opened another way cannot, and
      // goes to the app's sign-in page instead.
      window.close();
      window.setTimeout(() => {
        if (!window.closed) {
          window.location.assign(APP_SIGN_IN_PAGE);
        }
      }, 300);
    },
    openReportOnly: (studyInstanceUid, launch) =>
      window.open(
        reportOnlyHref(studyInstanceUid, launch),
        REPORT_WINDOW,
        reportWindowFeatures(window.screen)
      ),
    viewerPlace: createViewerPlace(() => viewerServices, window),
    viewerHotkeys: readingViewerHotkeys,
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
