import { APP_CSRF_PATH, APP_SIGN_OUT_PATH, NEXTAUTH_MESSAGE_KEY, signOutOfApp } from './appSignOut';

const res = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const NOW = 1791234000000;

function rig(answers: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
  const stored = new Map<string, string>();
  const fetchFn = jest.fn(async (url: string, init?: Record<string, unknown>) => {
    calls.push({ url, init });
    const a = answers[url];
    if (a instanceof Error) {
      throw a;
    }
    return (a ?? res(404, null)) as ReturnType<typeof res>;
  });
  const storage = { setItem: (k: string, v: string) => void stored.set(k, v) };
  return { calls, stored, fetchFn, storage };
}

describe('signOutOfApp (21 Oct)', () => {
  it("signs out as next-auth's client does: its CSRF token, a POST, then its cross-tab message", async () => {
    const r = rig({
      [APP_CSRF_PATH]: res(200, { csrfToken: 'csrf-1' }),
      [APP_SIGN_OUT_PATH]: res(200, { url: '/' }),
    });
    expect(await signOutOfApp({ fetchFn: r.fetchFn, storage: r.storage, now: () => NOW })).toBe(
      true
    );
    expect(r.calls.map(c => c.url)).toEqual([APP_CSRF_PATH, APP_SIGN_OUT_PATH]);
    const post = r.calls[1].init as {
      method: string;
      credentials: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(post.method).toBe('POST');
    expect(post.credentials).toBe('same-origin');
    expect(post.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(post.body))).toEqual({
      csrfToken: 'csrf-1',
      callbackUrl: '/',
      json: 'true',
    });
    expect(JSON.parse(r.stored.get(NEXTAUTH_MESSAGE_KEY) as string)).toEqual({
      event: 'session',
      data: { trigger: 'signout' },
      timestamp: Math.floor(NOW / 1000),
    });
  });

  it('false, with no POST and no message, without a CSRF token', async () => {
    const answers = [
      res(500, null),
      res(200, {}),
      res(200, { csrfToken: '' }),
      res(200, null),
      new Error('offline'),
    ];
    for (let i = 0; i < answers.length; i++) {
      const r = rig({ [APP_CSRF_PATH]: answers[i] });
      expect(await signOutOfApp({ fetchFn: r.fetchFn, storage: r.storage })).toBe(false);
      expect(r.calls.map(c => c.url)).toEqual([APP_CSRF_PATH]);
      expect(r.stored.size).toBe(0);
    }
  });

  it('false, with no message, when the sign-out is refused or does not answer', async () => {
    const answers = [res(403, null), new Error('offline')];
    for (let i = 0; i < answers.length; i++) {
      const r = rig({
        [APP_CSRF_PATH]: res(200, { csrfToken: 'c' }),
        [APP_SIGN_OUT_PATH]: answers[i],
      });
      expect(await signOutOfApp({ fetchFn: r.fetchFn, storage: r.storage })).toBe(false);
      expect(r.stored.size).toBe(0);
    }
  });

  it('true when signed out even without storage for the message', async () => {
    const r = rig({
      [APP_CSRF_PATH]: res(200, { csrfToken: 'c' }),
      [APP_SIGN_OUT_PATH]: res(200, {}),
    });
    const throwing = {
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(await signOutOfApp({ fetchFn: r.fetchFn, storage: throwing })).toBe(true);
    expect(await signOutOfApp({ fetchFn: r.fetchFn, storage: null })).toBe(true);
  });
});
