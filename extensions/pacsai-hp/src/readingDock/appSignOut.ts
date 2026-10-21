/**
 * Rev 11 milestone 6, approach C (21 Oct 2026; the app's
 * docs/rev11/m6-reading-window-sign-in.md §4.5): the reading window's Logout
 * when it is signed in with the app's sign-in. The viewer's own sign-out would
 * revoke the app's token from here; instead the app signs out, as next-auth's
 * own client does it: its CSRF token, a POST to its sign-out, then its
 * cross-tab message, so the worklist and every other page of the app learn it
 * at once. next-auth's sign-out event ends the Keycloak session too.
 *
 * Injected, so it is testable without a browser.
 */

export const APP_CSRF_PATH = '/api/auth/csrf';
export const APP_SIGN_OUT_PATH = '/api/auth/signout';
/** next-auth's cross-tab message (its client's BroadcastChannel over localStorage). */
export const NEXTAUTH_MESSAGE_KEY = 'nextauth.message';

type FetchLike = (
  input: string,
  init?: Record<string, unknown>
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Sign out of the app; true once its sign-out answered. Never throws. */
export async function signOutOfApp(deps: {
  fetchFn: FetchLike;
  storage: { setItem(key: string, value: string): void } | null;
  now?: () => number;
}): Promise<boolean> {
  const { fetchFn, storage, now = () => Date.now() } = deps;
  try {
    const csrfRes = await fetchFn(APP_CSRF_PATH, { credentials: 'same-origin', cache: 'no-store' });
    if (!csrfRes.ok) {
      return false;
    }
    const csrf = (await csrfRes.json()) as { csrfToken?: unknown } | null;
    const csrfToken = csrf && typeof csrf === 'object' ? csrf.csrfToken : undefined;
    if (typeof csrfToken !== 'string' || !csrfToken) {
      return false;
    }
    const res = await fetchFn(APP_SIGN_OUT_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, callbackUrl: '/', json: 'true' }).toString(),
    });
    if (!res.ok) {
      return false;
    }
  } catch (_) {
    return false;
  }
  try {
    storage?.setItem(
      NEXTAUTH_MESSAGE_KEY,
      JSON.stringify({
        event: 'session',
        data: { trigger: 'signout' },
        timestamp: Math.floor(now() / 1000),
      })
    );
  } catch (_) {
    /* no storage: the other pages learn it at their next session read */
  }
  return true;
}
