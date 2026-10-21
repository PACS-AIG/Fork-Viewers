/**
 * Entry point for development and production PWA builds.
 */
import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import App from './App';
import React from 'react';

/**
 * EXTENSIONS AND MODES
 * =================
 * pluginImports.js is dynamically generated from extension and mode
 * configuration at build time.
 *
 * pluginImports.js imports all of the modes and extensions and adds them
 * to the window for processing.
 */
import { modes as defaultModes, extensions as defaultExtensions } from './pluginImports';
import loadDynamicConfig from './loadDynamicConfig';
import { utils as ohifUtils } from '@ohif/core';
import { preInitSignIn, isUsableShellToken } from './utils/preInitSignIn';
import { writeAuthRequiredNotice } from './utils/embedAuth';
import { storeShellUser } from './utils/shellAuth';
import {
  installAppSignInHook,
  isReadingWindow,
  noteAppRenewal,
  readAppToken,
  setAppSignInState,
  watchAppSignIn,
} from './utils/appSignIn';
import {
  installEmbedBridge,
  getEmbedBridge,
  isFramed,
} from '@ohif/extension-pacsai-hp/src/embed/browser';
import { getOidcUserManager } from './utils/oidcUserManager';
import { publicUrl as viewerPublicUrl } from './utils/publicUrl';
export { history } from './utils/history';
export { preserveQueryParameters, preserveQueryStrings } from './utils/preserveQueryParameters';
export { publicUrl } from './utils/publicUrl';

// B01 (Rev 11 milestone 2): resolve this document's viewer attempt first, so
// every later stage — including a failure before React mounts — is recorded
// against the launcher's click.
ohifUtils.attempt.init();

// Rev 11 milestone 6 part 2: the cross-frame protocol with the report window
// (pacsai.embed/1). Installed before the sign-in, so an AUTH_REQUIRED from it
// is queued for the shell until the handshake binds; inert unless framed by an
// allowed origin. A failure here must not stop the boot.
try {
  installEmbedBridge();
} catch (err) {
  console.warn('[pacsai] embed bridge not installed:', err);
}

/**
 * B02 part 3: sign in before the boot. The runtime config (app-config.js)
 * publishes its OIDC settings as window.PACSAI_OIDC so they are known before
 * window.config() runs; with a session at the identity provider the silent
 * sign-in returns the user and the app boots once, with a token; without one
 * the redirect happens now instead of after a boot that would be thrown away.
 * Any unexpected failure lets the boot proceed exactly as before. Framed by
 * the report window (milestone 6 part 2), the sign-in page refuses to be
 * framed: without a user the shell is told and this document does not boot —
 * AUTH_REQUIRED, or AUTH_UNAVAILABLE when the identity provider did not answer.
 *
 * The sign-in handoff (milestone 6, pacsai.embed/1 §6): framed with an active
 * bridge, the report window's own access token is waited for first and stored
 * as this document's user; each later one (the app refreshes it) replaces the
 * stored user and the live one.
 *
 * The reading window (milestone 6, approach C, 21 Oct 2026; ./utils/appSignIn):
 * top level on the app's origin, it is signed in with the app's sign-in when the
 * app says so (its switch and its session), and Keycloak is not asked; the
 * app's later tokens replace the user while the window is open.
 */
const routerBasename = String(viewerPublicUrl || '/').replace(/\/$/, '') || '/';
const embedBridge = getEmbedBridge();
const readingWindow = isReadingWindow({
  pathname: window.location.pathname,
  readingDock: window.PACSAI_READING_DOCK,
  framed: isFramed(),
});
const readApp = () => readAppToken((input, init) => window.fetch(input, init));
const storeShellToken = token =>
  storeShellUser(getOidcUserManager(window.PACSAI_OIDC, routerBasename), token);
/** The token the boot stored, until the later-token listener has skipped its replay. */
let bootShellToken = null;
const preInit = preInitSignIn({
  oidc: window.PACSAI_OIDC,
  routerBasename,
  location: { pathname: window.location.pathname, search: window.location.search },
  getUserManager: getOidcUserManager,
  storage: (() => {
    try {
      return window.sessionStorage;
    } catch (_) {
      return null;
    }
  })(),
  onAuthReady: () => ohifUtils.attempt.mark('auth_ready'),
  framed: isFramed(),
  onAuthRequired: code => {
    ohifUtils.attempt.fail(code, 'auth_ready');
    getEmbedBridge()?.authRequired(code);
  },
  shellToken: embedBridge ? () => embedBridge.whenShellAuth() : undefined,
  storeShellUser:
    embedBridge || readingWindow
      ? token =>
          storeShellToken(token).then(() => {
            bootShellToken = token;
          })
      : undefined,
  appToken: readingWindow
    ? () => readApp().then(r => (r.kind === 'token' ? r.token : null))
    : undefined,
}).catch(err => {
  console.warn('[pacsai] pre-init sign-in skipped:', err);
  return { action: 'continue', via: 'none', reason: String(err) };
});

preInit.then(outcome => {
  if (outcome.action === 'redirect') {
    // The document is on its way to the sign-in page; nothing to boot here.
    return;
  }
  if (outcome.action === 'auth-required') {
    // Framed without a user: the report window offers the sign-in in a
    // top-level window; nothing to boot here, only a notice in the frame.
    writeAuthRequiredNotice(document, window.location.href, outcome.code);
    // A token from the report window that came after the wait (a late hello):
    // a new document is handed it at once (§6), so reload once.
    // Once a minute at most, so a token that keeps arriving late cannot loop.
    embedBridge?.onAuthToken(token => {
      if (!isUsableShellToken(token, Date.now())) {
        return;
      }
      try {
        const last = Number(window.sessionStorage.getItem('pacsai.shellAuthReloadAt'));
        if (Number.isFinite(last) && Date.now() - last < 60000) {
          return;
        }
        window.sessionStorage.setItem('pacsai.shellAuthReloadAt', String(Date.now()));
      } catch (_) {
        return; // no storage to guard the reload with: the card stands
      }
      window.location.reload();
    });
    return;
  }
  if (outcome.action === 'continue' && outcome.via === 'app' && bootShellToken) {
    // The reading window, signed in with the app's sign-in: the viewer's own
    // renewal would ask Keycloak, so it stops; the app's newer tokens replace
    // the user, and the end of the app session holds the token back until the
    // reader signs in again (the report's own sign-in line).
    setAppSignInState({ active: true, ended: false });
    installAppSignInHook(window);
    try {
      getOidcUserManager(window.PACSAI_OIDC, routerBasename)?.stopSilentRenew?.();
    } catch (_) {
      /* no client to stop: nothing renews */
    }
    watchAppSignIn({
      current: bootShellToken,
      read: readApp,
      store: token => storeShellToken(token).then(noteAppRenewal),
      onEnded: () => {
        setAppSignInState({ ended: true });
        console.warn(
          '[pacsai] the app session has ended: no token is sent until the reader signs in again'
        );
      },
      onBack: () => setAppSignInState({ ended: false }),
      win: window,
    });
  }
  if (outcome.action === 'continue' && embedBridge) {
    // Told the held token at once (the boot's own is stored already), then
    // each new one. One nearly expired is not taken, as at the boot.
    embedBridge.onAuthToken(token => {
      if (token === bootShellToken || !isUsableShellToken(token, Date.now())) {
        return;
      }
      storeShellToken(token).catch(() => {
        console.warn("[pacsai] the report window's sign-in could not be stored");
      });
    });
    bootShellToken = null;
  }
  return loadDynamicConfig(window.config).then(config_json => {
  // Reset Dynamic config if defined
  if (config_json !== null) {
    window.config = config_json;
  }

  /**
   * Combine our appConfiguration with installed extensions and modes.
   * In the future appConfiguration may contain modes added at runtime.
   *  */
  const appProps = {
    config: window ? window.config : {},
    defaultExtensions,
    defaultModes,
  };

  const container = document.getElementById('root');

  const root = createRoot(container);
  root.render(React.createElement(App, appProps));
  });
});
