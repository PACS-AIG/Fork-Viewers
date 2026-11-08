/**
 * Rev 11 milestone 7, PR 2 (B31, N06): the reader's hanging presets in this
 * document. Read from the app (GET /api/users/settings/hanging) when the
 * reading window opens a case, kept in memory, and saved or reset through the
 * same route against the revision read: a save made in another window comes
 * back as a conflict, with what is stored, and nothing is overwritten.
 *
 * Off outside the reading window (the longitudinal mode never turns it on,
 * and the reading window turns it off as it leaves): the hang there is the
 * site's, exactly as before.
 *
 * And the open case's own: whether the reader chose its images (Arrange's Use
 * this case, the toolbar's browsing mode), which no preset overrides, and what
 * its re-hang applied, for Arrange's line and the probes.
 */
import {
  readEntries,
  readEntry,
  type CasePlan,
  type HangingEntry,
  type HangingPreset,
} from './hangingPresets';

export const HANGING_PRESETS_PATH = '/api/users/settings/hanging';
const READ_TIMEOUT_MS = 4000;
const WRITE_TIMEOUT_MS = 8000;

export type PresetsState = 'off' | 'loading' | 'ready' | 'failed';
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type SaveAnswer =
  | { ok: true; entry: HangingEntry | null }
  | { ok: false; conflict: HangingEntry | null }
  | { ok: false; failed: true };

/** What the case's re-hang did with the reader's preset; no study data. */
export interface CaseApplied {
  source: CasePlan['source'];
  skipped: CasePlan['skipped'];
  /** The preset's layout: shown, not showable here (the opening one stands), or none kept. */
  layout: 'shown' | 'fallback' | 'none';
  /** The preset's layout by name, when it could not be shown. */
  missingLayout: string | null;
}

export interface PresetCounts {
  loads: number;
  loadFailures: number;
  saves: number;
  resets: number;
  conflicts: number;
  failures: number;
  appliedPreset: number;
  appliedSite: number;
  appliedCase: number;
  fallbacks: number;
}

let state: PresetsState = 'off';
let entries: Record<string, HangingEntry> = {};
let loading: Promise<void> | null = null;
let fetchFn: Fetch | null = null;
let generation = 0;
let caseChoice = false;
let applied: CaseApplied | null = null;
const listeners = new Set<() => void>();
const tally: PresetCounts = {
  loads: 0,
  loadFailures: 0,
  saves: 0,
  resets: 0,
  conflicts: 0,
  failures: 0,
  appliedPreset: 0,
  appliedSite: 0,
  appliedCase: 0,
  fallbacks: 0,
};

const notify = () => listeners.forEach(l => l());

const defaultFetch = (): Fetch | null =>
  typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? (url, init) => window.fetch(url, init)
    : null;

const timeoutSignal = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;

/**
 * Reads the reader's presets for the case being opened (the reading window's
 * mode entry). The ones read for the last case stay in use until it answers.
 */
export function loadHangingPresets(f?: Fetch): Promise<void> {
  fetchFn = f ?? fetchFn ?? defaultFetch();
  const gen = ++generation;
  if (!fetchFn) {
    state = 'failed';
    notify();
    return Promise.resolve();
  }
  state = 'loading';
  const doFetch = fetchFn;
  loading = (async () => {
    try {
      const res = await doFetch(HANGING_PRESETS_PATH, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: timeoutSignal(READ_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      if (gen !== generation) {
        return;
      }
      entries = readEntries(body?.data?.hanging);
      state = 'ready';
      tally.loads++;
    } catch (_) {
      if (gen !== generation) {
        return;
      }
      state = 'failed';
      tally.loadFailures++;
    } finally {
      if (gen === generation) {
        loading = null;
        notify();
      }
    }
  })();
  notify();
  return loading;
}

/** Leaving the reading window: no preset is applied until it reads them again. */
export function suspendHangingPresets(): void {
  generation++;
  loading = null;
  state = 'off';
  notify();
}

/** Waits for a read in flight, at most `ms`. */
export async function awaitHangingPresets(ms: number): Promise<void> {
  const pending = loading;
  if (!pending) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    pending,
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
}

export function hangingPresetsState(): PresetsState {
  return state;
}

/** The study type's entry, as last read or saved here. */
export function hangingEntry(key: string): HangingEntry | null {
  return entries[key] ?? null;
}

/**
 * Saves (`preset`) or resets (`null`) a study type's preset against the
 * revision the caller read (0 for none). A conflict brings back what is
 * stored, which this document then holds.
 */
export async function saveHangingPreset(
  key: string,
  preset: HangingPreset | null,
  expectedRevision: number
): Promise<SaveAnswer> {
  const f = fetchFn ?? defaultFetch();
  if (!f) {
    tally.failures++;
    return { ok: false, failed: true };
  }
  try {
    const res = await f(HANGING_PRESETS_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, expectedRevision, preset }),
      signal: timeoutSignal(WRITE_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 409) {
      const current = readEntry(body?.data?.current);
      if (current) {
        entries = { ...entries, [key]: current };
      } else {
        const { [key]: _gone, ...rest } = entries;
        entries = rest;
      }
      tally.conflicts++;
      notify();
      return { ok: false, conflict: current };
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const entry = body?.data?.entry === null ? null : readEntry(body?.data?.entry);
    if (entry) {
      entries = { ...entries, [key]: entry };
    }
    if (preset) {
      tally.saves++;
    } else {
      tally.resets++;
    }
    notify();
    return { ok: true, entry };
  } catch (_) {
    tally.failures++;
    notify();
    return { ok: false, failed: true };
  }
}

/** A case opens: no choice made in it yet, nothing applied. */
export function startHangingCase(): void {
  caseChoice = false;
  applied = null;
  notify();
}

/** The reader chose this case's images: no preset overrides them in it. */
export function markCaseChoice(): void {
  caseChoice = true;
}

export function caseChoiceMade(): boolean {
  return caseChoice;
}

/** What the case's re-hang did (a re-hang during the comparison's settling may come again). */
export function noteCaseApplied(info: CaseApplied): void {
  applied = info;
  if (info.source === 'preset') {
    tally.appliedPreset++;
  } else if (info.source === 'case') {
    tally.appliedCase++;
  } else {
    tally.appliedSite++;
  }
  if (info.layout === 'fallback') {
    tally.fallbacks++;
  }
  notify();
}

export function caseApplied(): CaseApplied | null {
  return applied;
}

export function subscribeHangingPresets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Counts for the probes: no study data. */
export function hangingPresetCounts(): PresetCounts & { state: PresetsState; studyTypes: number } {
  return { ...tally, state, studyTypes: Object.keys(entries).length };
}
