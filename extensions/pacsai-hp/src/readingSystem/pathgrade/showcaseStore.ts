/**
 * RS-36: PathGrade's research showcase, outside React (the pane's PathGrade
 * tab renders it through `subscribe` / `getSnapshot`).
 *
 *   - Read once, when the tab is first opened (it belongs to no study, so a
 *     page reads it once, whatever the reader opens), and again after a read
 *     that failed. Nothing is fetched for a reader who never opens the tab.
 *   - None served: the API answers 404 and says why ("no PathGrade showcase is
 *     served: none is configured"). The tab shows those words as given; a 404
 *     without them (a proxy that does not pass the route) says so plainly.
 *   - Each picture a figure shows is read in turn, its bytes checked against
 *     the sha256 the showcase lists, and shown from a URL of its own (an object
 *     URL); one that fails the check is never shown, and says why.
 *
 * Nothing here names a study or a patient: the showcase is public cases.
 */
import { RsRefused } from '../rsContract';
import { RsHttpError } from '../rsClient';
import { picturesShown, type RsShowcase } from './showcaseContract';

export type ShowcasePhase = 'idle' | 'loading' | 'ready' | 'none' | 'refused' | 'failed';

export interface ShowcasePicture {
  state: 'waiting' | 'loading' | 'ready' | 'refused';
  /** Where the page shows it, once its bytes are checked. */
  url: string | null;
  reason: string | null;
}

export interface ShowcaseSnapshot {
  phase: ShowcasePhase;
  /** Why none is shown (none served, refused, failed), in words for the reader. */
  reason: string | null;
  showcase: RsShowcase | null;
  pictures: Record<string, ShowcasePicture>;
}

export interface ShowcaseClient {
  showcase(): Promise<RsShowcase>;
  showcaseImage(name: string): Promise<Uint8Array>;
}

export interface ShowcaseStoreDeps {
  client: ShowcaseClient;
  /** SHA-256 as lowercase hex, or null where the page has no WebCrypto. */
  digest: ((bytes: Uint8Array) => Promise<string>) | null;
  /** A URL the page shows a picture's bytes at, and its release (object URLs). */
  pictureUrl: { create(bytes: Uint8Array): string; revoke(url: string): void } | null;
  /** How many pictures are read at once. */
  parallel?: number;
}

export interface ShowcaseStore {
  /** Read the showcase and its pictures, unless read already (again after a failure). */
  open(): void;
  /** Let go of everything (the pane leaves). */
  leave(): void;
  getSnapshot(): ShowcaseSnapshot;
  subscribe(listener: () => void): () => void;
  harnessState(): Record<string, unknown>;
}

const IDLE: ShowcaseSnapshot = { phase: 'idle', reason: null, showcase: null, pictures: {} };

/** The API's own words for "none served" (its 404's detail), as the tab shows them. */
const NONE_SERVED = /^no pathgrade showcase is served\b/i;
const UID_SHAPED = /\d+(?:\.\d+){4,}/g;

/** What the tab says when no showcase is served, from the 404's detail. */
export function noneServedReason(detail: string | null): string {
  if (detail && NONE_SERVED.test(detail.trim())) {
    const d = detail.trim().replace(UID_SHAPED, '…');
    const sentence = d[0].toUpperCase() + d.slice(1);
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  }
  return 'The CT analysis service serves no PathGrade showcase here.';
}

export function createShowcaseStore(deps: ShowcaseStoreDeps): ShowcaseStore {
  const listeners = new Set<() => void>();
  let state: ShowcaseSnapshot = IDLE;
  let generation = 0;
  const counts = { reads: 0, pictures: 0, refusedPictures: 0 };

  const emit = () => listeners.forEach(l => l());
  const set = (patch: Partial<ShowcaseSnapshot>) => {
    state = { ...state, ...patch };
    emit();
  };
  const setPicture = (name: string, picture: ShowcasePicture) =>
    set({ pictures: { ...state.pictures, [name]: picture } });

  function release() {
    Object.values(state.pictures).forEach(p => {
      if (p.url) {
        try {
          deps.pictureUrl?.revoke(p.url);
        } catch (_) {
          /* gone already */
        }
      }
    });
  }

  async function readPicture(showcase: RsShowcase, name: string, gen: number) {
    const listed = showcase.images.find(i => i.name === name);
    const refused = (reason: string) => {
      counts.refusedPictures++;
      setPicture(name, { state: 'refused', url: null, reason });
    };
    if (!listed) {
      return refused('The showcase does not list this picture.');
    }
    if (!deps.digest || !deps.pictureUrl) {
      return refused('This page cannot check a picture’s bytes (it has no WebCrypto).');
    }
    setPicture(name, { state: 'loading', url: null, reason: null });
    try {
      const bytes = await deps.client.showcaseImage(name);
      const hash = await deps.digest(bytes);
      if (gen !== generation) {
        return;
      }
      if (hash !== listed.sha256) {
        return refused('Its bytes are not the ones the showcase lists, so it is not shown.');
      }
      counts.pictures++;
      setPicture(name, { state: 'ready', url: deps.pictureUrl.create(bytes), reason: null });
    } catch (e) {
      if (gen !== generation) {
        return;
      }
      refused(
        e instanceof RsRefused
          ? e.why
          : e instanceof RsHttpError
            ? `It could not be read (HTTP ${e.status}).`
            : 'It could not be read.'
      );
    }
  }

  async function load(gen: number) {
    counts.reads++;
    try {
      const showcase = await deps.client.showcase();
      if (gen !== generation) {
        return;
      }
      const names = picturesShown(showcase);
      const pictures: Record<string, ShowcasePicture> = {};
      names.forEach(n => (pictures[n] = { state: 'waiting', url: null, reason: null }));
      set({ phase: 'ready', reason: null, showcase, pictures });
      // A few at a time, in the order the sections show them.
      const queue = [...names];
      const worker = async () => {
        while (queue.length && gen === generation) {
          await readPicture(showcase, queue.shift() as string, gen);
        }
      };
      const n = Math.max(1, Math.min(deps.parallel ?? 3, names.length));
      await Promise.all(Array.from({ length: n }, worker));
    } catch (e) {
      if (gen !== generation) {
        return;
      }
      if (e instanceof RsHttpError && e.status === 404) {
        set({ phase: 'none', reason: noneServedReason(e.detail) });
      } else if (e instanceof RsRefused) {
        set({ phase: 'refused', reason: e.why });
      } else {
        set({
          phase: 'failed',
          reason:
            e instanceof RsHttpError
              ? `The PathGrade showcase could not be read (HTTP ${e.status}).`
              : 'The PathGrade showcase could not be read.',
        });
      }
    }
  }

  return {
    open() {
      if (state.phase !== 'idle' && state.phase !== 'failed') {
        return;
      }
      const gen = ++generation;
      set({ phase: 'loading', reason: null, showcase: null, pictures: {} });
      void load(gen);
    },
    leave() {
      generation++;
      release();
      if (state !== IDLE) {
        state = IDLE;
        emit();
      }
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    harnessState() {
      // Counts only: kinds of items and pictures, never their words.
      const items: Record<string, number> = {};
      let unknownItems = 0;
      state.showcase?.sections.forEach(s => {
        s.items.forEach(i => (items[i.kind] = (items[i.kind] ?? 0) + 1));
        unknownItems += s.unknownItems;
      });
      const pictures: Record<string, number> = {};
      Object.values(state.pictures).forEach(
        p => (pictures[p.state] = (pictures[p.state] ?? 0) + 1)
      );
      return {
        phase: state.phase,
        sections: state.showcase?.sections.length ?? 0,
        items,
        unknownItems,
        images: state.showcase?.images.length ?? 0,
        pictures,
        counts: { ...counts },
      };
    },
  };
}
