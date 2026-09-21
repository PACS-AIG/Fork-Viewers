import React from 'react';
import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import CallbackPage from '../routes/CallbackPage';
import SignoutCallbackComponent from '../routes/SignoutCallbackComponent';
import { getOidcUserManager } from './oidcUserManager';

function _isAbsoluteUrl(url) {
  return url.includes('http://') || url.includes('https://');
}

function _makeAbsoluteIfNecessary(url, base_url) {
  if (_isAbsoluteUrl(url)) {
    return url;
  }

  /*
   * Make sure base_url and url are not duplicating slashes.
   */
  if (base_url[base_url.length - 1] === '/') {
    base_url = base_url.slice(0, base_url.length - 1);
  }

  return base_url + url;
}

// The client is built once per document in ./oidcUserManager (B02 part 3):
// a new one per render used to start a new session monitor and renew timer
// each time — the duplicate login-status frames.
const initUserManager = (oidc, routerBasename) => getOidcUserManager(oidc, routerBasename);

function LogoutComponent(props) {
  const { userManager } = props;
  localStorage.setItem('signoutEvent', 'true');
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  userManager.signoutRedirect({
    post_logout_redirect_uri: query.get('redirect_uri'),
  });
  return null;
}

function LoginComponent(userManager) {
  const queryParams = new URLSearchParams(location.search);
  const iss = queryParams.get('iss');
  const loginHint = queryParams.get('login_hint');
  const targetLinkUri = queryParams.get('target_link_uri');
  if (iss !== oidcAuthority) {
    console.error('iss of /login does not match the oidc authority');
    return null;
  }

  userManager.removeUser().then(() => {
    if (targetLinkUri !== null) {
      const ohifRedirectTo = {
        pathname: new URL(targetLinkUri).pathname,
      };
      sessionStorage.setItem('ohif-redirect-to', JSON.stringify(ohifRedirectTo));
    } else {
      const ohifRedirectTo = {
        pathname: '/',
      };
      sessionStorage.setItem('ohif-redirect-to', JSON.stringify(ohifRedirectTo));
    }

    if (loginHint !== null) {
      userManager.signinRedirect({ login_hint: loginHint });
    } else {
      userManager.signinRedirect();
    }
  });

  return null;
}

function OpenIdConnectRoutes({ oidc, routerBasename, userAuthenticationService }) {
  const userManager = initUserManager(oidc, routerBasename);

  const getAuthorizationHeader = () => {
    const user = userAuthenticationService.getUser();

    // if the user is null return early, next time
    // we hit this function we will have a user
    if (!user) {
      return;
    }

    return {
      Authorization: `Bearer ${user.access_token}`,
    };
  };

  const handleUnauthenticated = () => {
    // Note: Don't await the redirect. If you make this component async it
    // causes a react error before redirect as it returns a promise of a component rather than a component.
    userManager.signinRedirect();

    // return null because this is used in a react component
    return null;
  };

  const navigate = useNavigate();

  //for multi-tab logout
  useEffect(() => {
    localStorage.removeItem('signoutEvent');
    const storageEventListener = event => {
      const signOutEvent = localStorage.getItem('signoutEvent');
      if (signOutEvent) {
        navigate(`/logout?redirect_uri=${encodeURIComponent(window.location.href)}`);
      }
    };

    window.addEventListener('storage', storageEventListener);

    return () => {
      window.removeEventListener('storage', storageEventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    userAuthenticationService.setServiceImplementation({
      getAuthorizationHeader,
      handleUnauthenticated,
    });

    // B02 part 3: a user this document already holds — from the pre-init
    // silent sign-in, or from an earlier sign-in in this tab — is the user.
    // Enabling the gate before that lookup sent every document to the
    // identity provider, token in storage or not.
    const enable = () => {
      if (!cancelled) {
        userAuthenticationService.set({ enabled: true });
      }
    };
    if (userManager?.getUser) {
      userManager
        .getUser()
        .then(user => {
          if (!cancelled && user && !user.expired) {
            userAuthenticationService.setUser(user);
          }
          enable();
        })
        .catch(enable);
    } else {
      enable();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const oidcAuthority = oidc[0].authority;

  const location = useLocation();
  const { pathname, search } = location;

  const redirectURI = userManager.settings._redirect_uri ?? userManager.settings.redirect_uri;
  const silentRedirectURI =
    userManager.settings._silent_redirect_uri ?? userManager.settings.silent_redirect_uri;
  const postLogoutRedirectURI =
    userManager.settings._post_logout_redirect_uri ?? userManager.settings.post_logout_redirect_uri;

  const redirect_uri = new URL(redirectURI).pathname.replace(
    routerBasename !== '/' ? routerBasename : '',
    ''
  );
  const silent_refresh_uri = new URL(silentRedirectURI).pathname; //.replace(routerBasename,'')
  const post_logout_redirect_uri = new URL(postLogoutRedirectURI).pathname; //.replace(routerBasename,'');

  // const pathnameRelative = pathname.replace(routerBasename,'');

  if (pathname !== redirect_uri) {
    sessionStorage.setItem('ohif-redirect-to', JSON.stringify({ pathname, search }));
  }

  return (
    <Routes>
      <Route
        path={silent_refresh_uri}
        onEnter={window.location.reload}
      />
      <Route
        path={post_logout_redirect_uri}
        element={
          <SignoutCallbackComponent
            userManager={userManager}
            successCallback={() => console.log('Signout successful')}
            errorCallback={error => {
              console.warn(error);
              console.warn('Signout failed');
            }}
          />
        }
      />
      <Route
        path={redirect_uri}
        element={
          <CallbackPage
            userManager={userManager}
            onRedirectSuccess={user => {
              const { pathname, search = '' } = JSON.parse(
                sessionStorage.getItem('ohif-redirect-to')
              );

              userAuthenticationService.setUser(user);

              navigate({
                pathname,
                search,
              });
            }}
          />
        }
      />
      <Route
        path="/login"
        element={
          <LoginComponent
            userManager={userManager}
            oidcAuthority={oidcAuthority}
          />
        }
      />
      <Route
        path="/logout"
        element={<LogoutComponent userManager={userManager} />}
      />
    </Routes>
  );
}

export default OpenIdConnectRoutes;
