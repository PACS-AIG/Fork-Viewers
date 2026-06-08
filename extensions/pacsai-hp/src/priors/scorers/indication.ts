import type { PriorContext, PriorScorer } from '../types';

/**
 * Clinical-indication match. Ideally this reads the requested-procedure /
 * reason-for-study fields, but those are rarely present in QIDO results, so we
 * use StudyDescription as a proxy:
 *  - a shared significant clinical finding keyword (nodule, pneumonia, ...)
 *    is a strong signal the prior is a true follow-up,
 *  - otherwise, generic description overlap gives a small bonus.
 *
 * Returns the single highest matching bonus (not cumulative) so one strong
 * follow-up match dominates.
 */

const GENERIC_OVERLAP_BONUS = 15;

/** Finding keyword → bonus when present in BOTH current and prior descriptions. */
const FINDING_KEYWORDS: Array<[RegExp, number]> = [
  [/\bnodule|nodular\b/i, 25],
  [/\bmass|tumor|tumour|lesion|met(astas[ei]s)?\b/i, 22],
  [/\bpneumonia|infiltrate|consolidation\b/i, 20],
  [/\beffusion|edema|oedema\b/i, 18],
  [/\bfracture\b/i, 18],
  [/\baneurysm|stenosis\b/i, 18],
];

const STOP_WORDS = new Set([
  'the',
  'and',
  'with',
  'without',
  'study',
  'exam',
  'scan',
  'follow',
  'followup',
  'up',
  'wo',
  'w',
  'contrast',
  'of',
  'for',
]);

function tokenize(desc?: string): Set<string> {
  if (!desc) {
    return new Set();
  }
  return new Set(
    String(desc)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(tok => tok.length > 2 && !STOP_WORDS.has(tok))
  );
}

export const indication: PriorScorer = ({ current, prior }: PriorContext): number => {
  const curDesc = current.StudyDescription;
  const priDesc = prior.StudyDescription;
  if (!curDesc || !priDesc) {
    return 0;
  }

  let best = 0;

  for (const [re, points] of FINDING_KEYWORDS) {
    if (re.test(curDesc) && re.test(priDesc) && points > best) {
      best = points;
    }
  }

  if (best === 0) {
    const curTokens = tokenize(curDesc);
    const priTokens = tokenize(priDesc);
    for (const tok of curTokens) {
      if (priTokens.has(tok)) {
        best = GENERIC_OVERLAP_BONUS;
        break;
      }
    }
  }

  return best;
};

export default indication;
