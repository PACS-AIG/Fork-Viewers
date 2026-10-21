import {
  APP_FLAGS_PATH,
  APP_SESSION_PATH,
  APP_SESSION_RECHECK_MS,
  APP_TOKEN_EXPIRY_LEAD_MS,
  KEEP_ALIVE_KEY,
  NEXTAUTH_MESSAGE_KEY,
  appSignInActive,
  appSignInEnded,
  appTokenFromSession,
  isReadingWindow,
  readAppToken,
  setAppSignInState,
  watchAppSignIn,
} from './appSignIn';

const NOW = 1791234000000;
// ASCII claims only, so btoa (jsdom's) is enough.
const b64url = obj =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** A JWT-shaped fake with these claims, never a real token. */
const jwt = claims => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.ZmFrZS1zaWc`;
const tokenFor = (secondsLeft, sub = 'reader') => {
  const expiresAt = Math.floor(NOW / 1000) + secondsLeft;
  return { accessToken: jwt({ sub, exp: expiresAt, azp: 'next-app' }), expiresAt };
};
const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** A fetch answering the flags and the session as given; records the calls. */
function fakeFetch({ flags = res(200, { readingAppSignIn: true }), session = res(200, {}) } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const answer =
      url === APP_FLAGS_PATH ? flags : url === APP_SESSION_PATH ? session : res(404, null);
    if (answer instanceof Error) throw answer;
    if (answer === 'hang') return new Promise(() => {});
    return answer;
  };
  return { fn, calls };
}

describe('isReadingWindow', () => {
  const base = { pathname: '/viewer/viewer/radcopilot', readingDock: '1', framed: false };
  it("is the radcopilot route with READING_DOCK on, at top level (the dock's own path rule)", () => {
    expect(isReadingWindow(base)).toBe(true);
    expect(isReadingWindow({ ...base, pathname: '/viewer/radcopilot' })).toBe(true);
    expect(isReadingWindow({ ...base, pathname: '/radcopilot' })).toBe(true);
    expect(isReadingWindow({ ...base, pathname: '/viewer/viewer/radcopilot/dicomweb' })).toBe(true);
    expect(isReadingWindow({ ...base, readingDock: ' YES ' })).toBe(true);
  });
  it('is not framed, another route, or with the dock off', () => {
    expect(isReadingWindow({ ...base, framed: true })).toBe(false);
    expect(isReadingWindow({ ...base, pathname: '/viewer/viewer/viewer' })).toBe(false);
    expect(isReadingWindow({ ...base, pathname: '/viewer/viewer/radcopilotx' })).toBe(false);
    expect(isReadingWindow({ ...base, pathname: '/viewer/radcopilot/a/b' })).toBe(false);
    ['', '0', 'off', undefined, null].forEach(flag =>
      expect(isReadingWindow({ ...base, readingDock: flag })).toBe(false)
    );
  });
});

describe('appTokenFromSession', () => {
  it("takes next-auth's access token with its own exp", () => {
    const t = tokenFor(600);
    expect(appTokenFromSession({ user: {}, accessToken: t.accessToken })).toEqual(t);
  });
  it('is null for no session, an ended one, no token, a malformed one, or no readable exp', () => {
    expect(appTokenFromSession(null)).toBeNull();
    expect(appTokenFromSession({})).toBeNull();
    expect(appTokenFromSession([])).toBeNull();
    expect(
      appTokenFromSession({ accessToken: tokenFor(600).accessToken, error: 'AccessTokenError' })
    ).toBeNull();
    expect(appTokenFromSession({ accessToken: 'not a jwt' })).toBeNull();
    expect(appTokenFromSession({ accessToken: 42 })).toBeNull();
    expect(appTokenFromSession({ accessToken: jwt({ sub: 'x' }) })).toBeNull();
    expect(appTokenFromSession({ accessToken: jwt({ sub: 'x', exp: 12.5 }) })).toBeNull();
    expect(
      appTokenFromSession({ accessToken: `${jwt({ sub: 'x', exp: 1 })}${'a'.repeat(16384)}` })
    ).toBeNull();
  });
});

describe('readAppToken', () => {
  const now = () => NOW;
  it('asks both, same-origin and uncached, at once', async () => {
    const t = tokenFor(600);
    const f = fakeFetch({ session: res(200, { accessToken: t.accessToken }) });
    expect(await readAppToken(f.fn, { now })).toEqual({ kind: 'token', token: t });
    expect(f.calls.map(c => c.url).sort()).toEqual([APP_FLAGS_PATH, APP_SESSION_PATH].sort());
    f.calls.forEach(c => {
      expect(c.init.credentials).toBe('same-origin');
      expect(c.init.cache).toBe('no-store');
    });
  });
  it('signed-out: the flags answer 401, or the session has no usable token', async () => {
    expect(await readAppToken(fakeFetch({ flags: res(401, null) }).fn, { now })).toEqual({
      kind: 'signed-out',
    });
    expect(await readAppToken(fakeFetch({ session: res(200, {}) }).fn, { now })).toEqual({
      kind: 'signed-out',
    });
    const ended = { accessToken: tokenFor(600).accessToken, error: 'AccessTokenError' };
    expect(await readAppToken(fakeFetch({ session: res(200, ended) }).fn, { now })).toEqual({
      kind: 'signed-out',
    });
    const nearlyGone = { accessToken: tokenFor(30).accessToken };
    expect(await readAppToken(fakeFetch({ session: res(200, nearlyGone) }).fn, { now })).toEqual({
      kind: 'signed-out',
    });
  });
  it("off: the app's switch is not on", async () => {
    const t = tokenFor(600);
    const values = [false, undefined, 'true', 1];
    for (let i = 0; i < values.length; i++) {
      const f = fakeFetch({
        flags: res(200, { readingAppSignIn: values[i] }),
        session: res(200, { accessToken: t.accessToken }),
      });
      expect(await readAppToken(f.fn, { now })).toEqual({ kind: 'off' });
    }
  });
  it('unavailable: an error status, a throw, a reply that is not an object, or no answer in time', async () => {
    expect(await readAppToken(fakeFetch({ flags: res(500, null) }).fn, { now })).toEqual({
      kind: 'unavailable',
    });
    expect(await readAppToken(fakeFetch({ session: res(502, null) }).fn, { now })).toEqual({
      kind: 'unavailable',
    });
    expect(await readAppToken(fakeFetch({ flags: new Error('offline') }).fn, { now })).toEqual({
      kind: 'unavailable',
    });
    expect(await readAppToken(fakeFetch({ flags: res(200, null) }).fn, { now })).toEqual({
      kind: 'unavailable',
    });
    let fire;
    const slow = readAppToken(fakeFetch({ session: 'hang' }).fn, {
      now,
      setTimeout: fn => {
        fire = fn;
        return 1;
      },
      clearTimeout: () => {},
    });
    await Promise.resolve();
    fire();
    expect(await slow).toEqual({ kind: 'unavailable' });
  });
});

describe('the app sign-in state', () => {
  afterEach(() => setAppSignInState({ active: false, ended: false }));
  it('is ended only while the app user is held', () => {
    expect(appSignInActive()).toBe(false);
    setAppSignInState({ ended: true });
    expect(appSignInEnded()).toBe(false);
    setAppSignInState({ active: true });
    expect(appSignInActive()).toBe(true);
    expect(appSignInEnded()).toBe(true);
    setAppSignInState({ ended: false });
    expect(appSignInEnded()).toBe(false);
  });
});

describe('watchAppSignIn', () => {
  /** Timers and storage events by hand; `reads` answer the checks in order (the last repeats). */
  function rig({ reads, current = tokenFor(3600), store = async () => {} } = {}) {
    const listeners = new Set();
    const timers = new Map();
    let nextId = 1;
    const intervals = new Map();
    const stored = [];
    const events = [];
    let readCount = 0;
    const win = {
      addEventListener: (type, fn) => type === 'storage' && listeners.add(fn),
      removeEventListener: (type, fn) => listeners.delete(fn),
    };
    const stop = watchAppSignIn({
      current,
      read: async () => {
        const r = reads[Math.min(readCount, reads.length - 1)];
        readCount++;
        return typeof r === 'function' ? r() : r;
      },
      store: async t => {
        stored.push(t);
        await store(t);
      },
      onEnded: () => events.push('ended'),
      onBack: () => events.push('back'),
      win,
      now: () => NOW,
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout: id => timers.delete(id),
      setInterval: (fn, ms) => {
        const id = nextId++;
        intervals.set(id, { fn, ms });
        return id;
      },
      clearInterval: id => intervals.delete(id),
    });
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    const emit = async key => {
      listeners.forEach(fn => fn({ key }));
      await flush();
      await flush();
    };
    return {
      stop,
      stored,
      events,
      timers,
      intervals,
      listeners,
      emit,
      flush,
      reads: () => readCount,
    };
  }

  it("takes a newer token on the keep-alive's stamp or next-auth's message, and ignores other keys", async () => {
    const fresh = tokenFor(7200, 'reader');
    const r = rig({ reads: [{ kind: 'token', token: fresh }] });
    await r.emit('some.other.key');
    expect(r.reads()).toBe(0);
    await r.emit(KEEP_ALIVE_KEY);
    expect(r.stored).toEqual([fresh]);
    await r.emit(NEXTAUTH_MESSAGE_KEY);
    // The same token again: nothing stored twice.
    expect(r.stored).toEqual([fresh]);
    expect(r.reads()).toBe(2);
    r.stop();
  });

  it('tells the end of the app session once, and its return, with the new token', async () => {
    const back = tokenFor(7200, 'reader');
    const r = rig({
      reads: [{ kind: 'signed-out' }, { kind: 'signed-out' }, { kind: 'token', token: back }],
    });
    await r.emit(NEXTAUTH_MESSAGE_KEY);
    await r.emit(NEXTAUTH_MESSAGE_KEY);
    expect(r.events).toEqual(['ended']);
    await r.emit(NEXTAUTH_MESSAGE_KEY);
    expect(r.events).toEqual(['ended', 'back']);
    expect(r.stored).toEqual([back]);
    r.stop();
  });

  it("keeps the held user when the app's switch is off or the app does not answer", async () => {
    const r = rig({ reads: [{ kind: 'off' }, { kind: 'unavailable' }] });
    await r.emit(KEEP_ALIVE_KEY);
    await r.emit(KEEP_ALIVE_KEY);
    expect(r.stored).toEqual([]);
    expect(r.events).toEqual([]);
    r.stop();
  });

  it('checks every few minutes, and shortly before the held token expires (re-armed on a newer one)', async () => {
    const current = tokenFor(3600);
    const fresh = tokenFor(7200);
    const r = rig({ current, reads: [{ kind: 'token', token: fresh }] });
    expect([...r.intervals.values()].map(i => i.ms)).toEqual([APP_SESSION_RECHECK_MS]);
    expect([...r.timers.values()].map(t => t.ms)).toEqual([3600 * 1000 - APP_TOKEN_EXPIRY_LEAD_MS]);
    [...r.intervals.values()][0].fn();
    await r.flush();
    await r.flush();
    expect(r.stored).toEqual([fresh]);
    expect([...r.timers.values()].map(t => t.ms)).toEqual([7200 * 1000 - APP_TOKEN_EXPIRY_LEAD_MS]);
    r.stop();
  });

  it('runs one check at a time: a trigger during one runs one more after it', async () => {
    let release;
    const first = new Promise(resolve => (release = resolve));
    const fresh = tokenFor(7200);
    const r = rig({ reads: [() => first, { kind: 'token', token: fresh }] });
    r.listeners.forEach(fn => fn({ key: KEEP_ALIVE_KEY }));
    r.listeners.forEach(fn => fn({ key: KEEP_ALIVE_KEY }));
    r.listeners.forEach(fn => fn({ key: KEEP_ALIVE_KEY }));
    await r.flush();
    expect(r.reads()).toBe(1);
    release({ kind: 'off' });
    await r.flush();
    await r.flush();
    await r.flush();
    expect(r.reads()).toBe(2);
    expect(r.stored).toEqual([fresh]);
    r.stop();
  });

  it('stops: no listener, no interval, no timer, no check after', async () => {
    const r = rig({ reads: [{ kind: 'signed-out' }] });
    r.stop();
    expect(r.listeners.size).toBe(0);
    expect(r.intervals.size).toBe(0);
    expect(r.timers.size).toBe(0);
    expect(r.events).toEqual([]);
  });

  it('keeps the held user when storing a newer token fails, and tries again at the next check', async () => {
    const fresh = tokenFor(7200);
    let fail = true;
    const r = rig({
      reads: [{ kind: 'token', token: fresh }],
      store: async () => {
        if (fail) throw new Error('storage full');
      },
    });
    await r.emit(KEEP_ALIVE_KEY);
    fail = false;
    await r.emit(KEEP_ALIVE_KEY);
    expect(r.stored).toEqual([fresh, fresh]);
    r.stop();
  });
});
