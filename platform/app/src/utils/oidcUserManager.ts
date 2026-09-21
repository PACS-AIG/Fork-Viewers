/**
 * One OIDC client per document (Rev 11 milestone 2, B02 part 3).
 *
 * OpenIdConnectRoutes used to build a new UserManager on every render, and
 * each one started its own session monitor and silent-renew timer — the
 * duplicate login-status frames of §13. The client is now built once per
 * (authority, client id, basename) and shared by the pre-init sign-in and the
 * routes. The settings computation is unchanged from the routes' original.
 */
import LegacyClient from './legacyOIDCClient';
import NextClient from './nextOIDCClient';

export interface OidcClientSettings {
  authority: string;
  client_id: string;
  response_type?: string;
  redirect_uri?: string;
  silent_redirect_uri?: string;
  post_logout_redirect_uri?: string;
  silentRequestTimeout?: number;
  [key: string]: unknown;
}

/** oidc-client (v1) and oidc-client-ts share this surface. */
export interface UserManagerLike {
  getUser(): Promise<{ expired?: boolean; access_token?: string } | null>;
  signinSilent(args?: unknown): Promise<{ expired?: boolean; access_token?: string } | null | undefined>;
  signinRedirect(args?: unknown): Promise<void>;
  settings: Record<string, any>;
}

/** How long a silent (prompt=none) sign-in may take before we redirect instead. */
export const SILENT_SIGNIN_TIMEOUT_MS = 8000;

function isAbsoluteUrl(url: string): boolean {
  return url.includes('http://') || url.includes('https://');
}

function makeAbsoluteIfNecessary(url: string, baseUrl: string): string {
  if (isAbsoluteUrl(url)) {
    return url;
  }
  if (baseUrl[baseUrl.length - 1] === '/') {
    baseUrl = baseUrl.slice(0, baseUrl.length - 1);
  }
  return baseUrl + url;
}

/** Pure: the settings the client is built from, with absolute redirect URIs. */
export function buildOidcClientSettings(
  first: OidcClientSettings,
  routerBasename: string,
  origin: string
): OidcClientSettings {
  const baseUri = `${origin}${routerBasename}`;
  const redirect_uri = first.redirect_uri || '/callback';
  const silent_redirect_uri = first.silent_redirect_uri || '/silent-refresh.html';
  const post_logout_redirect_uri = first.post_logout_redirect_uri || '/';
  return Object.assign({}, first, {
    redirect_uri: makeAbsoluteIfNecessary(redirect_uri, baseUri),
    silent_redirect_uri: makeAbsoluteIfNecessary(silent_redirect_uri, baseUri),
    post_logout_redirect_uri: makeAbsoluteIfNecessary(post_logout_redirect_uri, baseUri),
    silentRequestTimeout: first.silentRequestTimeout ?? SILENT_SIGNIN_TIMEOUT_MS,
  });
}

const cache = new Map<string, UserManagerLike>();

function cacheKey(first: OidcClientSettings, routerBasename: string): string {
  return `${first.authority}|${first.client_id}|${first.response_type ?? ''}|${routerBasename}`;
}

/**
 * The document's OIDC client for these settings — built on first use, shared
 * after. Returns undefined when there is no OIDC configuration.
 */
export function getOidcUserManager(
  oidc: OidcClientSettings[] | undefined | null,
  routerBasename: string
): UserManagerLike | undefined {
  if (!oidc || !oidc.length) {
    return undefined;
  }
  const first = oidc[0];
  const key = cacheKey(first, routerBasename);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const { protocol, host } = window.location;
  const settings = buildOidcClientSettings(first, routerBasename, `${protocol}//${host}`);
  const factory = first.response_type === 'code' ? NextClient : LegacyClient;
  const manager = factory(settings) as UserManagerLike | undefined;
  if (manager) {
    cache.set(key, manager);
  }
  return manager;
}

/** Tests only. */
export function resetOidcUserManagerCache(): void {
  cache.clear();
}
