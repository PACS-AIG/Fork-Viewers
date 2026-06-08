import type { PriorContext, PriorScorer } from '../types';
import { parseStudyDate } from '../metadata';

/**
 * Recency bonus based on the time between the current study and the prior.
 * A close-in-time prior is more relevant for assessing interval change; a very
 * old prior is mildly penalized. Measured relative to the current study's date
 * (not wall-clock time), so it is deterministic and unit-testable.
 */

const DAY = 24 * 60 * 60 * 1000;

const BUCKETS: Array<{ maxDays: number; points: number }> = [
  { maxDays: 0, points: 20 }, // same day
  { maxDays: 7, points: 15 }, // within 1 week
  { maxDays: 31, points: 10 }, // within ~1 month
  { maxDays: 93, points: 5 }, // within ~3 months
  { maxDays: 366, points: 0 }, // within ~1 year
];

const OLDER_THAN_A_YEAR = -10;

export const recency: PriorScorer = ({ current, prior }: PriorContext): number => {
  const curTs = parseStudyDate(current);
  const priTs = parseStudyDate(prior);
  if (curTs === undefined || priTs === undefined) {
    return 0;
  }

  const days = Math.abs(curTs - priTs) / DAY;
  for (const { maxDays, points } of BUCKETS) {
    if (days <= maxDays) {
      return points;
    }
  }
  return OLDER_THAN_A_YEAR;
};

export default recency;
