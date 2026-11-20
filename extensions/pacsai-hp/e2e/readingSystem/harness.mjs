#!/usr/bin/env node
/**
 * RS-36: the end-to-end harness for the CT reading system's pane (the gate
 * ct-analysis-system calls rs-editor-ui runs it, and so can anyone locally).
 *
 * One HTTP server, Node's built-ins only, standing in for what serves the
 * viewer on dev:
 *   - the built viewer (platform/app/dist, built with PUBLIC_URL=/), with the
 *     single-page app's fallback to index.html;
 *   - /app-config.js: its own viewer config (READING_DOCK on, the reading
 *     system's API at /rs-api in fixture mode, a DICOMweb data source that has
 *     no studies: the fixture studies have no images anywhere);
 *   - /rs-api/*: forwarded to the reading system's served API (RS_API_URL)
 *     with the bearer token read from RS_API_TOKEN_FILE, as the app's proxy
 *     route does on dev, so the browser never holds the token;
 *   - /api/workspace/flags: the app's flags, saying the report editor (the
 *     island) is not offered here, so the island's cover says so and stays
 *     out of the way;
 *   - /dicomweb/*: an archive with nothing in it;
 *   - test helpers that keep study UIDs out of the tests and their logs:
 *     /rs-e2e/open?fixture=<key> redirects to the radcopilot route for the
 *     fixture study whose snapshot id is fx-<key> (found in the API's outbox),
 *     and /rs-e2e/doc?fixture=<key>&route=<path> answers that study's
 *     /studies/{uid}/<path> through the same forwarding.
 *
 * Environment:
 *   RS_API_URL          the served API (default http://127.0.0.1:8300); http only
 *   RS_API_TOKEN_FILE   the file holding its bearer token (required; never printed)
 *   RS_E2E_PORT         this server's port (default 3036)
 *   RS_E2E_DIST         the built viewer (default <repo>/platform/app/dist)
 *   RS_E2E_POLL_MS      the pane's poll interval (default 1000)
 *   HTTP_PROXY / NO_PROXY  a non-loopback API goes through the proxy (WeiWei's rule)
 *
 * It prints one ready line and nothing that names a token, a study or a URL's
 * credentials.
 */
import { createReadStream, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const DIST = path.resolve(process.env.RS_E2E_DIST || path.join(repo, 'platform/app/dist'));
const PORT = Number(process.env.RS_E2E_PORT || 3036);
const POLL_MS = Number(process.env.RS_E2E_POLL_MS || 1000);
const API = new URL(process.env.RS_API_URL || 'http://127.0.0.1:8300');
if (API.protocol !== 'http:') {
  console.error('rs-e2e harness: RS_API_URL must be an http:// URL (a loopback server or a tunnel to one)');
  process.exit(2);
}
const tokenFile = process.env.RS_API_TOKEN_FILE;
if (!tokenFile) {
  console.error('rs-e2e harness: RS_API_TOKEN_FILE names the file holding the API token');
  process.exit(2);
}
const TOKEN = readFileSync(tokenFile, 'utf8').trim();
if (TOKEN.length < 32) {
  console.error('rs-e2e harness: the token file holds fewer than 32 characters');
  process.exit(2);
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy || '';
const bypass = host =>
  LOOPBACK.has(host) || noProxy.some(n => host === n || (n.startsWith('.') && host.endsWith(n)));
const PROXY = proxyUrl && !bypass(API.hostname) ? new URL(proxyUrl) : null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function appConfig(origin) {
  const dicomweb = `${origin}/dicomweb`;
  const config = {
    name: 'rs-e2e harness',
    routerBasename: '/',
    extensions: [],
    modes: [],
    showStudyList: false,
    maxNumberOfWebWorkers: 1,
    showWarningMessageForCrossOrigin: false,
    showCPUFallbackMessage: false,
    showLoadingIndicator: false,
    strictZSpacingForVolumeViewport: true,
    defaultDataSourceName: 'dicomweb',
    dataSources: [
      {
        namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
        sourceName: 'dicomweb',
        configuration: {
          friendlyName: 'An archive with no studies',
          name: 'rs-e2e',
          wadoUriRoot: dicomweb,
          qidoRoot: dicomweb,
          wadoRoot: dicomweb,
          qidoSupportsIncludeField: false,
          imageRendering: 'wadors',
          thumbnailRendering: 'wadors',
          enableStudyLazyLoad: true,
          supportsFuzzyMatching: false,
          supportsWildcard: false,
          staticWado: true,
          singlepart: 'bulkdata,video,pdf',
        },
      },
    ],
  };
  return [
    `window.config = ${JSON.stringify(config, null, 2)};`,
    // The reading dock (the report column) and the CT reading system's pane at its top.
    `window.PACSAI_READING_DOCK = '1';`,
    `window.PACSAI_READING_SYSTEM_API = '/rs-api';`,
    `window.PACSAI_READING_SYSTEM_MODE = 'fixture';`,
    `window.PACSAI_READING_SYSTEM_POLL_MS = ${JSON.stringify(POLL_MS)};`,
    '',
  ].join('\n');
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function forward(req, res, rest) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const target = new URL(rest, API);
    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      Accept: req.headers.accept || 'application/json',
      Host: target.host,
    };
    if (body.length) {
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
      headers['Content-Length'] = String(body.length);
    }
    const options = PROXY
      ? {
          host: PROXY.hostname,
          port: Number(PROXY.port || 80),
          path: target.href,
          method: req.method,
          headers,
        }
      : {
          host: target.hostname,
          port: Number(target.port || 80),
          path: `${target.pathname}${target.search}`,
          method: req.method,
          headers,
        };
    const upstream = http.request(options, up => {
      res.writeHead(up.statusCode || 502, {
        'Content-Type': up.headers['content-type'] || 'application/json',
        'Cache-Control': 'no-store',
      });
      up.pipe(res);
    });
    upstream.on('error', () => send(res, 502, 'application/json', '{"detail":"the reading system API did not answer"}'));
    upstream.end(body);
  });
}

/** GET a path of the API with the token, as a buffer and status (for the helpers). */
function apiGet(rest) {
  return new Promise((resolve, reject) => {
    const target = new URL(rest, API);
    const headers = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', Host: target.host };
    const options = PROXY
      ? { host: PROXY.hostname, port: Number(PROXY.port || 80), path: target.href, headers }
      : { host: target.hostname, port: Number(target.port || 80), path: `${target.pathname}${target.search}`, headers };
    http
      .get(options, up => {
        const chunks = [];
        up.on('data', c => chunks.push(c));
        up.on('end', () => resolve({ status: up.statusCode || 502, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}

/** The study whose fixture snapshot is fx-<key>, from the API's outbox (paged), or null. */
async function fixtureStudy(key) {
  const want = `fx-${key}`;
  let after = 0;
  for (;;) {
    const { status, body } = await apiGet(`/outbox?after=${after}&limit=1000`);
    if (status !== 200) {
      return null;
    }
    const lines = body.toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const e = JSON.parse(line);
      after = Math.max(after, Number(e.sequence) || 0);
      if (e.type === 'snapshot.compiled' && e.snapshotId === want && e.studyUID) {
        return e.studyUID;
      }
    }
    if (lines.length < 1000) {
      return null;
    }
  }
}

async function helper(req, res, url) {
  const key = url.searchParams.get('fixture') || '';
  if (!/^[a-z0-9_]+$/.test(key)) {
    return send(res, 400, 'text/plain', 'fixture=<key>, a fixture key');
  }
  let study;
  try {
    study = await fixtureStudy(key);
  } catch (_) {
    return send(res, 502, 'text/plain', 'the reading system API did not answer');
  }
  if (!study) {
    return send(res, 404, 'text/plain', `no study for fixture ${key}`);
  }
  if (url.pathname === '/rs-e2e/open') {
    const q = new URLSearchParams({ StudyInstanceUIDs: study });
    res.writeHead(302, { Location: `/radcopilot?${q.toString()}`, 'Cache-Control': 'no-store' });
    return res.end();
  }
  const route = url.searchParams.get('route') || '';
  if (!/^[a-z_]+(\?[a-z=&_]*)?$/.test(route)) {
    return send(res, 400, 'text/plain', 'route=<the study route>, e.g. report?version=published');
  }
  const { status, body } = await apiGet(`/studies/${encodeURIComponent(study)}/${route}`);
  return send(res, status, 'application/json', body);
}

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    return send(res, 403, 'text/plain', 'forbidden');
  }
  let stat = null;
  try {
    stat = statSync(file);
  } catch (_) {
    stat = null;
  }
  if (stat && stat.isFile()) {
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': String(stat.size),
    });
    return createReadStream(file).pipe(res);
  }
  if (path.extname(pathname)) {
    return send(res, 404, 'text/plain', 'not found');
  }
  // The single-page app's routes (/radcopilot, /notfoundstudy, ...).
  return serveStatic(req, res, '/index.html');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const { pathname } = url;
  if (pathname === '/rs-api' || pathname.startsWith('/rs-api/')) {
    return forward(req, res, `${pathname.slice('/rs-api'.length) || '/'}${url.search}`);
  }
  if (pathname === '/rs-e2e/open' || pathname === '/rs-e2e/doc') {
    return void helper(req, res, url).catch(() => send(res, 500, 'text/plain', 'helper failed'));
  }
  if (pathname === '/app-config.js') {
    return send(res, 200, MIME['.js'], appConfig(url.origin));
  }
  if (pathname === '/api/workspace/flags') {
    return send(res, 200, 'application/json', JSON.stringify({ viewerHost: false }));
  }
  if (pathname.startsWith('/dicomweb')) {
    return send(res, 200, 'application/dicom+json', '[]');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain', 'method not allowed');
  }
  return serveStatic(req, res, pathname === '/' ? '/index.html' : pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `rs-e2e harness on http://127.0.0.1:${PORT} (viewer: ${path.relative(repo, DIST) || DIST}; reading system API: ${
      LOOPBACK.has(API.hostname) ? 'loopback' : PROXY ? 'through the proxy' : 'direct'
    })`
  );
});
