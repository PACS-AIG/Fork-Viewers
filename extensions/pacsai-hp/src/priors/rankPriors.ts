import type { StudyLike } from './types';
import { getBodyPart, getModalityFamily, parseStudyDate, parseStudyDateTime } from './metadata';

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
 * SAME modality, then the MOST RECENT DAY; the additive relevance score decides
 * among the studies of one day. Recency is therefore primary WITHIN the compatible
 * group, instead of a pure score sort letting an indication keyword or a coarse
 * recency bucket pick an older prior.
 *
 * tier → day → score → time.
 *
 * The date step is DAY grain because that is the grain `recency` scores on
 * (`parseStudyDate`, not `parseStudyDateTime`). It used to be the full timestamp,
 * so the sort tie-broke at a precision the scorer explicitly refuses to use, and
 * score could only ever decide an EXACT timestamp tie. Studies from one imaging
 * session are minutes apart, so a prior trauma panel — head, maxillofacial,
 * C-spine, five minutes end to end — ranked by whichever was scanned LAST, and the
 * exact-exam match could not overcome it: a current CT head put a prior
 * maxillofacial (90) above the patient's own prior head CT (105).
 *
 * Deliberately NOT tier → score → day, which would also reverse CROSS-day cases —
 * an exact-exam match six months old beating a same-region exam from last month.
 * The full timestamp stays as the final tiebreak so the order is total and stable.
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
    const dayA = parseStudyDate(a.prior) ?? -Infinity;
    const dayB = parseStudyDate(b.prior) ?? -Infinity;
    if (dayA !== dayB) {
      return dayB - dayA; // most recent DAY first
    }
    if (a.score !== b.score) {
      return b.score - a.score; // within one day, relevance decides
    }
    const da = parseStudyDateTime(a.prior) ?? -Infinity;
    const db = parseStudyDateTime(b.prior) ?? -Infinity;
    return db - da; // total, stable order
  };
}

export default makeRanker;
