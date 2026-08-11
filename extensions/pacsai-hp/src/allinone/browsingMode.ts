/**
 * Browsing mode — how the all-in-one series participates in the hang. A global,
 * sticky (localStorage) reader preference; default 'append'.
 *
 *  - 'append'   : the normal compare protocol hangs, with the all-in-one as its
 *                 LAST stage (page to the end to get the one-scroll view).
 *  - 'current'  : the SAME compare protocol, hung as if the study had NO PRIOR —
 *                 the prior's hanging role is suppressed (see
 *                 `hangingIgnoresPriors`), so every current|prior stage falls
 *                 `disabled` and the current-only stages lead (task groups,
 *                 multi-plane fallback, whole-spine survey, per-region glance),
 *                 with the all-in-one 1-up as the last stage. SAME-SESSION
 *                 SIBLINGS still compare (they hang under the 'session'
 *                 timepoint, not 'prior'), exactly like a genuine no-prior case.
 *  - 'allinone' : ONLY the all-in-one — the current study's everything-in-one-scroll
 *                 (and, when a prior exists, the prior's all-in-one beside it).
 *  - 'manual'   : no protocol applied (stock OHIF 'default' single stage) — the
 *                 reader picks series himself (the all-in-one is still a thumbnail).
 *
 * Module-level state + localStorage, mirroring roleRegistry: the toolbar control
 * and the prior loader read it without threading per-run context, and there is only
 * ever one active reader/session.
 */
export type BrowsingMode = 'append' | 'current' | 'allinone' | 'manual';

export const BROWSING_MODES: BrowsingMode[] = ['append', 'current', 'allinone', 'manual'];

/** Short labels for the toolbar control. */
export const BROWSING_MODE_LABELS: Record<BrowsingMode, string> = {
  append: 'Compare + all-in-one',
  current: 'Current + all-in-one',
  allinone: 'All-in-one only',
  manual: 'Manual (pick series)',
};

/** Mode-2 dedicated protocol id (registered in getHangingProtocolModule). */
export const ALL_IN_ONE_PROTOCOL_ID = '@pacsai/allInOne';
/** Stock OHIF single-stage protocol id (Mode-3 manual). */
export const DEFAULT_PROTOCOL_ID = 'default';

const STORAGE_KEY = 'pacsai.browsingMode';
const DEFAULT_MODE: BrowsingMode = 'append';

function readStored(): BrowsingMode {
  try {
    const v = window?.localStorage?.getItem(STORAGE_KEY) as BrowsingMode | null;
    return v && BROWSING_MODES.includes(v) ? v : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

let mode: BrowsingMode = readStored();
const listeners = new Set<() => void>();

/** The current browsing mode. */
export function getBrowsingMode(): BrowsingMode {
  return mode;
}

/** Persist + broadcast a new browsing mode (no-op if unchanged or invalid). */
export function setBrowsingMode(next: BrowsingMode): void {
  if (!BROWSING_MODES.includes(next) || next === mode) {
    return;
  }
  mode = next;
  try {
    window?.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    /* localStorage unavailable — keep the in-memory value */
  }
  listeners.forEach(cb => cb());
}

/** Subscribe to mode changes (for the toolbar control); returns an unsubscribe fn. */
export function subscribeBrowsingMode(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * The protocol id to hang for a mode. 'append' and 'current' return the matched
 * compare protocol id (passed in) — or undefined to let the engine auto-select it;
 * they differ only in whether the prior gets a hanging role, not in which protocol
 * is applied. 'allinone' and 'manual' force the dedicated / stock-default protocol.
 */
export function protocolIdForMode(m: BrowsingMode, compareProtocolId?: string): string | undefined {
  if (m === 'allinone') {
    return ALL_IN_ONE_PROTOCOL_ID;
  }
  if (m === 'manual') {
    return DEFAULT_PROTOCOL_ID;
  }
  return compareProtocolId; // 'append' | 'current'
}

/**
 * Does the active mode hang the case as if it had NO prior ('Current +
 * all-in-one')? Consulted by the `pacsaiRole` / `pacsaiRegionTimepoint` custom
 * attributes (index.tsx) and mirrored by the PLANNED-protocol replay: a prior with
 * no hanging role leaves every prior-requiring selector unmatched, so its stage
 * falls `disabled` (minViewportsMatched 2) and the engine takes the current-only
 * path it already takes for a study that genuinely has no prior. Siblings are
 * untouched ('session'), so same-day other-region exams still compare.
 *
 * Priors are still QUERIED AND LOADED in this mode: the rail thumbnails keep their
 * PRIOR marker (the role registry stays truthful, so the CURRENT/PRIOR overlay pill
 * is correct if the reader drags one in), and switching back to 'append' stays a
 * pure re-hang with no re-query.
 */
export function hangingIgnoresPriors(m: BrowsingMode = getBrowsingMode()): boolean {
  return m === 'current';
}
