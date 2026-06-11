import type { PriorContext, PriorScorer } from '../types';
import { getBodyPart, isSpine } from '../metadata';

/**
 * A candidate scoring at or below this can never clear any sane `minScore`, so it
 * is effectively disqualified rather than merely deprioritized. We disqualify via
 * a scorer (rather than filtering) so the decision stays composable and testable
 * alongside the other scorers.
 */
export const DISQUALIFY = -1000;

/**
 * Spine region gate.
 *
 * The cervical, thoracic and lumbar spine are SEPARATE exams (separate
 * accessions), very often acquired in the same session. By radiology convention
 * one region is never the comparison prior of another — hanging current lumbar
 * beside a (same-day) cervical study is clinically meaningless. So when the
 * current and prior are BOTH spine with KNOWN but DIFFERENT regions, disqualify
 * the prior outright; recency/indication bonuses must not let a sibling region
 * sneak back in.
 *
 * A generic "spine" (region unparsed — e.g. a whole-spine study) is left to score
 * normally, since it may include the current region.
 */
export const spineRegionGate: PriorScorer = ({ current, prior }: PriorContext): number => {
  const cur = getBodyPart(current);
  const pri = getBodyPart(prior);
  if (isSpine(cur) && isSpine(pri) && cur !== 'spine' && pri !== 'spine' && cur !== pri) {
    return DISQUALIFY;
  }
  return 0;
};

export default spineRegionGate;
