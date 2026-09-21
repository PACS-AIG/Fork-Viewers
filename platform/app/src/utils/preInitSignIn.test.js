import { preInitSignIn, stripBasename } from './preInitSignIn';

function fakeManager({ stored = null, silent = 'reject', redirect = 'ok' } = {}) {
  const calls = [];
  return {
    calls,
    manager: {
      settings: {},
      getUser: async () => {
        calls.push('getUser');
        return stored;
      },
      signinSilent: () => {
        calls.push('signinSilent');
        if (silent === 'hang') return new Promise(() => {});
        if (silent === 'reject') return Promise.reject(new Error('login_required'));
        return Promise.resolve(silent);
      },
      signinRedirect: async () => {
        calls.push('signinRedirect');
        if (redirect === 'throw') throw new Error('popup blocked');
      },
    },
  };
}

const oidc = [{ authority: 'https://auth.test/realms/r/', client_id: 'ohif', response_type: 'id_token token' }];
const base = { routerBasename: '/viewer', location: { pathname: '/viewer/viewer', search: '?StudyInstanceUIDs=1' } };

function deps(extra) {
  const stored = new Map();
  const fm = fakeManager(extra.manager);
  const ready = { count: 0 };
  return {
    fm,
    stored,
    ready,
    deps: {
      ...base,
      oidc,
      getUserManager: () => fm.manager,
      storage: { setItem: (k, v) => stored.set(k, v) },
      onAuthReady: () => ready.count++,
      silentTimeoutMs: 50,
      ...extra.deps,
    },
  };
}

describe('preInitSignIn', () => {
  it('skips without OIDC settings, on the code flow, and on the auth routes', async () => {
    expect(await preInitSignIn({ ...deps({}).deps, oidc: undefined })).toEqual({ action: 'skip', reason: 'no-oidc' });
    expect(await preInitSignIn({ ...deps({}).deps, oidc: [{ authority: 'a', client_id: 'c', response_type: 'code' }] })).toEqual({ action: 'skip', reason: 'code-flow' });
    // (a classic loop: this package's babel/regenerator cannot compile for…of around await)
    const authPaths = ['/viewer/callback', '/viewer/logout', '/viewer/login', '/viewer/silent-refresh.html', '/viewer/logout-redirect.html'];
    for (let i = 0; i < authPaths.length; i++) {
      const d = deps({});
      expect(await preInitSignIn({ ...d.deps, location: { pathname: authPaths[i], search: '' } })).toEqual({ action: 'skip', reason: 'auth-route' });
      expect(d.fm.calls).toEqual([]);
    }
  });

  it('continues at once with a stored, unexpired user', async () => {
    const d = deps({ manager: { stored: { expired: false, access_token: 't' } } });
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'continue', via: 'storage' });
    expect(d.fm.calls).toEqual(['getUser']);
    expect(d.ready.count).toBe(1);
  });

  it('signs in silently when the provider still has a session, without leaving the document', async () => {
    const d = deps({ manager: { stored: { expired: true }, silent: { expired: false, access_token: 't2' } } });
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'continue', via: 'silent' });
    expect(d.fm.calls).toEqual(['getUser', 'signinSilent']);
    expect(d.ready.count).toBe(1);
    expect(d.stored.size).toBe(0);
  });

  it('redirects before any boot when the silent sign-in is refused, remembering the router-relative path', async () => {
    const d = deps({ manager: { silent: 'reject' } });
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'redirect' });
    expect(d.fm.calls).toEqual(['getUser', 'signinSilent', 'signinRedirect']);
    expect(JSON.parse(d.stored.get('ohif-redirect-to'))).toEqual({ pathname: '/viewer', search: '?StudyInstanceUIDs=1' });
    expect(d.ready.count).toBe(0);
  });

  it('treats a hanging silent sign-in as refused after the guard timeout', async () => {
    const d = deps({ manager: { silent: 'hang' } });
    const started = Date.now();
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'redirect' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('never blocks the boot: a failing redirect lets the app continue as before', async () => {
    const d = deps({ manager: { silent: 'reject', redirect: 'throw' } });
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'continue', via: 'none', reason: 'popup blocked' });
  });

  it('strips the router basename the way the routes store the redirect target', () => {
    expect(stripBasename('/viewer/viewer/viewer', '/viewer')).toBe('/viewer/viewer');
    expect(stripBasename('/viewer/', '/viewer')).toBe('/');
    expect(stripBasename('/viewer', '/viewer')).toBe('/');
    expect(stripBasename('/other', '/viewer')).toBe('/other');
    expect(stripBasename('/x', '/')).toBe('/x');
  });
});
