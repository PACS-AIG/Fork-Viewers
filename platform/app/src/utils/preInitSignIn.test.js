import { ErrorResponse as NextErrorResponse, ErrorTimeout as NextErrorTimeout } from 'oidc-client-ts';
import { preInitSignIn, stripBasename, isNoSessionError } from './preInitSignIn';

/**
 * oidc-client v1's ErrorResponse (its src/ErrorResponse.js; the bundle does not
 * export it): the OAuth code on `error`, the message its description, else the code.
 */
function v1ErrorResponse(error, error_description) {
  const err = new Error(error_description || error);
  err.name = 'ErrorResponse';
  err.error = error;
  err.error_description = error_description;
  return err;
}
/** oidc-client v1's own silentRequestTimeout (IFrameWindow). */
const v1FrameTimeout = () => new Error('Frame window timed out');
const NO_SESSION_CODES = ['login_required', 'interaction_required', 'consent_required', 'account_selection_required'];

/**
 * One silent sign-in: 'hang', 'reject' (login_required), { reject: value }, or
 * the user it resolves with. An array is one per call, the last one repeating.
 */
function silentOutcome(spec) {
  if (spec === 'hang') return new Promise(() => {});
  if (spec === 'reject') return Promise.reject(new Error('login_required'));
  if (spec && typeof spec === 'object' && 'reject' in spec) return Promise.reject(spec.reject);
  return Promise.resolve(spec);
}

function fakeManager({ stored = null, silent = 'reject', redirect = 'ok' } = {}) {
  const calls = [];
  let silentCalls = 0;
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
        const spec = Array.isArray(silent) ? silent[Math.min(silentCalls, silent.length - 1)] : silent;
        silentCalls++;
        return silentOutcome(spec);
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

  it('asks the provider once when not framed: a sign-in that got no answer redirects, as before', async () => {
    const hung = deps({ manager: { silent: ['hang', { expired: false, access_token: 't2' }] } });
    expect(await preInitSignIn(hung.deps)).toEqual({ action: 'redirect' });
    expect(hung.fm.calls).toEqual(['getUser', 'signinSilent', 'signinRedirect']);
    expect(hung.ready.count).toBe(0);

    const timedOut = deps({ manager: { silent: [{ reject: v1FrameTimeout() }, { expired: false, access_token: 't2' }] } });
    expect(await preInitSignIn(timedOut.deps)).toEqual({ action: 'redirect' });
    expect(timedOut.fm.calls).toEqual(['getUser', 'signinSilent', 'signinRedirect']);
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
    const required = {
      codes: [],
      get count() {
        return this.codes.length;
      },
    };
    d.required = required;
    d.deps = { ...d.deps, framed: true, onAuthRequired: code => required.codes.push(code) };
    return d;
  }

  it('reports auth-required without a session: no redirect, no redirect target, the shell told once', async () => {
    const d = framedDeps({ manager: { silent: 'reject' } });
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'auth-required', code: 'AUTH_REQUIRED' });
    expect(d.fm.calls).toEqual(['getUser', 'signinSilent']);
    expect(d.required.codes).toEqual(['AUTH_REQUIRED']);
    expect(d.stored.has('ohif-redirect-to')).toBe(false);
    expect(d.stored.size).toBe(0);
    expect(d.ready.count).toBe(0);
  });

  it('reports AUTH_UNAVAILABLE once when the silent sign-in did not answer, twice; AUTH_REQUIRED on an expired silent user', async () => {
    const hung = framedDeps({ manager: { silent: 'hang' } });
    expect(await preInitSignIn(hung.deps)).toEqual({ action: 'auth-required', code: 'AUTH_UNAVAILABLE' });
    expect(hung.fm.calls).toEqual(['getUser', 'signinSilent', 'signinSilent']);
    expect(hung.required.codes).toEqual(['AUTH_UNAVAILABLE']);
    expect(hung.stored.size).toBe(0);
    expect(hung.ready.count).toBe(0);

    // An expired user is the provider's answer: asking again gets the same.
    const expired = framedDeps({ manager: { stored: { expired: true }, silent: { expired: true } } });
    expect(await preInitSignIn(expired.deps)).toEqual({ action: 'auth-required', code: 'AUTH_REQUIRED' });
    expect(expired.fm.calls).toEqual(['getUser', 'signinSilent']);
    expect(expired.required.codes).toEqual(['AUTH_REQUIRED']);
  });

  it('keeps the outcome when the notifier throws', async () => {
    const d = framedDeps({ manager: { silent: 'reject' } });
    d.deps.onAuthRequired = code => {
      d.required.codes.push(code);
      throw new Error('bridge gone');
    };
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'auth-required', code: 'AUTH_REQUIRED' });
    expect(d.required.count).toBe(1);
    expect(d.fm.calls).not.toContain('signinRedirect');
  });

  // Live (N02-delayed, auth): with the frame's prompt=none authorize held, its
  // silent sign-in timed out and the frame said AUTH_REQUIRED while a top-level
  // prompt=none check from the same browser got tokens. No answer is not "no session".
  it('asks once more when the silent sign-in got no answer, and continues on the user', async () => {
    const user = { expired: false, access_token: 't2' };
    const noAnswers = [
      'hang',
      { reject: v1FrameTimeout() },
      { reject: new NextErrorTimeout('IFrame timed out without a response') },
      { reject: new TypeError('Failed to fetch') },
      { reject: v1ErrorResponse('temporarily_unavailable') },
    ];
    for (let i = 0; i < noAnswers.length; i++) {
      const d = framedDeps({ manager: { stored: { expired: true }, silent: [noAnswers[i], user] } });
      expect(await preInitSignIn(d.deps)).toEqual({ action: 'continue', via: 'silent' });
      expect(d.fm.calls).toEqual(['getUser', 'signinSilent', 'signinSilent']);
      expect(d.required.codes).toEqual([]);
      expect(d.ready.count).toBe(1);
      expect(d.stored.size).toBe(0);
    }
  });

  it('reports AUTH_UNAVAILABLE once, and never redirects, when the retry does not answer either', async () => {
    const pairs = [
      ['hang', 'hang'],
      [{ reject: v1FrameTimeout() }, 'hang'],
      ['hang', { reject: new TypeError('Failed to fetch') }],
      [{ reject: new NextErrorTimeout('IFrame timed out without a response') }, { reject: v1ErrorResponse('server_error') }],
    ];
    for (let i = 0; i < pairs.length; i++) {
      const d = framedDeps({ manager: { silent: pairs[i] } });
      expect(await preInitSignIn(d.deps)).toEqual({ action: 'auth-required', code: 'AUTH_UNAVAILABLE' });
      expect(d.fm.calls).toEqual(['getUser', 'signinSilent', 'signinSilent']);
      expect(d.required.codes).toEqual(['AUTH_UNAVAILABLE']);
      expect(d.stored.size).toBe(0);
      expect(d.ready.count).toBe(0);
    }
  });

  it('reports AUTH_REQUIRED without a retry when the provider answers that there is no session', async () => {
    const answers = [];
    NO_SESSION_CODES.forEach(code => {
      answers.push(v1ErrorResponse(code)); // v1, no description: the message is the code
      answers.push(v1ErrorResponse(code, 'The user is not signed in.')); // v1: `error` carries it
      answers.push(new NextErrorResponse({ error: code, error_description: 'Not signed in' })); // oidc-client-ts
      answers.push(new Error(code)); // only the message
    });
    for (let i = 0; i < answers.length; i++) {
      const d = framedDeps({ manager: { silent: [{ reject: answers[i] }, { expired: false, access_token: 't2' }] } });
      expect(await preInitSignIn(d.deps)).toEqual({ action: 'auth-required', code: 'AUTH_REQUIRED' });
      expect(d.fm.calls).toEqual(['getUser', 'signinSilent']);
      expect(d.required.codes).toEqual(['AUTH_REQUIRED']);
    }
  });

  it('reports AUTH_REQUIRED when the retry answers that there is no session', async () => {
    const d = framedDeps({ manager: { silent: ['hang', { reject: v1ErrorResponse('login_required') }] } });
    expect(await preInitSignIn(d.deps)).toEqual({ action: 'auth-required', code: 'AUTH_REQUIRED' });
    expect(d.fm.calls).toEqual(['getUser', 'signinSilent', 'signinSilent']);
    expect(d.required.codes).toEqual(['AUTH_REQUIRED']);
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

  it('tells an identity provider\'s no-session answer from no answer', () => {
    NO_SESSION_CODES.forEach(code => {
      expect(isNoSessionError(v1ErrorResponse(code, 'Login required'))).toBe(true);
      expect(isNoSessionError(new NextErrorResponse({ error: code }))).toBe(true);
      expect(isNoSessionError(new Error(code))).toBe(true);
      expect(isNoSessionError(`error=${code}&state=abc`)).toBe(true);
    });
    // Another OAuth error, even one whose description names a no-session code: `error` decides.
    expect(isNoSessionError(v1ErrorResponse('server_error', 'login_required upstream'))).toBe(false);
    expect(isNoSessionError(new NextErrorResponse({ error: 'temporarily_unavailable' }))).toBe(false);
    expect(isNoSessionError(v1FrameTimeout())).toBe(false);
    expect(isNoSessionError(new NextErrorTimeout('IFrame timed out without a response'))).toBe(false);
    expect(isNoSessionError(new Error('silent sign-in timed out'))).toBe(false);
    expect(isNoSessionError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isNoSessionError(new Error('xlogin_required_y'))).toBe(false);
    expect(isNoSessionError('No response returned from token endpoint')).toBe(false);
    expect(isNoSessionError(null)).toBe(false);
    expect(isNoSessionError(undefined)).toBe(false);
    expect(isNoSessionError({})).toBe(false);
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
