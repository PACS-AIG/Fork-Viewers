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
 * Everything is injected so the decision is testable without a browser.
 */
import type { OidcClientSettings, UserManagerLike } from './oidcUserManager';
import { unauthenticatedAction, type FramedAuthCode } from './embedAuth';

export type PreInitOutcome =
  | { action: 'skip'; reason: 'no-oidc' | 'code-flow' | 'auth-route' | 'no-client' }
  | { action: 'continue'; via: 'storage' | 'silent' }
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
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
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

  // 1. A user this tab already holds (a reload, or a second study in the tab).
  const stored = await userManager.getUser().catch(() => null);
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
