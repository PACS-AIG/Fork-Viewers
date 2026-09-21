jest.mock('./legacyOIDCClient', () => jest.fn(settings => ({ settings, kind: 'legacy', id: Math.random() })));
jest.mock('./nextOIDCClient', () => jest.fn(settings => ({ settings, kind: 'next', id: Math.random() })));

import LegacyClient from './legacyOIDCClient';
import NextClient from './nextOIDCClient';
import { buildOidcClientSettings, getOidcUserManager, resetOidcUserManagerCache, SILENT_SIGNIN_TIMEOUT_MS } from './oidcUserManager';

const oidc = [{ authority: 'https://auth.test/realms/r/', client_id: 'ohif', response_type: 'id_token token', redirect_uri: '/callback' }];

describe('getOidcUserManager', () => {
  beforeEach(() => {
    resetOidcUserManagerCache();
    LegacyClient.mockClear();
    NextClient.mockClear();
  });

  it('builds the client once per document and hands the same instance back', () => {
    const a = getOidcUserManager(oidc, '/viewer');
    const b = getOidcUserManager(oidc, '/viewer');
    expect(a).toBe(b);
    expect(LegacyClient).toHaveBeenCalledTimes(1);
    expect(NextClient).not.toHaveBeenCalled();
  });

  it('keeps clients apart by settings, and picks the code-flow client for response_type code', () => {
    const a = getOidcUserManager(oidc, '/viewer');
    const b = getOidcUserManager(oidc, '/other');
    const c = getOidcUserManager([{ ...oidc[0], response_type: 'code' }], '/viewer');
    expect(a).not.toBe(b);
    expect(c.kind).toBe('next');
    expect(getOidcUserManager([], '/viewer')).toBeUndefined();
    expect(getOidcUserManager(undefined, '/viewer')).toBeUndefined();
  });

  it('makes the redirect URIs absolute under the basename and sets the silent timeout', () => {
    const s = buildOidcClientSettings(oidc[0], '/viewer', 'https://viewer.test');
    expect(s.redirect_uri).toBe('https://viewer.test/viewer/callback');
    expect(s.silent_redirect_uri).toBe('https://viewer.test/viewer/silent-refresh.html');
    expect(s.post_logout_redirect_uri).toBe('https://viewer.test/viewer/');
    expect(s.silentRequestTimeout).toBe(SILENT_SIGNIN_TIMEOUT_MS);
    expect(buildOidcClientSettings({ ...oidc[0], redirect_uri: 'https://x.test/cb' }, '/viewer', 'https://viewer.test').redirect_uri).toBe('https://x.test/cb');
  });
});
