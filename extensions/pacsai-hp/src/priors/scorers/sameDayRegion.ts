import type { PriorContext, PriorScorer } from '../types';
import { getBodyPart, parseStudyDateTime, SESSION_WINDOW_MS } from '../metadata';
import { DISQUALIFY } from './spineRegion';

/**
 * Same-session, different-region gate.
 *
 * A study acquired within the same imaging SESSION as the current one (timestamps
 * within SESSION_WINDOW_MS, interval-based — not same calendar day) but of a
 * DIFFERENT body part is a CONCURRENT exam (e.g. a trauma CT head + CT cervical, or
 * a split chest/abdomen acquisition), NOT a temporal prior. Comparing them as
 * current-vs-prior is meaningless, yet the cross-anatomy overlap in baseRelevance
 * (e.g. head>neck) plus the same-session recency bonus can otherwise push such a
 * sibling over `minScore`.
 *
 * This generalizes the spine region gate to all anatomy: when both body parts are
 * known, the two studies fall within the session window, and the regions differ,
 * disqualify the candidate. (Out-of-session cross-anatomy priors are left alone — a
 * prior neck CT can still add context to a current head CT; only the concurrent case
 * is excluded. A same-region same-session study, e.g. a repeat, is also left as a
 * valid comparison.)
 */
export const sameDayDifferentRegionGate: PriorScorer = ({ current, prior }: PriorContext): number => {
  const curTs = parseStudyDateTime(current);
  const priTs = parseStudyDateTime(prior);
  if (curTs === undefined || priTs === undefined || Math.abs(curTs - priTs) > SESSION_WINDOW_MS) {
    return 0;
  }
  const curBody = getBodyPart(current);
  const priBody = getBodyPart(prior);
  if (curBody === 'unknown' || priBody === 'unknown') {
    return 0;
  }
  return curBody !== priBody ? DISQUALIFY : 0;
};

export default sameDayDifferentRegionGate;
