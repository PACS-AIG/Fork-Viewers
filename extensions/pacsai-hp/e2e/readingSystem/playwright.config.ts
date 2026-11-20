/**
 * RS-36: the end-to-end tests of the CT reading system's pane, the tests the
 * ct-analysis-system gate `rs-editor-ui` runs at a pinned commit of this fork
 * (see README.md beside this file). They drive the built viewer through the
 * harness (harness.mjs) against the reading system's served API in fixture
 * mode. The fork's own upstream Playwright setup (playwright.config.ts at the
 * repository root) is OHIF's, for OHIF's test data; this one is separate.
 *
 *   node_modules/.bin/playwright test -c extensions/pacsai-hp/e2e/readingSystem/playwright.config.ts
 *
 * Environment: the harness's (RS_API_URL, RS_API_TOKEN_FILE, RS_E2E_PORT,
 * RS_E2E_DIST), RS_E2E_LATE_RESULT (the command that commits a fixture's late
 * result into the served record; `{fixture}` is replaced by the fixture key)
 * and RS_E2E_CHANNEL (`chrome` to drive an installed Google Chrome instead of
 * Playwright's own Chromium). With a proxy in the environment the browser goes
 * through it, except loopback and the DICOM archives (arc-dev.pacsai.net,
 * arc.pacsai.net), which go direct.
 */
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.RS_E2E_PORT || 3036);
const proxyServer =
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const DIRECT_HOSTS = ['arc-dev.pacsai.net', 'arc.pacsai.net'];
const bypass = [
  ...(process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1,::1').split(','),
  ...DIRECT_HOSTS,
]
  .map(s => s.trim())
  .filter(Boolean)
  .join(',');

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.e2e\.ts$/,
  outputDir: path.join(__dirname, 'test-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.RS_E2E_REPORT || path.join(__dirname, 'test-results', 'rs-editor-ui.json') }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.RS_E2E_CHANNEL || undefined,
    headless: true,
    viewport: { width: 1600, height: 1000 },
    proxy: proxyServer ? { server: proxyServer, bypass } : undefined,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  webServer: {
    command: `node ${JSON.stringify(path.join(__dirname, 'harness.mjs'))}`,
    url: `http://127.0.0.1:${PORT}/app-config.js`,
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
