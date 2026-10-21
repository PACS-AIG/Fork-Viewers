/**
 * The reading window signs in with the app's sign-in (Rev 11 milestone 6,
 * approach C, 21 Oct 2026; the app's docs/rev11/m6-reading-window-sign-in.md).
 *
 * The reading window (the radcopilot route with READING_DOCK on, top level)
 * runs on the app's origin. The viewer's own sign-in (client `ohif`) needs the
 * browser's Keycloak session, which idles out after an hour; the app's session
 * lasts its 10 h on its own refresh token, so a reader signed in to the app met
 * Keycloak's sign-in page here. Instead, this document asks the app: its
 * switch (`readingAppSignIn` in /api/workspace/flags) and its session
 * (next-auth's /api/auth/session, which carries the app's current access
 * token). The token is then this document's user, exactly as the framed
 * window's handoff stores the report window's (./shellAuth), and Keycloak is
 * not asked while the app session lives. Anything else (the switch off, no app
 * session, no answer in time) leaves the viewer's own sign-in as it was.
 *
 * While the window is open, the app's newer tokens (its keep-alive refreshes
 * them) replace the user, and the end of the app session (a sign-out, its
 * 10 h) stops the token being sent until the reader signs in again (the
 * report's own sign-in line); the images on screen stay, no request goes out
 * on a session that has ended.
 *
 * The token is never logged and never put in a URL. Everything is injected,
 * so the rules are testable without a browser.
 */
import { readTokenClaims } from './shellAuth';
import { isUsableShellToken, type ShellToken } from './preInitSignIn';

/** The app's switches, answered per signed-in user (401 without a session). */
export const APP_FLAGS_PATH = '/api/workspace/flags';
/** next-auth's session: the app's current access token, or an `error` once it has ended. */
export const APP_SESSION_PATH = '/api/auth/session';
/** The reading window's route segment (modes/radcopilot's RADCOPILOT_ROUTE). */
export const READING_ROUTE = 'radcopilot';
/** The app's keep-alive stamp (its src/app/sessionKeepAlive.tsx), written after each refresh. */
export const KEEP_ALIVE_KEY = 'pacsai.sessionKeepAliveAt';
/** next-auth's cross-tab message (a session change, a sign-out). */
export const NEXTAUTH_MESSAGE_KEY = 'nextauth.message';
/** Both reads together, at the boot and at each check. */
export const APP_SIGN_IN_TIMEOUT_MS = 3000;
/** A check this often in any case: a keep-alive in this very page raises no storage event here. */
export const APP_SESSION_RECHECK_MS = 5 * 60 * 1000;
/** A check this long before the held token expires. */
export const APP_TOKEN_EXPIRY_LEAD_MS = 2 * 60 * 1000;

/** What the app answered. */
export type AppTokenRead =
  | { kind: 'token'; token: ShellToken }
  /** No app session: the flags answered 401, or the session has no token or has ended. */
  | { kind: 'signed-out' }
  /** The app's switch is off. */
  | { kind: 'off' }
  /** No answer in time, a network error, or a reply that is not one of the above. */
  | { kind: 'unavailable' };

type FetchLike = (
  input: string,
  init?: Record<string, unknown>
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * The reading window: its route with READING_DOCK on, not framed by a report
 * window. The route as the reading dock tells it (its isReadingPath): the last
 * `radcopilot` segment, with at most a data source segment after it, whatever
 * comes before (the deployment's path and the router's basename).
 */
export function isReadingWindow(opts: {
  pathname: string;
  readingDock: unknown;
  framed: boolean;
}): boolean {
  if (opts.framed) {
    return false;
  }
  const flag = String(opts.readingDock ?? '')
    .trim()
    .toLowerCase();
  if (!['1', 'true', 'on', 'yes'].includes(flag)) {
    return false;
  }
  const segments = String(opts.pathname).split('/').filter(Boolean);
  const i = segments.lastIndexOf(READING_ROUTE);
  return i >= 0 && segments.length - i <= 2;
}

/** A compact JWS the size the framed handoff accepts (pacsai.embed/1 §6). */
const isCompactJws = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 16384 &&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(value);

/**
 * The app's access token from next-auth's session reply, with the token's own
 * `exp`; null for no session, a session that has ended (`error`), no token, or
 * an expiry that cannot be read.
 */
export function appTokenFromSession(session: unknown): ShellToken | null {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return null;
  }
  const { accessToken, error } = session as { accessToken?: unknown; error?: unknown };
  if (error || !isCompactJws(accessToken)) {
    return null;
  }
  const exp = readTokenClaims(accessToken).exp;
  if (typeof exp !== 'number' || !Number.isInteger(exp) || exp <= 0) {
    return null;
  }
  return { accessToken, expiresAt: exp };
}

/**
 * Ask the app: its switch and its session, both at once and bounded. A token
 * with 30 s or less left is no token (preInitSignIn's isUsableShellToken).
 */
export async function readAppToken(
  fetchFn: FetchLike,
  opts: {
    timeoutMs?: number;
    now?: () => number;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  } = {}
): Promise<AppTokenRead> {
  const {
    timeoutMs = APP_SIGN_IN_TIMEOUT_MS,
    now = () => Date.now(),
    setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: cancel = handle => globalThis.clearTimeout(handle as number),
  } = opts;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const init = {
    credentials: 'same-origin',
    cache: 'no-store',
    ...(controller ? { signal: controller.signal } : {}),
  };
  let timer: unknown = null;
  const timedOut = new Promise<'timeout'>(resolve => {
    timer = schedule(() => {
      controller?.abort();
      resolve('timeout');
    }, timeoutMs);
  });
  const answer = (async (): Promise<AppTokenRead> => {
    const [flagsRes, sessionRes] = await Promise.all([
      fetchFn(APP_FLAGS_PATH, init),
      fetchFn(APP_SESSION_PATH, init),
    ]);
    if (flagsRes.status === 401) {
      return { kind: 'signed-out' };
    }
    if (!flagsRes.ok || !sessionRes.ok) {
      return { kind: 'unavailable' };
    }
    const flags = (await flagsRes.json()) as { readingAppSignIn?: unknown } | null;
    if (!flags || typeof flags !== 'object') {
      return { kind: 'unavailable' };
    }
    if (flags.readingAppSignIn !== true) {
      return { kind: 'off' };
    }
    const token = appTokenFromSession(await sessionRes.json());
    return token && isUsableShellToken(token, now())
      ? { kind: 'token', token }
      : { kind: 'signed-out' };
  })().catch((): AppTokenRead => ({ kind: 'unavailable' }));
  const result = await Promise.race([answer, timedOut]);
  cancel(timer);
  return result === 'timeout' ? { kind: 'unavailable' } : result;
}

/**
 * The state the routes read (./OpenIdConnectRoutes): whether this document's
 * user is the app's, and whether the app session has ended since. One per
 * document.
 */
const state = { active: false, ended: false, renewals: 0 };
export const appSignInActive = (): boolean => state.active;
/** The app's user is held but its session has ended: send no token until it is back. */
export const appSignInEnded = (): boolean => state.active && state.ended;
export function setAppSignInState(next: Partial<typeof state>): void {
  Object.assign(state, next);
}
/** A newer app token became the user. */
export function noteAppRenewal(): void {
  state.renewals++;
}

/**
 * A read-only view for the probes, `window.__pacsaiAppSignIn.getState()`:
 * whether the user is the app's, whether its session has ended, and how many
 * newer tokens replaced it. Never a token.
 */
export function installAppSignInHook(win: object): void {
  try {
    Object.defineProperty(win, '__pacsaiAppSignIn', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({ getState: () => ({ ...state }) }),
    });
  } catch (_) {
    /* already there (a second boot in the document): the same state */
  }
}

type WatchWindow = {
  addEventListener(type: 'storage', listener: (e: { key: string | null }) => void): void;
  removeEventListener(type: 'storage', listener: (e: { key: string | null }) => void): void;
};

/**
 * While the window is open: the app's newer tokens, and the end and return of
 * its session. Checks on the keep-alive's stamp and next-auth's message from
 * another page of the origin, every APP_SESSION_RECHECK_MS, and
 * APP_TOKEN_EXPIRY_LEAD_MS before the held token expires. One check at a time
 * (a trigger during one runs one more after it). Returns the stop.
 */
export function watchAppSignIn(deps: {
  current: ShellToken;
  read: () => Promise<AppTokenRead>;
  store: (token: ShellToken) => Promise<void>;
  onEnded: () => void;
  onBack: () => void;
  win: WatchWindow;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}): () => void {
  const {
    read,
    store,
    onEnded,
    onBack,
    win,
    now = () => Date.now(),
    setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: cancel = handle => globalThis.clearTimeout(handle as number),
    setInterval: every = (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: stopEvery = handle => globalThis.clearInterval(handle as number),
  } = deps;
  let current = deps.current;
  let ended = false;
  let stopped = false;
  let running = false;
  let again = false;
  let expiryTimer: unknown = null;

  const armExpiry = () => {
    if (expiryTimer !== null) {
      cancel(expiryTimer);
    }
    const ms = Math.max(0, current.expiresAt * 1000 - now() - APP_TOKEN_EXPIRY_LEAD_MS);
    expiryTimer = schedule(() => {
      expiryTimer = null;
      void check();
    }, ms);
  };

  const check = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const r = await read();
      if (stopped) {
        return;
      }
      if (r.kind === 'token') {
        if (r.token.accessToken !== current.accessToken) {
          await store(r.token);
          current = r.token;
          armExpiry();
        }
        if (ended) {
          ended = false;
          onBack();
        }
      } else if (r.kind === 'signed-out' && !ended) {
        ended = true;
        onEnded();
      }
      // 'off' and 'unavailable': the held user stands.
    } catch (_) {
      /* a store that failed: the held user stands, the next check tries again */
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        void check();
      }
    }
  };

  const onStorage = (e: { key: string | null }) => {
    if (e.key === KEEP_ALIVE_KEY || e.key === NEXTAUTH_MESSAGE_KEY) {
      void check();
    }
  };
  win.addEventListener('storage', onStorage);
  const interval = every(() => void check(), APP_SESSION_RECHECK_MS);
  armExpiry();

  return () => {
    stopped = true;
    win.removeEventListener('storage', onStorage);
    stopEvery(interval);
    if (expiryTimer !== null) {
      cancel(expiryTimer);
      expiryTimer = null;
    }
  };
}
