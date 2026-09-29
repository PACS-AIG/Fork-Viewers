import { utils } from '@ohif/core';
import { pinGeneration } from '@ohif/core/src/utils/attempt/attemptTrace';

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
 * Two things are pinned: the attempt generation (an in-document switch opens a
 * new one) and the study the protocol holds active (a switch re-hangs for the
 * new study; so does focusSessionStudy). Either alone has a gap: no trace means
 * no generation, and right after a switch the hanging protocol still holds the
 * old study active until the new one hangs.
 */
export interface PinnedCase {
  /** Still the case the job was pinned for. */
  stillTheCase(): boolean;
  /**
   * True once it is not: the job's result is dropped (logged with `where`, and
   * `onDrop` runs — the job's indicator goes). The caller returns.
   */
  noLongerTheCase(where: string): boolean;
}

export function pinCase({
  hangingProtocolService,
  studyInstanceUID,
  job,
  log,
  onDrop,
}: {
  hangingProtocolService: any;
  /** The study the protocol holds active as the job starts. */
  studyInstanceUID: string | undefined;
  /** What was in flight, for the log: "its priors loaded". */
  job: string;
  log: (...args: unknown[]) => void;
  onDrop?: () => void;
}): PinnedCase {
  const sameGeneration = pinGeneration(() => utils.attempt.snapshot()?.generation);
  const stillTheCase = () =>
    sameGeneration() && hangingProtocolService?.getState?.()?.activeStudyUID === studyInstanceUID;
  return {
    stillTheCase,
    noLongerTheCase: where => {
      if (stillTheCase()) {
        return false;
      }
      const movedOn = `the case moved on from ${studyInstanceUID} while ${job}`;
      log(`${movedOn} — dropping the result (${where})`);
      onDrop?.();
      return true;
    },
  };
}

export default pinCase;
