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
 * Everything is injected so the decision is testable without a browser.
 */
import type { OidcClientSettings, UserManagerLike } from './oidcUserManager';

export type PreInitOutcome =
  | { action: 'skip'; reason: 'no-oidc' | 'code-flow' | 'auth-route' | 'no-client' }
  | { action: 'continue'; via: 'storage' | 'silent' }
  | { action: 'continue'; via: 'none'; reason: string }
  | { action: 'redirect' };

export interface PreInitDeps {
  oidc: OidcClientSettings[] | undefined | null;
  routerBasename: string;
  location: { pathname: string; search: string };
  getUserManager: (oidc: OidcClientSettings[], routerBasename: string) => UserManagerLike | undefined;
  storage: { setItem(key: string, value: string): void } | null;
  /** Guard around signinSilent, on top of the client's own silentRequestTimeout. */
  silentTimeoutMs?: number;
  onAuthReady?: () => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** Routes the auth flow owns; the pre-init step must not touch them. */
const AUTH_ROUTES = ['/callback', '/login', '/logout', '/logout-redirect.html', '/silent-refresh.html'];

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
  try {
    const user = await withTimeout(userManager.signinSilent(), silentTimeoutMs, schedule, cancel);
    if (user && !user.expired) {
      onAuthReady?.();
      return { action: 'continue', via: 'silent' };
    }
  } catch (_) {
    // login_required, a blocked frame, or the timeout: fall through
  }

  // 3. No session: go to the sign-in page now, before any boot. The callback
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
