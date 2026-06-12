import type { PriorContext, PriorScorer } from '../types';
import { getBodyPart, parseStudyDate } from '../metadata';
import { DISQUALIFY } from './spineRegion';

/**
 * Same-day, different-region gate.
 *
 * A study acquired on the SAME DAY as the current one but of a DIFFERENT body part
 * is a CONCURRENT exam (e.g. a trauma CT head + CT cervical, or a split chest/abdomen
 * acquisition), NOT a temporal prior. Comparing them as current-vs-prior is
 * meaningless, yet the cross-anatomy overlap in baseRelevance (e.g. head>neck) plus
 * the same-day recency bonus can otherwise push such a sibling over `minScore`.
 *
 * This generalizes the spine region gate to all anatomy: when both body parts are
 * known, the dates are equal, and the regions differ, disqualify the candidate.
 * (Different-day cross-anatomy priors are left alone — a prior neck CT can still add
 * context to a current head CT; only the same-day concurrent case is excluded. A
 * same-region same-day study, e.g. a repeat, is also left as a valid comparison.)
 */
export const sameDayDifferentRegionGate: PriorScorer = ({ current, prior }: PriorContext): number => {
  const curDate = parseStudyDate(current);
  const priDate = parseStudyDate(prior);
  if (curDate === undefined || priDate === undefined || curDate !== priDate) {
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
