import { User, UserManager } from 'oidc-client';
import { buildShellUser, readTokenClaims, setShellUserSink, storeShellUser } from './shellAuth';
import { isShellUser } from './preInitSignIn';

/** base64url of a JSON value, as a JWT segment. */
const segment = value =>
  btoa(unescape(encodeURIComponent(JSON.stringify(value))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
/** A JWT-shaped fake with these claims and a made-up signature; never a real token. */
const fakeJwt = claims => `${segment({ alg: 'RS256', typ: 'JWT' })}.${segment(claims)}.ZmFrZS1zaWduYXR1cmU`;

const EXP = Math.floor(Date.now() / 1000) + 600;
const CLAIMS = {
  exp: EXP,
  iat: EXP - 900,
  iss: 'https://auth.test/realms/r',
  azp: 'next-app',
  sub: 'f3c1a2b4-0000-4000-8000-000000000001',
  name: 'Zoë Ångström',
  preferred_username: 'zoe',
  email: 'zoe@example.test',
  given_name: 'Zoë',
  family_name: 'Ångström',
  scope: 'openid profile email',
  realm_access: { roles: ['gateway.aet.1.qido.users'] },
  session_state: 'not-carried',
};
const TOKEN = fakeJwt(CLAIMS);

/** ohif's config.js readAccessToken, the lookup /api/me/aets uses before the boot. */
function configReadAccessToken() {
  const storageKey = Object.keys(sessionStorage).find(key => key.startsWith('oidc.user'));
  if (storageKey) {
    const user = JSON.parse(sessionStorage.getItem(storageKey));
    const notExpired = !user || !user.expires_at || user.expires_at * 1000 > Date.now();
    if (user && user.access_token && notExpired) {
      return user.access_token;
    }
  }
  return null;
}

/** The document's client as oidc-client v1.11.5 builds it, without its timers and frames. */
const realManager = () =>
  new UserManager({
    authority: 'https://auth.test/realms/r/',
    client_id: 'ohif-viewer',
    automaticSilentRenew: false,
    monitorSession: false,
  });

afterEach(() => {
  sessionStorage.clear();
});

describe('buildShellUser', () => {
  it('is an oidc-client User of the token: Bearer, its expiry, its scope and profile; no id or refresh token', () => {
    const user = buildShellUser({ accessToken: TOKEN, expiresAt: EXP });
    expect(user).toBeInstanceOf(User);
    expect(user.access_token).toBe(TOKEN);
    expect(user.token_type).toBe('Bearer');
    expect(user.expires_at).toBe(EXP);
    expect(user.expired).toBe(false);
    expect(user.scope).toBe('openid profile email');
    // Only the six profile claims, decoded as UTF-8; roles, issuer and times stay in the token.
    expect(user.profile).toEqual({
      sub: CLAIMS.sub,
      name: 'Zoë Ångström',
      preferred_username: 'zoe',
      email: 'zoe@example.test',
      given_name: 'Zoë',
      family_name: 'Ångström',
      // The mark that tells a stored shell user from the viewer's own sign-in.
      pacsai_shell_auth: true,
    });
    expect(user.id_token).toBeUndefined();
    expect(user.refresh_token).toBeUndefined();
    expect(user.session_state).toBeUndefined();
    const stored = JSON.parse(user.toStorageString());
    expect(Object.keys(stored).sort()).toEqual(['access_token', 'expires_at', 'profile', 'scope', 'token_type']);
  });

  it('takes the expiry from the message, and builds a user from a token whose claims are unreadable', () => {
    const opaque = 'eyJhbGciOiJSUzI1NiJ9.bm90LWpzb24.c2ln';
    const user = buildShellUser({ accessToken: opaque, expiresAt: EXP - 60 });
    expect(user.access_token).toBe(opaque);
    expect(user.expires_at).toBe(EXP - 60);
    expect(user.profile).toEqual({ pacsai_shell_auth: true });
    expect(user.scope).toBeUndefined();
    // A claim of the wrong type is left out, not carried as is.
    const odd = buildShellUser({ accessToken: fakeJwt({ sub: 7, name: ['x'], scope: 1, email: 'a@b.test' }), expiresAt: EXP });
    expect(odd.profile).toEqual({ email: 'a@b.test', pacsai_shell_auth: true });
    expect(odd.scope).toBeUndefined();
  });

  it('reads claims as base64url JSON, and {} for anything else', () => {
    expect(readTokenClaims(TOKEN)).toEqual(CLAIMS);
    expect(readTokenClaims('a.b')).toEqual({});
    expect(readTokenClaims(`x.${segment([1, 2])}.y`)).toEqual({});
    expect(readTokenClaims(`x.${segment('text')}.y`)).toEqual({});
    expect(readTokenClaims('nodots')).toEqual({});
    expect(readTokenClaims('x.!!!.y')).toEqual({});
  });
});

describe('storeShellUser', () => {
  it('stores the user with the real oidc-client v1 client under oidc.user…, where config.js finds the token', async () => {
    const manager = realManager();
    expect(configReadAccessToken()).toBeNull();
    await storeShellUser(manager, { accessToken: TOKEN, expiresAt: EXP });
    const keys = Object.keys(sessionStorage);
    expect(keys).toEqual(['oidc.user:https://auth.test/realms/r/:ohif-viewer']);
    expect(keys[0].startsWith('oidc.user')).toBe(true);
    expect(configReadAccessToken()).toBe(TOKEN);
    // And the routes read it back at mount as an unexpired user.
    const user = await manager.getUser();
    expect(user.access_token).toBe(TOKEN);
    expect(user.expired).toBe(false);
    expect(user.profile.preferred_username).toBe('zoe');
    // Marked as the shell's, through oidc-client's own storage round trip.
    expect(isShellUser(user)).toBe(true);
  });

  it('replaces the stored user with a later token', async () => {
    const manager = realManager();
    await storeShellUser(manager, { accessToken: TOKEN, expiresAt: EXP });
    const next = fakeJwt({ ...CLAIMS, exp: EXP + 300 });
    await storeShellUser(manager, { accessToken: next, expiresAt: EXP + 300 });
    expect(Object.keys(sessionStorage)).toHaveLength(1);
    expect(configReadAccessToken()).toBe(next);
    expect((await manager.getUser()).expires_at).toBe(EXP + 300);
  });

  it('hands the stored user to the live sink, and to no sink once it unregistered', async () => {
    const manager = realManager();
    const live = [];
    const order = [];
    const storeUser = manager.storeUser.bind(manager);
    manager.storeUser = user => {
      order.push('store');
      return storeUser(user);
    };
    const unregister = setShellUserSink(user => {
      order.push('live');
      live.push(user);
    });
    await storeShellUser(manager, { accessToken: TOKEN, expiresAt: EXP });
    expect(order).toEqual(['store', 'live']);
    expect(live).toHaveLength(1);
    expect(live[0]).toBeInstanceOf(User);
    expect(live[0].access_token).toBe(TOKEN);

    // A newer sink replaces it; the older one's unregister leaves the newer alone.
    const newer = jest.fn();
    const unregisterNewer = setShellUserSink(newer);
    unregister();
    await storeShellUser(manager, { accessToken: TOKEN, expiresAt: EXP });
    expect(newer).toHaveBeenCalledTimes(1);
    expect(live).toHaveLength(1);
    unregisterNewer();
    await storeShellUser(manager, { accessToken: TOKEN, expiresAt: EXP });
    expect(newer).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored user when the sink throws, and rejects without a client', async () => {
    const manager = realManager();
    const unregister = setShellUserSink(() => {
      throw new Error('not mounted');
    });
    await expect(storeShellUser(manager, { accessToken: TOKEN, expiresAt: EXP })).resolves.toBeUndefined();
    expect(configReadAccessToken()).toBe(TOKEN);
    unregister();

    sessionStorage.clear();
    await expect(storeShellUser(undefined, { accessToken: TOKEN, expiresAt: EXP })).rejects.toThrow('no OIDC client');
    await expect(storeShellUser({}, { accessToken: TOKEN, expiresAt: EXP })).rejects.toThrow('no OIDC client');
    expect(Object.keys(sessionStorage)).toEqual([]);
  });

  it('writes nothing of the token to the console', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map(level => jest.spyOn(console, level).mockImplementation(() => undefined));
    try {
      const unregister = setShellUserSink(() => {
        throw new Error('not mounted');
      });
      await storeShellUser(realManager(), { accessToken: TOKEN, expiresAt: EXP });
      unregister();
      spies.forEach(spy => {
        spy.mock.calls.forEach(args => expect(JSON.stringify(args.map(String))).not.toContain(TOKEN.split('.')[1]));
      });
    } finally {
      spies.forEach(spy => spy.mockRestore());
    }
  });
});
