/**
 * Sign in before the boot (Rev 11 milestone 2, B02 part 3).
 *
 * Measured on dev: every new viewer window booted the whole app (3–13 s),
 * resolved an empty config, and was then redirected to the identity provider
 * by PrivateRoute; the callback document booted again. With a session at the
 * provider, none of that is needed: a silent sign-in (prompt=none in a hidden
 * same-site frame, oidc-client's signinSilent) returns the user without
 * leaving the document, and the app boots once, with a token. Without a
 * session, the redirect happens now — before the boot — so the first document
 * costs a few hundred milliseconds instead of a boot it throws away.
 *
 * Framed by the report window (Rev 11 milestone 6 part 2), the sign-in page
 * refuses to be framed: without a user the shell is told instead (see
 * ./embedAuth). There, a silent sign-in that got no answer is not one the
 * identity provider refused: it is asked once more before the frame reports
 * anything, and what it reports says which it was.
 *
 * The sign-in handoff (pacsai.embed/1 §6): framed with the bridge, the report
 * window hands this document its own access token (`shell.auth`), which is
 * waited for before anything else. The browser's session at the identity
 * provider idles out after an hour while the app's lasts its 10 h, so a
 * reader signed in to the app met the frame's sign-in card; with the token,
 * the frame is signed in whenever the app is. None in time, or one about to
 * expire: the steps below, as before.
 *
 * Everything is injected so the decision is testable without a browser.
 */
import type { OidcClientSettings, UserManagerLike } from './oidcUserManager';
import { unauthenticatedAction, type FramedAuthCode } from './embedAuth';

export type PreInitOutcome =
  | { action: 'skip'; reason: 'no-oidc' | 'code-flow' | 'auth-route' | 'no-client' }
  | { action: 'continue'; via: 'storage' | 'silent' | 'shell' }
  | { action: 'continue'; via: 'none'; reason: string }
  | { action: 'redirect' }
  | { action: 'auth-required'; code: FramedAuthCode };

export interface PreInitDeps {
  oidc: OidcClientSettings[] | undefined | null;
  routerBasename: string;
  location: { pathname: string; search: string };
  getUserManager: (oidc: OidcClientSettings[], routerBasename: string) => UserManagerLike | undefined;
  storage: { setItem(key: string, value: string): void } | null;
  /** Guard around signinSilent, on top of the client's own silentRequestTimeout. */
  silentTimeoutMs?: number;
  onAuthReady?: () => void;
  /** Framed by the report window: never redirect, report auth-required instead. */
  framed?: boolean;
  /**
   * Called once when a framed document has no user (records it and tells the
   * shell): AUTH_REQUIRED when the identity provider answered that there is no
   * session, AUTH_UNAVAILABLE when it did not answer, twice.
   */
  onAuthRequired?: (code: FramedAuthCode) => void;
  /**
   * Framed with an active bridge (§6): the report window's token, or null when
   * none came in time (the bridge's whenShellAuth). Asked only together with
   * storeShellUser.
   */
  shellToken?: () => Promise<ShellToken | null>;
  /** Store the shell's token as this document's user (./shellAuth). */
  storeShellUser?: (token: ShellToken) => Promise<void>;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** The report window's access token (pacsai.embed/1 §6): a JWT and its `exp`, epoch seconds. */
export interface ShellToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * The profile mark a user built from the shell's token carries (./shellAuth),
 * so a stored one is told from the viewer's own sign-in (in the profile: it is
 * what oidc-client v1 stores; it drops a User's `state`). It is used only by a
 * document that was just handed it: a framed document whose shell sent no
 * token this time (the app's handoff turned off) and an unframed window that
 * inherited the tab's sessionStorage (window.open copies it) both discard it
 * and sign themselves in, so a kill switch takes effect at the next document
 * and the app's token never serves, or is revoked by, a viewer of its own.
 */
export const SHELL_USER_MARK = 'pacsai_shell_auth';
export const isShellUser = (user: { profile?: Record<string, unknown> } | null | undefined): boolean =>
  !!user && !!user.profile && user.profile[SHELL_USER_MARK] === true;

/** A shell token with less than this left is not booted on: the document signs itself in. */
export const SHELL_TOKEN_MIN_REMAINING_MS = 30000;

/** A token that expires more than SHELL_TOKEN_MIN_REMAINING_MS after `nowMs`. */
export function isUsableShellToken(token: ShellToken | null | undefined, nowMs: number): boolean {
  return (
    !!token &&
    typeof token.expiresAt === 'number' &&
    token.expiresAt * 1000 - nowMs > SHELL_TOKEN_MIN_REMAINING_MS
  );
}

/** Routes the auth flow owns; the pre-init step must not touch them. */
const AUTH_ROUTES = ['/callback', '/login', '/logout', '/logout-redirect.html', '/silent-refresh.html'];

/**
 * The OAuth errors with which the identity provider answers a prompt=none
 * request that it has no session to sign in with (OpenID Connect Core
 * §3.1.2.6).
 */
const NO_SESSION_ERRORS = ['login_required', 'interaction_required', 'consent_required', 'account_selection_required'];
const NO_SESSION_IN_TEXT = new RegExp(`\\b(?:${NO_SESSION_ERRORS.join('|')})\\b`);

/**
 * Whether a failed silent sign-in is the identity provider's answer that there
 * is no session. oidc-client (v1, the implicit flow) and oidc-client-ts both
 * reject with an ErrorResponse whose `error` is the OAuth code (its message is
 * the error_description, else the code); without one, the code in the message.
 * Anything else — a timeout (oidc-client's "Frame window timed out", this
 * step's own guard), a network or a frame error — is no answer.
 */
export function isNoSessionError(err: unknown): boolean {
  const e = err as { error?: unknown; message?: unknown } | null | undefined;
  if (typeof e?.error === 'string') {
    return NO_SESSION_ERRORS.includes(e.error);
  }
  const text = typeof err === 'string' ? err : typeof e?.message === 'string' ? e.message : '';
  return NO_SESSION_IN_TEXT.test(text);
}

export function stripBasename(pathname: string, routerBasename: string): string {
  const base = routerBasename.replace(/\/$/, '');
  if (base && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return pathname;
}

export async function preInitSignIn(deps: PreInitDeps): Promise<PreInitOutcome> {
  const {
    oidc,
    routerBasename,
    location,
    getUserManager,
    storage,
    silentTimeoutMs = 10000,
    onAuthReady,
    framed = false,
    onAuthRequired,
    shellToken,
    storeShellUser,
    now = () => Date.now(),
    setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: cancel = handle => globalThis.clearTimeout(handle as number),
  } = deps;

  if (!Array.isArray(oidc) || !oidc.length || !oidc[0]?.authority || !oidc[0]?.client_id) {
    return { action: 'skip', reason: 'no-oidc' };
  }
  if (oidc[0].response_type === 'code') {
    // The code-flow client has its own lifecycle; this step covers the
    // implicit flow the viewer runs today.
    return { action: 'skip', reason: 'code-flow' };
  }
  const relative = stripBasename(location.pathname, routerBasename);
  if (AUTH_ROUTES.some(route => relative === route || relative.startsWith(`${route}/`))) {
    return { action: 'skip', reason: 'auth-route' };
  }
  const userManager = getUserManager(oidc, routerBasename);
  if (!userManager) {
    return { action: 'skip', reason: 'no-client' };
  }

  // 0. Framed (§6): the report window's token, first. The shell sends it
  // right behind its hello, so this waits at most for the hello and a short
  // grace; a throw from either step is no token.
  if (framed && shellToken && storeShellUser) {
    if (await takeShellToken(shellToken, storeShellUser, now)) {
      onAuthReady?.();
      return { action: 'continue', via: 'shell' };
    }
  }

  // 1. A user this tab already holds (a reload, or a second study in the tab).
  // Not the shell's: this document was not handed it (see SHELL_USER_MARK).
  let stored = await userManager.getUser().catch(() => null);
  if (isShellUser(stored)) {
    await userManager.removeUser().catch(() => undefined);
    stored = null;
  }
  if (stored && !stored.expired) {
    onAuthReady?.();
    return { action: 'continue', via: 'storage' };
  }

  // 2. A session at the identity provider: prompt=none in a hidden frame.
  const trySilent = async (): Promise<'user' | 'no-session' | 'no-answer'> => {
    try {
      const user = await withTimeout(userManager.signinSilent(), silentTimeoutMs, schedule, cancel);
      // A sign-in that resolved without a usable user is an answer too.
      return user && !user.expired ? 'user' : 'no-session';
    } catch (err) {
      return isNoSessionError(err) ? 'no-session' : 'no-answer';
    }
  };
  const reportsInstead = unauthenticatedAction({ framed }) === 'report-auth-required';
  let silent = await trySilent();
  if (silent === 'no-answer' && reportsInstead) {
    // Framed, a slow identity provider is not "sign-in required" (live,
    // N02-delayed: a held authorize timed the frame out while a top-level
    // prompt=none check got tokens). Asked once more, under the same timeouts.
    silent = await trySilent();
  }
  if (silent === 'user') {
    onAuthReady?.();
    return { action: 'continue', via: 'silent' };
  }

  // 3. No user, framed: the sign-in page refuses to be framed, so this
  // document never goes there, and stores no target for a callback that will
  // not come. The shell offers the sign-in in a top-level window; when the
  // identity provider did not answer at all, it is told that instead.
  if (reportsInstead) {
    const code: FramedAuthCode = silent === 'no-answer' ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED';
    try {
      onAuthRequired?.(code);
    } catch (_) {
      /* the outcome stands: a boot here could only fail to sign in */
    }
    return { action: 'auth-required', code };
  }

  // 4. No session: go to the sign-in page now, before any boot. The callback
  // document navigates back to this path (router-relative, as the routes
  // store it).
  try {
    storage?.setItem('ohif-redirect-to', JSON.stringify({ pathname: relative, search: location.search }));
  } catch (_) {
    /* storage unavailable: the callback lands on the study list */
  }
  try {
    await userManager.signinRedirect();
    return { action: 'redirect' };
  } catch (err) {
    return { action: 'continue', via: 'none', reason: String((err as Error)?.message ?? err) };
  }
}

/** The shell's token stored as this document's user; false for none, one about to expire, or a throw. */
async function takeShellToken(
  ask: () => Promise<ShellToken | null>,
  store: (token: ShellToken) => Promise<void>,
  now: () => number
): Promise<boolean> {
  try {
    const token = await ask();
    if (!token || !isUsableShellToken(token, now())) {
      return false;
    }
    await store(token);
    return true;
  } catch (_) {
    return false;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  schedule: (fn: () => void, ms: number) => unknown,
  cancel: (handle: unknown) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = schedule(() => reject(new Error('silent sign-in timed out')), ms);
    promise.then(
      v => {
        cancel(handle);
        resolve(v);
      },
      e => {
        cancel(handle);
        reject(e);
      }
    );
  });
}
