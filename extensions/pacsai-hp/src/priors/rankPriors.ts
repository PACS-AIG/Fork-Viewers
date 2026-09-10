import type { StudyLike } from './types';
import { getBodyPart, getModalityFamily, parseStudyDateTime } from './metadata';

/** A prior with its additive relevance score, as ranked. */
export type ScoredPrior = { prior: StudyLike; score: number };

/**
 * How well a prior matches the study it will hang beside. Lower is better.
 *
 * The modality test is on the FAMILY, not the raw value: a CR, DX, XR or RG chest
 * are the same exam, and comparing raw values put a prior DX chest in tier 1 next
 * to a prior CT — where a more recent CT then won on the recency rule, which is the
 * opposite of the rad's spec. `baseRelevance` had always folded the family; only
 * this test and the sibling filter did not.
 */
export function tierOfPrior(ref: StudyLike, prior: StudyLike): number {
  const refBody = getBodyPart(ref);
  const refMod = getModalityFamily(ref);
  const sameBody = refBody !== 'unknown' && getBodyPart(prior) === refBody;
  const sameMod = refMod !== undefined && getModalityFamily(prior) === refMod;
  if (sameBody && sameMod) {
    return 0;
  }
  if (sameBody) {
    return 1;
  }
  return 2; // cross-body — kept only as a last resort (see CROSS_BODY_PART)
}

/**
 * Comparator for QUALIFYING priors (rad spec): prefer the SAME body part, then the
 * SAME modality, then the MOST RECENT (study date/time descending); the additive
 * relevance score is only the final tiebreak. Recency is therefore primary WITHIN
 * the compatible group, instead of a pure score sort letting an indication keyword
 * or a coarse recency bucket pick an older prior.
 *
 * `ref` is the study a prior is compared against — the opened study, or a spine
 * region's session study in the whole-spine survey.
 */
export function makeRanker(ref: StudyLike) {
  return (a: ScoredPrior, b: ScoredPrior): number => {
    const tierDelta = tierOfPrior(ref, a.prior) - tierOfPrior(ref, b.prior);
    if (tierDelta !== 0) {
      return tierDelta; // better (lower) tier first
    }
    const da = parseStudyDateTime(a.prior) ?? -Infinity;
    const db = parseStudyDateTime(b.prior) ?? -Infinity;
    if (da !== db) {
      return db - da; // most recent first
    }
    return b.score - a.score; // relevance only breaks ties
  };
}

export default makeRanker;
