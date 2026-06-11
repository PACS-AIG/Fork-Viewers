/**
 * Comparison-role registry for the active study's loaded studies.
 *
 * The compare protocols hang series by ROLE — `current`, `prior`, `sibling` —
 * rather than by `studyInstanceUIDsIndex`. Keying on the study *order* breaks
 * down once we load same-session sibling exams (e.g. a whole-spine C/T/L set):
 * a sibling would land at index 1 and be matched by the `prior` selector. Roles
 * decouple matching from load order.
 *
 *  - `current` is NOT stored here — it is derived from the live activeStudyUID at
 *    match time (see the `pacsaiRole` attribute), so the current study always
 *    resolves correctly even on the very first hang, before priors are loaded.
 *  - `prior` / `sibling` UIDs are populated by `loadRelevantPriors` right before
 *    it re-hangs, once it knows which studies it fetched.
 *
 * Module-level state is intentional: custom HP attributes are plain functions
 * with no place to thread per-run context, and there is only ever one active
 * study/route at a time.
 */
export type StudyRole = 'current' | 'prior' | 'sibling';

let priorUIDs: Set<string> = new Set();
let siblingUIDs: Set<string> = new Set();

/** Replace the prior/sibling sets (called once per re-hang). */
export function setComparisonRoles(opts: { priors?: string[]; siblings?: string[] } = {}): void {
  priorUIDs = new Set((opts.priors ?? []).filter(Boolean));
  siblingUIDs = new Set((opts.siblings ?? []).filter(Boolean));
}

/** Clear all registered roles (e.g. when leaving a study). */
export function clearComparisonRoles(): void {
  priorUIDs = new Set();
  siblingUIDs = new Set();
}

/**
 * Resolve a study's comparison role. `current` wins and is derived from the
 * passed-in activeStudyUID; everything else comes from the registered sets.
 */
export function getStudyRole(
  studyInstanceUID: string | undefined,
  activeStudyUID: string | undefined
): StudyRole | undefined {
  if (!studyInstanceUID) {
    return undefined;
  }
  if (activeStudyUID && studyInstanceUID === activeStudyUID) {
    return 'current';
  }
  if (priorUIDs.has(studyInstanceUID)) {
    return 'prior';
  }
  if (siblingUIDs.has(studyInstanceUID)) {
    return 'sibling';
  }
  return undefined;
}

export default getStudyRole;
