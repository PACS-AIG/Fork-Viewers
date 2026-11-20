import { RsRefused } from './rsContract';
import { RsHttpError, createRsClient, normalizeBase, type FetchLike } from './rsClient';
import { makeInbox, makeReport, makeSnapshot, makeVersions } from './testDocs';

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
    const notServed = createRsClient({ base: '/rs-api', mode: 'fixture', fetchFn: fakeFetch(() => ({ status: 404, body: {} })).fetchFn });
    await expect(notServed.report('s')).rejects.toEqual(expect.objectContaining({ name: 'RsHttpError', status: 404 }));
    const clinical = createRsClient({ base: '/rs-api', mode: 'clinical', fetchFn: fakeFetch(() => ({ status: 200, body: makeReport() })).fetchFn });
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
    const down = createRsClient({ base: '/rs-api', mode: 'fixture', fetchFn: fakeFetch(() => ({ status: 502, body: {} })).fetchFn });
    await expect(down.postEvent({} as never)).rejects.toBeInstanceOf(RsHttpError);
    const odd = createRsClient({ base: '/rs-api', mode: 'fixture', fetchFn: fakeFetch(() => ({ status: 200, body: { hello: 1 } })).fetchFn });
    await expect(odd.postEvent({} as never)).rejects.toBeInstanceOf(RsRefused);
  });

  it('normalizes the configured base', () => {
    expect(normalizeBase(' /api/reading-system// ')).toBe('/api/reading-system');
    expect(normalizeBase(undefined)).toBe('');
    expect(normalizeBase(42)).toBe('');
  });
});
