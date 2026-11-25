import { RsRefused } from './rsContract';
import { RsHttpError, createRsClient, normalizeBase, type FetchLike } from './rsClient';
import { makeInbox, makeReport, makeSnapshot, makeVersions } from './testDocs';
import { makeAnatomyDoc } from './anatomy/anatomyTestData';
import { makeShowcase } from './pathgrade/showcaseTestData';

type Call = { url: string; init?: Parameters<FetchLike>[1] };

function fakeFetch(answer: (url: string) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const { status, body } = answer(url);
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { calls, fetchFn };
}

describe('the reading system client (RS-36)', () => {
  it('reads the contract routes under the configured base, with the page credentials and never a token', async () => {
    const { calls, fetchFn } = fakeFetch(url =>
      url.includes('/report')
        ? { status: 200, body: makeReport() }
        : url.includes('/versions')
          ? { status: 200, body: makeVersions() }
          : url.includes('/inbox')
            ? { status: 200, body: makeInbox() }
            : { status: 200, body: makeSnapshot() }
    );
    const client = createRsClient({ base: '/rs-api/', mode: 'fixture', fetchFn });
    await client.report('a b', 'latest');
    await client.versions('a b');
    await client.inbox('a b');
    await client.snapshot('fx-test');
    expect(calls.map(c => c.url)).toEqual([
      '/rs-api/studies/a%20b/report?version=latest',
      '/rs-api/studies/a%20b/versions',
      '/rs-api/studies/a%20b/inbox',
      '/rs-api/snapshots/fx-test',
    ]);
    calls.forEach(c => {
      expect(c.init?.credentials).toBe('include');
      expect(JSON.stringify(c.init?.headers ?? {})).not.toMatch(/authorization/i);
    });
  });

  it('says a study is not served by its status, and refuses a document of another mode', async () => {
    const notServed = createRsClient({
      base: '/rs-api',
      mode: 'fixture',
      fetchFn: fakeFetch(() => ({ status: 404, body: {} })).fetchFn,
    });
    await expect(notServed.report('s')).rejects.toEqual(
      expect.objectContaining({ name: 'RsHttpError', status: 404 })
    );
    const clinical = createRsClient({
      base: '/rs-api',
      mode: 'clinical',
      fetchFn: fakeFetch(() => ({ status: 200, body: makeReport() })).fetchFn,
    });
    await expect(clinical.report('s')).rejects.toBeInstanceOf(RsRefused);
  });

  it.each([
    [200, 'applied'],
    [409, 'conflict'],
    [422, 'rejected'],
  ])('posts one event and takes HTTP %i (%s) as an answer', async (status, word) => {
    const answer = { artifact: 'intake_response', status: word, httpStatus: status, revision: 3 };
    const { calls, fetchFn } = fakeFetch(() => ({ status, body: answer }));
    const client = createRsClient({ base: '/rs-api', mode: 'fixture', fetchFn });
    await expect(client.postEvent({ eventId: 'e' } as never)).resolves.toEqual(answer);
    expect(calls[0].url).toBe('/rs-api/events');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe(JSON.stringify({ eventId: 'e' }));
    expect(calls[0].init?.credentials).toBe('include');
  });

  it('throws on any other status or an answer that is not an intake response', async () => {
    const down = createRsClient({
      base: '/rs-api',
      mode: 'fixture',
      fetchFn: fakeFetch(() => ({ status: 502, body: {} })).fetchFn,
    });
    await expect(down.postEvent({} as never)).rejects.toBeInstanceOf(RsHttpError);
    const odd = createRsClient({
      base: '/rs-api',
      mode: 'fixture',
      fetchFn: fakeFetch(() => ({ status: 200, body: { hello: 1 } })).fetchFn,
    });
    await expect(odd.postEvent({} as never)).rejects.toBeInstanceOf(RsRefused);
  });

  it('normalizes the configured base', () => {
    expect(normalizeBase(' /api/reading-system// ')).toBe('/api/reading-system');
    expect(normalizeBase(undefined)).toBe('');
    expect(normalizeBase(42)).toBe('');
  });

  it("reads a study's anatomy and its labelmaps under the base, with the page credentials (contract 1.10)", async () => {
    const calls: Call[] = [];
    const gz = new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]);
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return url.endsWith('/anatomy')
        ? { status: 200, ok: true, json: async () => makeAnatomyDoc() }
        : {
            status: 200,
            ok: true,
            json: async () => null,
            arrayBuffer: async () => gz.buffer.slice(0),
          };
    };
    const client = createRsClient({ base: '/api/reading-system', mode: 'clinical', fetchFn });
    const doc = await client.anatomy('a b');
    expect(doc.series[0].labelmaps).toHaveLength(3);
    const bytes = await client.anatomyFile('a b', '0.total.labels.nii.gz');
    expect(Array.from(bytes)).toEqual(Array.from(gz));
    expect(calls.map(c => c.url)).toEqual([
      '/api/reading-system/studies/a%20b/anatomy',
      '/api/reading-system/studies/a%20b/anatomy/0.total.labels.nii.gz',
    ]);
    calls.forEach(c => {
      expect(c.init?.credentials).toBe('include');
      expect(JSON.stringify(c.init?.headers ?? {})).not.toMatch(/authorization/i);
    });
    expect(calls[1].init?.headers?.Accept).toMatch(/application\/gzip/);
  });

  it("names only the contract's labelmap files, and says why an anatomy read failed", async () => {
    const { calls, fetchFn } = fakeFetch(url =>
      url.endsWith('/anatomy')
        ? { status: 404, body: { status: 'not_found' } }
        : { status: 502, body: null }
    );
    const client = createRsClient({ base: '/rs', mode: 'clinical', fetchFn });
    await expect(client.anatomy('s')).rejects.toEqual(expect.objectContaining({ status: 404 }));
    await expect(client.anatomyFile('s', '0.total.labels.nii.gz')).rejects.toBeInstanceOf(
      RsHttpError
    );
    const bad = [
      '../x.labels.nii.gz',
      '0.total.labels.nii.gz/..',
      '0.Total.labels.nii.gz',
      'a.total.labels.nii.gz',
      '',
    ];
    for (let n = 0; n < bad.length; n++) {
      await expect(client.anatomyFile('s', bad[n])).rejects.toBeInstanceOf(RsRefused);
    }
    expect(calls).toHaveLength(2);
    const noBytes = createRsClient({
      base: '/rs',
      mode: 'clinical',
      fetchFn: async () => ({ status: 200, ok: true, json: async () => null }),
    });
    await expect(noBytes.anatomyFile('s', '0.total.labels.nii.gz')).rejects.toThrow(
      /cannot read a labelmap/
    );
    const fixture = createRsClient({
      base: '/rs',
      mode: 'fixture',
      fetchFn: async () => ({ status: 200, ok: true, json: async () => makeAnatomyDoc() }),
    });
    await expect(fixture.anatomy('s')).rejects.toThrow(/clinical documents/);
  });

  it("reads PathGrade's showcase and its pictures under the base, and keeps the API's words when none is served", async () => {
    const calls: Array<{ url: string; accept?: string; credentials?: string }> = [];
    const answers: Record<string, { status: number; body?: unknown; bytes?: Uint8Array }> = {
      '/rs/showcase/pathgrade': { status: 200, body: makeShowcase() },
      '/rs/showcase/pathgrade/outline_KiTS-00001.png': {
        status: 200,
        bytes: new Uint8Array([1, 2]),
      },
    };
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, accept: init?.headers?.Accept, credentials: init?.credentials });
      const a = answers[url] ?? { status: 404, body: { detail: 'no such picture' } };
      return {
        status: a.status,
        ok: a.status === 200,
        json: async () => a.body,
        arrayBuffer: async () => (a.bytes ?? new Uint8Array(0)).buffer as ArrayBuffer,
      };
    };
    const client = createRsClient({ base: '/rs', mode: 'fixture', fetchFn });
    expect((await client.showcase()).title).toBe('PathGrade on public kidney tumours');
    expect([...(await client.showcaseImage('outline_KiTS-00001.png'))]).toEqual([1, 2]);
    await expect(client.showcaseImage('missing.png')).rejects.toEqual(
      expect.objectContaining({ status: 404 })
    );
    expect(calls).toEqual([
      { url: '/rs/showcase/pathgrade', accept: 'application/json', credentials: 'include' },
      {
        url: '/rs/showcase/pathgrade/outline_KiTS-00001.png',
        accept: 'image/png',
        credentials: 'include',
      },
      { url: '/rs/showcase/pathgrade/missing.png', accept: 'image/png', credentials: 'include' },
    ]);
    // Only the contract's picture names are asked for.
    const bad = [
      '../showcase.json',
      'a.PNG',
      '.hidden.png',
      'x/y.png',
      `${'a'.repeat(97)}.png`,
      '',
    ];
    for (let n = 0; n < bad.length; n++) {
      await expect(client.showcaseImage(bad[n])).rejects.toBeInstanceOf(RsRefused);
    }
    expect(calls).toHaveLength(3);
    // None served: the 404's detail comes with the error; without one, none.
    const none = createRsClient({
      base: '/rs',
      mode: 'fixture',
      fetchFn: fakeFetch(() => ({
        status: 404,
        body: { detail: 'no PathGrade showcase is served: none is configured' },
      })).fetchFn,
    });
    await expect(none.showcase()).rejects.toEqual(
      expect.objectContaining({
        status: 404,
        detail: 'no PathGrade showcase is served: none is configured',
      })
    );
    const bare = createRsClient({
      base: '/rs',
      mode: 'fixture',
      fetchFn: async () => ({
        status: 404,
        ok: false,
        json: async () => {
          throw new Error('not JSON');
        },
      }),
    });
    await expect(bare.showcase()).rejects.toEqual(
      expect.objectContaining({ status: 404, detail: null })
    );
    // A showcase of the other mode is refused like any document.
    const clinical = createRsClient({
      base: '/rs',
      mode: 'clinical',
      fetchFn: fakeFetch(() => ({ status: 200, body: makeShowcase() })).fetchFn,
    });
    await expect(clinical.showcase()).rejects.toThrow(/publishes fixture documents/);
  });
});
