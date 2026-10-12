/**
 * The sign-in handoff (Rev 11 milestone 6, the app's
 * docs/rev11/m6-embed-protocol.md §6): the report window hands its access
 * token to the framed viewer (`shell.auth`), and the viewer uses it as this
 * document's user, so a reader signed in to the app is signed in to the frame.
 *
 * The user is an oidc-client (v1) User built from the token alone: the access
 * token, `Bearer`, its expiry, and the scope and profile from its claims; no
 * id token, no refresh token. It goes where the viewer's own sign-in keeps its
 * user: the document's UserManager stores it in sessionStorage under
 * `oidc.user:<authority>:<client_id>`, where config.js's readAccessToken finds
 * it for /api/me/aets before the boot and OpenIdConnectRoutes reads it at
 * mount. A later token replaces the stored user and, through the sink the
 * routes register, the live one the requests' Authorization header is read
 * from. The token is never logged and never put in a URL.
 */
import { User } from 'oidc-client';
import type { UserManagerLike } from './oidcUserManager';
import { SHELL_USER_MARK, type ShellToken } from './preInitSignIn';

/** The claims a profile carries over from the token; nothing else of it is kept. */
const PROFILE_CLAIMS = ['sub', 'name', 'preferred_username', 'email', 'given_name', 'family_name'];

/**
 * The token's claims (its middle segment, base64url JSON); {} when they are
 * not readable. Read, not verified: the archive verifies the token it is sent.
 */
export function readTokenClaims(accessToken: string): Record<string, unknown> {
  try {
    const segment = accessToken.split('.')[1] ?? '';
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
    // The bytes are UTF-8: a name with accents survives.
    const text = decodeURIComponent(
      Array.from(binary, c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
    );
    const claims = JSON.parse(text);
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : {};
  } catch (_) {
    return {};
  }
}

/** The oidc-client v1 User for the shell's token. */
export function buildShellUser(token: ShellToken): User {
  const claims = readTokenClaims(token.accessToken);
  const profile: Record<string, string> = {};
  PROFILE_CLAIMS.forEach(claim => {
    const value = claims[claim];
    if (typeof value === 'string') {
      profile[claim] = value;
    }
  });
  return new User({
    access_token: token.accessToken,
    token_type: 'Bearer',
    expires_at: token.expiresAt,
    scope: typeof claims.scope === 'string' ? claims.scope : undefined,
    // Marked as the shell's (preInitSignIn's SHELL_USER_MARK).
    profile: { ...profile, [SHELL_USER_MARK]: true },
  } as unknown as ConstructorParameters<typeof User>[0]);
}

type ShellUserSink = (user: User) => void;
let liveSink: ShellUserSink | null = null;

/**
 * Where a later token's user goes live: OpenIdConnectRoutes registers
 * userAuthenticationService.setUser while it is mounted. Returns the
 * unregister (which leaves a newer sink alone).
 */
export function setShellUserSink(sink: ShellUserSink): () => void {
  liveSink = sink;
  return () => {
    if (liveSink === sink) {
      liveSink = null;
    }
  };
}

/**
 * Store the shell's token as this document's user with the document's
 * UserManager, then hand it to the live user when the app is up (before, the
 * routes read the stored one at mount). Rejects when there is no client.
 */
export async function storeShellUser(
  userManager: Pick<UserManagerLike, 'storeUser'> | undefined,
  token: ShellToken
): Promise<void> {
  if (!userManager?.storeUser) {
    throw new Error('no OIDC client to store the user in');
  }
  const user = buildShellUser(token);
  await userManager.storeUser(user);
  try {
    liveSink?.(user);
  } catch (_) {
    /* the stored user stands: the routes read it at their next mount */
  }
}
