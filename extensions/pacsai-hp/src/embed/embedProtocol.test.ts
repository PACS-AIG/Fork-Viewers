import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import { utils } from '@ohif/core';
import {
  buildEmbedMessage,
  parseEmbedMessage,
  isEmbedId,
  mintEmbedId,
  normalizeEmbedOrigins,
  EMBED_PARSE_REASONS,
  EMBED_PROTOCOL,
  EMBED_STAGES,
  EMBED_TYPES,
  EMBED_VECTORS_SHA256,
  EMBED_VERSION,
  type EmbedDirection,
  type EmbedFields,
  type EmbedType,
} from './embedProtocol';

interface ParseVector {
  name: string;
  direction: EmbedDirection;
  raw: unknown;
  ok: boolean;
  reason?: string;
}

interface BuildVector {
  name: string;
  /** Not always a real type: 'an unknown type throws'. */
  type: EmbedType;
  fields: EmbedFields<EmbedType>;
  json?: string;
  throws?: boolean;
}

// The file's own bytes: the app's frameProtocol.vectors.json must be the same.
const VECTORS_BYTES = readFileSync(join(__dirname, 'embedProtocol.vectors.json'));
const vectors: {
  protocol: string;
  version: number;
  checkOrder: string[];
  parse: ParseVector[];
  build: BuildVector[];
} = JSON.parse(VECTORS_BYTES.toString('utf8'));

describe('the golden vectors (the app pins the same bytes)', () => {
  it('hash to EMBED_VECTORS_SHA256', () => {
    expect(createHash('sha256').update(VECTORS_BYTES).digest('hex')).toBe(EMBED_VECTORS_SHA256);
    expect(EMBED_VECTORS_SHA256).toBe('ae68964be8e2e105bbdee95810e0746d8e14b0faec4b89d6f04109e2dbec1c32');
  });

  it('name this protocol, version and check order', () => {
    expect(vectors.protocol).toBe(EMBED_PROTOCOL);
    expect(vectors.version).toBe(EMBED_VERSION);
    expect(vectors.checkOrder).toEqual([...EMBED_PARSE_REASONS]);
    expect(vectors.parse).toHaveLength(58);
    expect(vectors.build).toHaveLength(11);
  });

  describe('parse', () => {
    it.each(vectors.parse)('$name', v => {
      const result = parseEmbedMessage(v.raw, v.direction);
      if (v.ok) {
        expect(result).toEqual({ ok: true, message: v.raw });
        // A fresh copy, never the caller's object.
        if (result.ok) {
          expect(result.message).not.toBe(v.raw);
          expect(result.message.payload).not.toBe((v.raw as { payload: unknown }).payload);
        }
      } else {
        expect(result).toEqual({ ok: false, reason: v.reason });
      }
    });
  });

  describe('build', () => {
    it.each(vectors.build)('$name', v => {
      if (v.throws) {
        expect(() => buildEmbedMessage(v.type, v.fields)).toThrow();
      } else {
        expect(JSON.stringify(buildEmbedMessage(v.type, v.fields))).toBe(v.json);
      }
    });
  });
});

describe('parseEmbedMessage', () => {
  const hello = {
    protocol: 'pacsai.embed',
    version: 1,
    type: 'shell.hello',
    nonce: 'nonceABCDEFGHIJKLMNOPq',
    caseGeneration: 1,
    payload: { documentId: 'docIdABCDEFGHIJKLMNOPQ' },
  };

  it('returns the envelope and the payload in canonical key order', () => {
    const shuffled = {
      payload: { documentId: hello.payload.documentId },
      caseGeneration: 1,
      nonce: hello.nonce,
      type: 'shell.hello',
      version: 1,
      protocol: 'pacsai.embed',
    };
    const result = parseEmbedMessage(shuffled, 'toViewer');
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok && result.message)).toBe(JSON.stringify(hello));
  });

  it('reports the FIRST failure when several apply', () => {
    // wrong version AND an extra key AND a bad nonce: the version is checked first.
    expect(parseEmbedMessage({ ...hello, version: 2, extra: 1, nonce: 'x' }, 'toViewer')).toEqual({
      ok: false,
      reason: 'wrong-version',
    });
    // wrong direction AND a bad payload: the direction is checked first.
    expect(parseEmbedMessage({ ...hello, payload: {} }, 'toShell')).toEqual({
      ok: false,
      reason: 'wrong-direction',
    });
    // an extra key AND an unknown type: the envelope is checked first.
    expect(parseEmbedMessage({ ...hello, type: 'shell.bogus', extra: 1 }, 'toViewer')).toEqual({
      ok: false,
      reason: 'bad-envelope',
    });
    // a bad nonce AND a bad generation AND a bad payload: nonce, then generation.
    expect(parseEmbedMessage({ ...hello, nonce: 'x', caseGeneration: 0, payload: {} }, 'toViewer')).toEqual({
      ok: false,
      reason: 'bad-nonce',
    });
    expect(parseEmbedMessage({ ...hello, caseGeneration: 0, payload: {} }, 'toViewer')).toEqual({
      ok: false,
      reason: 'bad-generation',
    });
    const viewerHello = { ...hello, type: 'viewer.hello', nonce: hello.nonce, caseGeneration: 1 };
    expect(parseEmbedMessage(viewerHello, 'toShell')).toEqual({ ok: false, reason: 'bad-nonce' });
  });
});

describe('the stages', () => {
  it('are the attempt trace’s 13, in its order', () => {
    expect([...EMBED_STAGES]).toEqual([...utils.ATTEMPT_STAGES]);
    expect(EMBED_STAGES).toHaveLength(13);
    expect(EMBED_TYPES).toHaveLength(6);
  });
});

describe('isEmbedId and mintEmbedId', () => {
  it('accepts 22…64 base64url characters only', () => {
    expect(isEmbedId('a'.repeat(22))).toBe(true);
    expect(isEmbedId('a'.repeat(64))).toBe(true);
    expect(isEmbedId('a'.repeat(21))).toBe(false);
    expect(isEmbedId('a'.repeat(65))).toBe(false);
    expect(isEmbedId(`${'a'.repeat(21)}+`)).toBe(false);
    expect(isEmbedId(`${'a'.repeat(21)}=`)).toBe(false);
    expect(isEmbedId(null)).toBe(false);
    expect(isEmbedId(12345678901234567890123)).toBe(false);
  });

  it('mints 16 bytes as unpadded base64url, 22 characters', () => {
    const fixed = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 251) & 0xff);
    const id = mintEmbedId(fixed);
    expect(id).toHaveLength(22);
    expect(isEmbedId(id)).toBe(true);
    expect(id).toBe(Buffer.from(fixed(16)).toString('base64url'));
    // The alphabet's two url-safe characters come out as - and _, never + and /.
    const high = () => new Uint8Array(16).fill(0xff);
    expect(mintEmbedId(high)).toBe('_____________________w');
    const dashes = () => new Uint8Array(16).fill(0xfb);
    expect(mintEmbedId(dashes)).toBe(Buffer.from(dashes()).toString('base64url'));
    expect(mintEmbedId(dashes)).toContain('-');
    expect(mintEmbedId(() => new Uint8Array(16))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });

  it('asks the source for 16 bytes and refuses a short answer', () => {
    const asked: number[] = [];
    mintEmbedId(n => {
      asked.push(n);
      return new Uint8Array(n);
    });
    expect(asked).toEqual([16]);
    expect(() => mintEmbedId(() => new Uint8Array(15))).toThrow();
  });

  it('uses crypto.getRandomValues by default', () => {
    const a = mintEmbedId();
    const b = mintEmbedId();
    expect(isEmbedId(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('normalizeEmbedOrigins', () => {
  it('keeps exact origins, lower-cased, deduplicated, in order', () => {
    expect(
      normalizeEmbedOrigins([
        'https://app-dev.pacsai.net',
        'HTTP://LocalHost:3000',
        'http://localhost:3000',
        'https://app-dev.pacsai.net',
        'http://127.0.0.1:65535',
      ])
    ).toEqual(['https://app-dev.pacsai.net', 'http://localhost:3000', 'http://127.0.0.1:65535']);
  });

  it('drops paths, wildcards, quotes, null, other schemes and malformed ports', () => {
    expect(
      normalizeEmbedOrigins([
        'https://app.test/',
        'https://app.test/viewer',
        '*',
        "'self'",
        '"https://app.test"',
        'null',
        'ftp://app.test',
        'https://app.test:',
        'https://app.test:123456',
        'https://*.app.test',
        ' https://app.test',
        'https://app.test ',
        'https://user@app.test',
        'https://app.test?x=1',
        '',
      ])
    ).toEqual([]);
  });

  it('keeps a port of 1 to 65535 written without a leading zero', () => {
    expect(
      normalizeEmbedOrigins(['http://a.test:1', 'http://a.test:3000', 'https://a.test:8443', 'http://a.test:65535'])
    ).toEqual(['http://a.test:1', 'http://a.test:3000', 'https://a.test:8443', 'http://a.test:65535']);
  });

  it('keeps each origin in the form event.origin carries: no default port', () => {
    expect(
      normalizeEmbedOrigins([
        'https://app.test:443',
        'HTTP://LOCALHOST:80',
        'https://app.test',
        'http://localhost',
        // Another scheme's default is a real port.
        'http://app.test:443',
        'https://app.test:80',
      ])
    ).toEqual(['https://app.test', 'http://localhost', 'http://app.test:443', 'https://app.test:80']);
  });

  it('drops a port with a leading zero or above 65535, which no event.origin carries', () => {
    expect(
      normalizeEmbedOrigins([
        'http://localhost:03000',
        'https://app.test:0443',
        'http://app.test:080',
        'http://app.test:0',
        'http://app.test:00',
        'http://a.test:65536',
        'http://a.test:99999',
      ])
    ).toEqual([]);
  });

  it('skips non-strings and treats anything but an array as none', () => {
    expect(normalizeEmbedOrigins(['https://a.test', 7, null, undefined, {}, ['https://b.test']])).toEqual([
      'https://a.test',
    ]);
    expect(normalizeEmbedOrigins(undefined)).toEqual([]);
    expect(normalizeEmbedOrigins(null)).toEqual([]);
    expect(normalizeEmbedOrigins('https://a.test')).toEqual([]);
    expect(normalizeEmbedOrigins({ 0: 'https://a.test', length: 1 })).toEqual([]);
  });
});
