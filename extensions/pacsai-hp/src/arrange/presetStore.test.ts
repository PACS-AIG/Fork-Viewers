/**
 * Rev 11 milestone 7, PR 2 (N06): the reader's presets in the document: read
 * once per case entry, saved and reset against the revision read, a conflict
 * brought back with what is stored; off outside the reading window.
 */
import {
  awaitHangingPresets,
  caseChoiceMade,
  hangingEntry,
  hangingPresetCounts,
  hangingPresetsState,
  HANGING_PRESETS_PATH,
  loadHangingPresets,
  markCaseChoice,
  saveHangingPreset,
  startHangingCase,
  suspendHangingPresets,
} from './presetStore';
import type { HangingPreset } from './hangingPresets';

const KEY = 'v1|CT|@pacsai/compareCTA';
const PRESET: HangingPreset = {
  v: 1,
  label: 'CTA Head/Neck',
  protocolId: '@pacsai/compareCTA',
  protocolRevision: 'abcd1234',
  stageId: 'cta-src-0-cp',
  stageName: 'CTA Source axial (head + neck)',
  browsing: 'append',
  summary: 'CTA Head/Neck Compare · CTA Source axial (head + neck) · prior when available',
};
const entry = (revision: number, preset: HangingPreset | null = PRESET) => ({
  revision,
  preset,
  at: '2026-11-08T14:00:00.000Z',
});

const answer = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

afterEach(() => suspendHangingPresets());

describe("the reader's presets in the document (milestone 7, PR 2)", () => {
  it('reads them at a case entry: the route, uncached; entries checked', async () => {
    const f = jest.fn(() =>
      answer(200, { data: { hanging: { [KEY]: entry(2), 'bad key': entry(1) } } })
    );
    await loadHangingPresets(f as never);
    expect(f).toHaveBeenCalledWith(
      HANGING_PRESETS_PATH,
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(hangingPresetsState()).toBe('ready');
    expect(hangingEntry(KEY)).toEqual(entry(2));
    expect(hangingEntry('bad key')).toBeNull();
  });

  it('a read that fails says so (the last ones read stay)', async () => {
    await loadHangingPresets((() =>
      answer(200, { data: { hanging: { [KEY]: entry(1) } } })) as never);
    await loadHangingPresets((() => answer(500, null)) as never);
    expect(hangingPresetsState()).toBe('failed');
    expect(hangingEntry(KEY)).toEqual(entry(1));
  });

  it('an older read answering late is dropped', async () => {
    let releaseSlow: () => void = () => undefined;
    const slow = () =>
      new Promise<Response>(resolve => {
        releaseSlow = () =>
          resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: { hanging: { [KEY]: entry(9) } } }),
          } as Response);
      });
    const first = loadHangingPresets(slow as never);
    await loadHangingPresets((() =>
      answer(200, { data: { hanging: { [KEY]: entry(3) } } })) as never);
    releaseSlow();
    await first;
    expect(hangingEntry(KEY)).toEqual(entry(3));
  });

  it('a re-hang waits for a read in flight, but never longer than it is given', async () => {
    jest.useFakeTimers();
    try {
      loadHangingPresets((() => new Promise(() => undefined)) as never);
      let done = false;
      const waiting = awaitHangingPresets(1500).then(() => (done = true));
      await jest.advanceTimersByTimeAsync(1400);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(200);
      await waiting;
      expect(done).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a save sends the key, the revision read and the preset; what is stored comes back', async () => {
    const f = jest.fn((url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? answer(200, { data: { key: KEY, entry: entry(1) } })
        : answer(200, { data: { hanging: {} } })
    );
    await loadHangingPresets(f as never);
    const before = hangingPresetCounts().saves;
    expect(await saveHangingPreset(KEY, PRESET, 0)).toEqual({ ok: true, entry: entry(1) });
    const post = f.mock.calls.find(c => c[1]?.method === 'POST');
    expect(post?.[0]).toBe(HANGING_PRESETS_PATH);
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      key: KEY,
      expectedRevision: 0,
      preset: PRESET,
    });
    expect(hangingEntry(KEY)).toEqual(entry(1));
    expect(hangingPresetCounts().saves).toBe(before + 1);
  });

  it('a conflict brings back what another window keeps, held from then on', async () => {
    const f = jest.fn((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? answer(409, { data: { key: KEY, current: entry(4) } })
        : answer(200, { data: { hanging: { [KEY]: entry(3) } } })
    );
    await loadHangingPresets(f as never);
    expect(await saveHangingPreset(KEY, PRESET, 3)).toEqual({ ok: false, conflict: entry(4) });
    expect(hangingEntry(KEY)).toEqual(entry(4));
  });

  it('a reset stores no preset with the next revision; a failure is reported, nothing assumed', async () => {
    let fail = false;
    const f = jest.fn((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? fail
          ? answer(500, null)
          : answer(200, { data: { key: KEY, entry: entry(5, null) } })
        : answer(200, { data: { hanging: { [KEY]: entry(4) } } })
    );
    await loadHangingPresets(f as never);
    expect(await saveHangingPreset(KEY, null, 4)).toEqual({ ok: true, entry: entry(5, null) });
    expect(hangingEntry(KEY)?.preset).toBeNull();
    fail = true;
    expect(await saveHangingPreset(KEY, PRESET, 5)).toEqual({ ok: false, failed: true });
    expect(hangingEntry(KEY)).toEqual(entry(5, null));
  });

  it('off until a case entry reads them, and off again when the reading window is left', async () => {
    expect(hangingPresetsState()).toBe('off');
    await loadHangingPresets((() => answer(200, { data: { hanging: {} } })) as never);
    expect(hangingPresetsState()).toBe('ready');
    suspendHangingPresets();
    expect(hangingPresetsState()).toBe('off');
  });

  it("the case's own choice: none at a case's start, then held for the case", () => {
    startHangingCase();
    expect(caseChoiceMade()).toBe(false);
    markCaseChoice();
    expect(caseChoiceMade()).toBe(true);
    startHangingCase();
    expect(caseChoiceMade()).toBe(false);
  });
});
