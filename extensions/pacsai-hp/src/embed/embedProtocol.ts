/**
 * pacsai.embed/1 — the cross-frame protocol between the report window (the
 * shell) and this viewer when it runs in the shell's frame (Rev 11 milestone 6
 * part 2). The pure half: no DOM, no globals.
 *
 * The contract is the app repo's docs/rev11/m6-embed-protocol.md (§1). The app
 * implements the same rules in src/app/lib/frameProtocol.ts, and both sides
 * pin one set of golden vectors: embedProtocol.vectors.json here is the SAME
 * bytes as the app's frameProtocol.vectors.json, and EMBED_VECTORS_SHA256 is
 * their hash. A protocol change is a change to both copies, both constants and
 * both modules.
 */

export const EMBED_PROTOCOL = 'pacsai.embed';
export const EMBED_VERSION = 1;
export const EMBED_VECTORS_SHA256 =
  'b17036cb31484d097be1091920f6fcf149fe5245625b7f6d3b564d65192ed3dd';

/** The attempt trace's 13 stages, in ATTEMPT_STAGES order (platform/core attemptTrace.ts). */
export const EMBED_STAGES = [
  'launch',
  'auth_ready',
  'config_ready',
  'runtime_ready',
  'engine_created',
  'container_sized',
  'metadata_loaded',
  'first_pixels',
  'image_rendered_matching_study',
  'tools_ready',
  'retry_requested',
  'cancelled',
  'failed',
] as const;
export type EmbedStage = (typeof EMBED_STAGES)[number];

/**
 * The seventh, `viewer.caps`, is slice 2's (the app's docs/rev11/m6-case-switch.md
 * §6), added at the end; a slice-1 parser drops it as `unknown-type`.
 */
export const EMBED_TYPES = [
  'viewer.hello',
  'viewer.ready',
  'viewer.error',
  'shell.hello',
  'shell.study',
  'shell.visibility',
  'viewer.caps',
] as const;
export type EmbedType = (typeof EMBED_TYPES)[number];

/**
 * What this viewer document advertises in `viewer.caps`: a CLOSED set, in
 * sorted order. `case-switch`: it switches cases inside the document. A new
 * token is a protocol change (both copies, the vectors and the hash), never an
 * extra token a parser skips.
 */
export const EMBED_CAPS = ['case-switch'] as const;
export type EmbedCap = (typeof EMBED_CAPS)[number];

export type EmbedDirection = 'toShell' | 'toViewer';

/** Parse failures, in the order they are checked; the first one found is reported. */
export const EMBED_PARSE_REASONS = [
  'not-object',
  'wrong-protocol',
  'wrong-version',
  'bad-envelope',
  'unknown-type',
  'wrong-direction',
  'bad-nonce',
  'bad-generation',
  'bad-payload',
] as const;
export type EmbedParseReason = (typeof EMBED_PARSE_REASONS)[number];

/** Foreign traffic (oidc-client's silent-renew frames, dev tooling): ignored, never an alarm. */
export const EMBED_FOREIGN_REASONS: readonly EmbedParseReason[] = ['not-object', 'wrong-protocol'];

export type EmbedVisibility = 'visible' | 'parked';

interface Envelope<T extends EmbedType, N extends string | null, P> {
  protocol: typeof EMBED_PROTOCOL;
  version: typeof EMBED_VERSION;
  type: T;
  nonce: N;
  caseGeneration: number;
  payload: P;
}

export type ViewerHelloMessage = Envelope<'viewer.hello', null, { documentId: string }>;
export type ViewerReadyMessage = Envelope<
  'viewer.ready',
  string,
  { documentId: string; attemptId: string; attemptGeneration: number; shown: boolean }
>;
export type ViewerErrorMessage = Envelope<
  'viewer.error',
  string,
  { documentId: string; code: string; stage: EmbedStage }
>;
export type ViewerCapsMessage = Envelope<
  'viewer.caps',
  string,
  { documentId: string; caps: EmbedCap[] }
>;
export type ShellHelloMessage = Envelope<'shell.hello', string, { documentId: string }>;
export type ShellStudyMessage = Envelope<
  'shell.study',
  string,
  { studyInstanceUid: string; gatewayAet: string }
>;
export type ShellVisibilityMessage = Envelope<
  'shell.visibility',
  string,
  { state: EmbedVisibility; width: number; height: number }
>;

export type ToShellMessage =
  | ViewerHelloMessage
  | ViewerReadyMessage
  | ViewerErrorMessage
  | ViewerCapsMessage;
export type ToViewerMessage = ShellHelloMessage | ShellStudyMessage | ShellVisibilityMessage;
export type EmbedMessage = ToShellMessage | ToViewerMessage;
export type EmbedMessageOf<T extends EmbedType> = Extract<EmbedMessage, { type: T }>;

export type EmbedParseResult<M extends EmbedMessage = EmbedMessage> =
  | { ok: true; message: M }
  | { ok: false; reason: EmbedParseReason };

export interface EmbedFields<T extends EmbedType> {
  nonce: EmbedMessageOf<T>['nonce'];
  caseGeneration: number;
  payload: EmbedMessageOf<T>['payload'];
}

const ENVELOPE_KEYS = ['protocol', 'version', 'type', 'nonce', 'caseGeneration', 'payload'];
const MAX_GENERATION = 2147483647;
const MAX_FRAME_PX = 100000;

const ID = /^[A-Za-z0-9_-]{22,64}$/;
const ATTEMPT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
/** The attempt trace's ERROR_CODE rule. */
const ERROR_CODE = /^[A-Z0-9_]{3,40}$/;
const STUDY_UID = /^[0-9]+(\.[0-9]+)*$/;
const GATEWAY_AET = /^[A-Za-z0-9_.-]([A-Za-z0-9 _.-]*[A-Za-z0-9_.-])?$/;
const EXACT_ORIGIN = /^(https?):\/\/[a-z0-9.-]+(?::([0-9]{1,5}))?$/;

type Check = (value: unknown) => boolean;

const isString = (v: unknown): v is string => typeof v === 'string';

/** A session nonce or a document id: `^[A-Za-z0-9_-]{22,64}$`. */
export function isEmbedId(value: unknown): value is string {
  return isString(value) && ID.test(value);
}

export function isEmbedAttemptId(value: unknown): value is string {
  return isString(value) && ATTEMPT_ID.test(value);
}

export function isEmbedErrorCode(value: unknown): value is string {
  return isString(value) && ERROR_CODE.test(value);
}

export function isEmbedStage(value: unknown): value is EmbedStage {
  return isString(value) && (EMBED_STAGES as readonly string[]).includes(value);
}

/**
 * A `viewer.caps` list: a non-empty array of tokens from EMBED_CAPS, each after
 * the one before it (so sorted, and no token twice). An unknown token makes the
 * list invalid rather than being skipped: the set is closed.
 */
export function isEmbedCaps(value: unknown): value is EmbedCap[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const cap: unknown = value[i];
    if (!isString(cap) || !(EMBED_CAPS as readonly string[]).includes(cap)) {
      return false;
    }
    if (i > 0 && !(value[i - 1] < cap)) {
      return false;
    }
  }
  return true;
}

function isEmbedType(value: unknown): value is EmbedType {
  return isString(value) && (EMBED_TYPES as readonly string[]).includes(value);
}

/** An integer 1…2147483647 (caseGeneration off the hello, attemptGeneration). */
function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_GENERATION;
}

const isFramePx: Check = v =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_FRAME_PX;
const isStudyUid: Check = v => isString(v) && v.length <= 64 && STUDY_UID.test(v);
const isGatewayAet: Check = v => isString(v) && v.length <= 64 && GATEWAY_AET.test(v);
const isVisibility: Check = v => v === 'visible' || v === 'parked';
const isBoolean: Check = v => typeof v === 'boolean';

/** Each type's payload: exactly these keys, in this (canonical) order. */
const PAYLOADS: { readonly [T in EmbedType]: ReadonlyArray<readonly [string, Check]> } = {
  'viewer.hello': [['documentId', isEmbedId]],
  'viewer.ready': [
    ['documentId', isEmbedId],
    ['attemptId', isEmbedAttemptId],
    ['attemptGeneration', isGeneration],
    ['shown', isBoolean],
  ],
  'viewer.error': [
    ['documentId', isEmbedId],
    ['code', isEmbedErrorCode],
    ['stage', isEmbedStage],
  ],
  'shell.hello': [['documentId', isEmbedId]],
  'shell.study': [
    ['studyInstanceUid', isStudyUid],
    ['gatewayAet', isGatewayAet],
  ],
  'shell.visibility': [
    ['state', isVisibility],
    ['width', isFramePx],
    ['height', isFramePx],
  ],
  'viewer.caps': [
    ['documentId', isEmbedId],
    ['caps', isEmbedCaps],
  ],
};

function directionOf(type: EmbedType): EmbedDirection {
  return type.startsWith('viewer.') ? 'toShell' : 'toViewer';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every(k => own.includes(k));
}

/** A fresh payload in canonical key order, or null when it breaks the type's rule. */
function canonicalPayload(type: EmbedType, payload: unknown): Record<string, unknown> | null {
  const spec = PAYLOADS[type];
  if (!isPlainObject(payload) || !hasExactly(payload, spec.map(([key]) => key))) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, check] of spec) {
    const value = payload[key];
    if (!check(value)) {
      return null;
    }
    // An array (viewer.caps) is copied too: the message is ours, not the caller's.
    out[key] = Array.isArray(value) ? value.slice() : value;
  }
  return out;
}

const fail = (reason: EmbedParseReason): { ok: false; reason: EmbedParseReason } => ({
  ok: false,
  reason,
});

/**
 * Validate one received message. `toShell` accepts only `viewer.*`, `toViewer`
 * only `shell.*`. Returns a fresh canonical copy, or the FIRST failure in
 * EMBED_PARSE_REASONS order.
 */
export function parseEmbedMessage(raw: unknown, direction: 'toShell'): EmbedParseResult<ToShellMessage>;
export function parseEmbedMessage(raw: unknown, direction: 'toViewer'): EmbedParseResult<ToViewerMessage>;
export function parseEmbedMessage(raw: unknown, direction: EmbedDirection): EmbedParseResult;
export function parseEmbedMessage(raw: unknown, direction: EmbedDirection): EmbedParseResult {
  if (!isPlainObject(raw)) {
    return fail('not-object');
  }
  if (raw.protocol !== EMBED_PROTOCOL) {
    return fail('wrong-protocol');
  }
  if (raw.version !== EMBED_VERSION) {
    return fail('wrong-version');
  }
  if (!hasExactly(raw, ENVELOPE_KEYS)) {
    return fail('bad-envelope');
  }
  const { type, nonce, caseGeneration } = raw;
  if (!isEmbedType(type)) {
    return fail('unknown-type');
  }
  if (directionOf(type) !== direction) {
    return fail('wrong-direction');
  }
  const hello = type === 'viewer.hello';
  if (hello ? nonce !== null : !isEmbedId(nonce)) {
    return fail('bad-nonce');
  }
  if (hello ? caseGeneration !== 0 : !isGeneration(caseGeneration)) {
    return fail('bad-generation');
  }
  const payload = canonicalPayload(type, raw.payload);
  if (!payload) {
    return fail('bad-payload');
  }
  const message = {
    protocol: EMBED_PROTOCOL,
    version: EMBED_VERSION,
    type,
    nonce,
    caseGeneration,
    payload,
  };
  // Every field was checked against its type's rule just above.
  return { ok: true, message: message as unknown as EmbedMessage };
}

/**
 * Build one message to send: validated exactly as parseEmbedMessage validates
 * it (in the type's own direction), in the canonical key order for the
 * envelope and the payload. Throws on anything invalid.
 */
export function buildEmbedMessage<T extends EmbedType>(type: T, fields: EmbedFields<T>): EmbedMessageOf<T> {
  if (!isEmbedType(type)) {
    throw new Error(`pacsai.embed: cannot build ${String(type)}: unknown-type`);
  }
  const result = parseEmbedMessage(
    {
      protocol: EMBED_PROTOCOL,
      version: EMBED_VERSION,
      type,
      nonce: fields?.nonce,
      caseGeneration: fields?.caseGeneration,
      payload: fields?.payload,
    },
    directionOf(type)
  );
  if (result.ok === false) {
    throw new Error(`pacsai.embed: cannot build ${type}: ${result.reason}`);
  }
  return result.message as EmbedMessageOf<T>;
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url without padding (no btoa: this module touches no globals). */
function base64url(bytes: ArrayLike<number>): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63] + BASE64URL[(n >> 6) & 63] + BASE64URL[n & 63];
  }
  const rest = bytes.length - i;
  if (rest > 0) {
    const n = (bytes[i] << 16) | (rest === 2 ? bytes[i + 1] << 8 : 0);
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
    if (rest === 2) {
      out += BASE64URL[(n >> 6) & 63];
    }
  }
  return out;
}

function cryptoRandomBytes(n: number): Uint8Array {
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!source?.getRandomValues) {
    throw new Error('pacsai.embed: crypto.getRandomValues is unavailable');
  }
  const bytes = new Uint8Array(n);
  source.getRandomValues(bytes);
  return bytes;
}

const ID_BYTES = 16;

/** A document id or session nonce: 16 random bytes, base64url, 22 characters. */
export function mintEmbedId(randomBytes: (n: number) => Uint8Array = cryptoRandomBytes): string {
  const bytes = randomBytes(ID_BYTES);
  if (!bytes || bytes.length < ID_BYTES) {
    throw new Error('pacsai.embed: the random source returned too few bytes');
  }
  return base64url(Array.from(bytes).slice(0, ID_BYTES));
}

/**
 * The allow-list as published (window.PACSAI_EMBED_ORIGINS): only strings that
 * are exact origins once lower-cased (no path, no wildcard, no quotes, not
 * 'null'), deduplicated, in their order. Anything that is not an array is none.
 *
 * Each is kept in the form a browser's event.origin carries, since the bridge
 * compares exactly: the scheme's default port (https :443, http :80) is
 * stripped, and a port with a leading zero or above 65535 drops the entry (no
 * event.origin is ever written so). The deploy repo's entrypoint.sh and
 * config.js apply the same rule.
 */
export function normalizeEmbedOrigins(list: unknown): string[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const out: string[] = [];
  for (const item of list) {
    if (!isString(item)) {
      continue;
    }
    let origin = item.toLowerCase();
    const match = EXACT_ORIGIN.exec(origin);
    if (!match) {
      continue;
    }
    const [, scheme, port] = match;
    if (port !== undefined) {
      if (port.charAt(0) === '0' || Number(port) > 65535) {
        continue;
      }
      if ((scheme === 'https' && port === '443') || (scheme === 'http' && port === '80')) {
        origin = origin.slice(0, origin.length - port.length - 1);
      }
    }
    if (!out.includes(origin)) {
      out.push(origin);
    }
  }
  return out;
}
