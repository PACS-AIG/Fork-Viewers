import { utils } from '@ohif/core';
import { pinGeneration } from '@ohif/core/src/utils/attempt/attemptTrace';
import { clearComparisonRoles } from './roleRegistry';

/**
 * The case an async prior job is for, pinned when it starts: the relevant-priors
 * load (loadRelevantPriors.ts) and a prior picked from the on-image switcher
 * (selectPrior.ts). Each awaits the data source and then writes the comparison
 * roles and re-hangs; after an in-document switch from A to B (the viewer's
 * switchStudy — replaceState + popstate re-enters the mode, the attempt trace
 * opens a new generation), A's job, still in flight, used to finish and hang A
 * as the case with B as its prior (milestone 6, V04). Asked after every await
 * and before every write.
 *
 * Three things are pinned: the mode entry (endCase, at the mode's exit, ends
 * every job pinned before it), the attempt generation (an in-document switch
 * opens a new one) and the study the protocol holds active (a switch re-hangs
 * for the new study; so does focusSessionStudy). The generation and the study
 * alone left a gap: from A's mode exit until B's mode entry begins B's
 * generation and hangs B, A's job still passed both. No trace means no
 * generation, and right after a switch the hanging protocol still holds the old
 * study active until the new one hangs.
 *
 * The invariant the route init's case set rests on (platform/app routes/Mode/
 * setupRouteInit.ts): a stale job never asks the data source for anything
 * after its case has moved on. So each job asks this after every await, with no
 * await between that answer and its next request.
 */
export interface PinnedCase {
  /** Still the case the job was pinned for. */
  stillTheCase(): boolean;
  /**
   * True once it is not: the job's result is dropped (logged with `where`, and
   * `onDrop` runs once — the job's indicator goes). The caller returns.
   */
  noLongerTheCase(where: string): boolean;
  /**
   * Show a notice for this case: none once it is not the case, and every one
   * shown is hidden when the job is dropped or the mode exits.
   */
  show(options: Record<string, unknown>): string | undefined;
}

// The mode entry: endCase moves it on.
let caseEpoch = 0;
// The drop of every job pinned in this mode entry, run by endCase.
const openPins = new Set<() => void>();

/**
 * A key for per-case module state (loadRelevantPriors' inFlight): the mode
 * entry, the attempt generation and the study. A→B→A opens a new generation, so
 * A's priors load again; a new mode entry for the same study does too, even
 * while the previous entry's job is still unwinding.
 */
export function caseKey(studyInstanceUID: string | undefined): string {
  let generation: number | string = 'none';
  try {
    generation = utils.attempt.snapshot()?.generation ?? 'none';
  } catch (_) {
    /* no trace in this document */
  }
  return `${caseEpoch}:${generation}:${studyInstanceUID}`;
}

export function pinCase({
  hangingProtocolService,
  studyInstanceUID,
  job,
  log,
  onDrop,
  uiNotificationService,
}: {
  hangingProtocolService: any;
  /** The study the protocol holds active as the job starts. */
  studyInstanceUID: string | undefined;
  /** What was in flight, for the log: "its priors loaded". */
  job: string;
  log: (...args: unknown[]) => void;
  onDrop?: () => void;
  /** For show(): the notices this job raises for its case. */
  uiNotificationService?: {
    show?: (options: Record<string, unknown>) => string | undefined;
    hide?: (id: string) => void;
  };
}): PinnedCase {
  const epoch = caseEpoch;
  const sameGeneration = pinGeneration(() => utils.attempt.snapshot()?.generation);
  const stillTheCase = () =>
    epoch === caseEpoch &&
    sameGeneration() &&
    hangingProtocolService?.getState?.()?.activeStudyUID === studyInstanceUID;
  const notices: string[] = [];
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    openPins.delete(release);
    // Each by its id: hide(undefined) would dismiss every toast on screen.
    notices.splice(0).forEach(id => uiNotificationService?.hide?.(id));
    onDrop?.();
  };
  openPins.add(release);
  return {
    stillTheCase,
    noLongerTheCase: where => {
      if (stillTheCase()) {
        return false;
      }
      const movedOn = `the case moved on from ${studyInstanceUID} while ${job}`;
      log(`${movedOn} — dropping the result (${where})`);
      release();
      return true;
    },
    show: options => {
      if (!stillTheCase()) {
        return undefined;
      }
      const id = uiNotificationService?.show?.(options);
      if (id) {
        notices.push(id);
      }
      return id;
    },
  };
}

/**
 * The mode's exit: the case is over (the longitudinal mode's onModeExit). Every
 * job pinned before now reads moved-on from here, and each one's drop runs
 * once: its notices are hidden (the priors indicator, 'Loading selected
 * prior…', a 'no viewport for it' advisory) and its onDrop releases what it
 * holds (selectPrior's `switching`). Then the comparison roles, the session
 * studies and the switchable priors are cleared, so the next case's hang, the
 * toolbar's study switcher and the on-image prior switcher start empty instead
 * of offering this case's studies until the next priors load publishes.
 */
export function endCase(): void {
  caseEpoch += 1;
  const pins = [...openPins];
  openPins.clear();
  pins.forEach(release => release());
  clearComparisonRoles();
}

export default pinCase;
