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

// Rev 11 milestone 6 part 2: framed by the report window, the sign-in page
// (which refuses to be framed) is never the answer.
describe('preInitSignIn framed', () => {
  function framedDeps(extra) {
    const d = deps(extra);
    const required = { count: 0 };
    d.required = required;
    d.deps = { ...d.deps, framed: true, onAuthRequired: () => required.count++ };
    return d;
  }

  it('reports auth-required without a session: no redirect, no redirect target, the shell told once', async () => {
    const d = framedDeps({ manager: { silent: 'reject' } });
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'auth-required' });
    expect(d.fm.calls).toEqual(['getUser', 'signinSilent']);
    expect(d.required.count).toBe(1);
    expect(d.stored.has('ohif-redirect-to')).toBe(false);
    expect(d.stored.size).toBe(0);
    expect(d.ready.count).toBe(0);
  });

  it('reports auth-required after the silent guard timeout, and on an expired silent user', async () => {
    const hung = framedDeps({ manager: { silent: 'hang' } });
    expect(await preInitSignIn(hung.deps)).toEqual({ action: 'auth-required' });
    expect(hung.fm.calls).not.toContain('signinRedirect');
    expect(hung.required.count).toBe(1);

    const expired = framedDeps({ manager: { stored: { expired: true }, silent: { expired: true } } });
    expect(await preInitSignIn(expired.deps)).toEqual({ action: 'auth-required' });
    expect(expired.fm.calls).toEqual(['getUser', 'signinSilent']);
    expect(expired.required.count).toBe(1);
  });

  it('keeps the outcome when the notifier throws', async () => {
    const d = framedDeps({ manager: { silent: 'reject' } });
    d.deps.onAuthRequired = () => {
      d.required.count++;
      throw new Error('bridge gone');
    };
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'auth-required' });
    expect(d.required.count).toBe(1);
    expect(d.fm.calls).not.toContain('signinRedirect');
  });

  it('continues with a stored user, as when not framed', async () => {
    const d = framedDeps({ manager: { stored: { expired: false, access_token: 't' } } });
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'continue', via: 'storage' });
    expect(d.fm.calls).toEqual(['getUser']);
    expect(d.ready.count).toBe(1);
    expect(d.required.count).toBe(0);
  });

  it('continues with a silent sign-in, as when not framed', async () => {
    const d = framedDeps({ manager: { stored: { expired: true }, silent: { expired: false, access_token: 't2' } } });
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'continue', via: 'silent' });
    expect(d.fm.calls).toEqual(['getUser', 'signinSilent']);
    expect(d.ready.count).toBe(1);
    expect(d.required.count).toBe(0);
    expect(d.stored.size).toBe(0);
  });

  it('skips exactly as when not framed: no OIDC settings, the code flow, the auth routes, no client', async () => {
    const noOidc = framedDeps({});
    expect(await preInitSignIn({ ...noOidc.deps, oidc: undefined })).toEqual({ action: 'skip', reason: 'no-oidc' });
    const codeFlow = framedDeps({});
    expect(await preInitSignIn({ ...codeFlow.deps, oidc: [{ authority: 'a', client_id: 'c', response_type: 'code' }] })).toEqual({ action: 'skip', reason: 'code-flow' });
    const noClient = framedDeps({});
    expect(await preInitSignIn({ ...noClient.deps, getUserManager: () => undefined })).toEqual({ action: 'skip', reason: 'no-client' });
    const skipped = [noOidc, codeFlow, noClient];
    // (a classic loop: this package's babel/regenerator cannot compile for…of around await)
    const authPaths = ['/viewer/callback', '/viewer/logout', '/viewer/login', '/viewer/silent-refresh.html', '/viewer/logout-redirect.html'];
    for (let i = 0; i < authPaths.length; i++) {
      const d = framedDeps({});
      expect(await preInitSignIn({ ...d.deps, location: { pathname: authPaths[i], search: '' } })).toEqual({ action: 'skip', reason: 'auth-route' });
      skipped.push(d);
    }
    for (let i = 0; i < skipped.length; i++) {
      expect(skipped[i].fm.calls).toEqual([]);
      expect(skipped[i].required.count).toBe(0);
      expect(skipped[i].stored.size).toBe(0);
    }
  });

  it('framed: false is the redirect path, unchanged', async () => {
    const d = deps({ manager: { silent: 'reject' } });
    const required = { count: 0 };
    expect(await preInitSignIn({ ...d.deps, framed: false, onAuthRequired: () => required.count++ })).toEqual({ action: 'redirect' });
    expect(d.fm.calls).toEqual(['getUser', 'signinSilent', 'signinRedirect']);
    expect(required.count).toBe(0);
    expect(JSON.parse(d.stored.get('ohif-redirect-to'))).toEqual({ pathname: '/viewer', search: '?StudyInstanceUIDs=1' });
  });
});
