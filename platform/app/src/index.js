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
import { preInitSignIn } from './utils/preInitSignIn';
import { getOidcUserManager } from './utils/oidcUserManager';
import { publicUrl as viewerPublicUrl } from './utils/publicUrl';
export { history } from './utils/history';
export { preserveQueryParameters, preserveQueryStrings } from './utils/preserveQueryParameters';
export { publicUrl } from './utils/publicUrl';

// B01 (Rev 11 milestone 2): resolve this document's viewer attempt first, so
// every later stage — including a failure before React mounts — is recorded
// against the launcher's click.
ohifUtils.attempt.init();

/**
 * B02 part 3: sign in before the boot. The runtime config (app-config.js)
 * publishes its OIDC settings as window.PACSAI_OIDC so they are known before
 * window.config() runs; with a session at the identity provider the silent
 * sign-in returns the user and the app boots once, with a token; without one
 * the redirect happens now instead of after a boot that would be thrown away.
 * Any unexpected failure lets the boot proceed exactly as before.
 */
const routerBasename = String(viewerPublicUrl || '/').replace(/\/$/, '') || '/';
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
}).catch(err => {
  console.warn('[pacsai] pre-init sign-in skipped:', err);
  return { action: 'continue', via: 'none', reason: String(err) };
});

preInit.then(outcome => {
  if (outcome.action === 'redirect') {
    // The document is on its way to the sign-in page; nothing to boot here.
    return;
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
