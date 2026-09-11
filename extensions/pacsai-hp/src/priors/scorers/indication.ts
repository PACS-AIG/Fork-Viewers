import type { PriorContext, PriorScorer } from '../types';
import { PROTOCOL_REGION_GROUP } from '../metadata';

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

/**
 * Age/population qualifiers. A scanner protocol name carries one on nearly every
 * entry, so they say nothing about whether two studies are the same exam.
 */
const POPULATION_QUALIFIERS = new Set([
  'adult',
  'adults',
  'child',
  'children',
  'peds',
  'pediatric',
  'paediatric',
  'infant',
  'neonate',
  'neonatal',
]);

/**
 * Tokens of a description that could plausibly mean "these are the same exam".
 *
 * Scanner protocol names are mostly BOILERPLATE, and the boilerplate is shared by
 * every protocol filed under one region group — so the generic overlap bonus fired
 * on all of them and carried no signal at all. "Head^001_HEAD_WO (Adult)" and
 * "Head^001_MAXILLOFACIAL_TRAUMA (Adult)" share `head`, `001` and `adult`, which
 * made a prior maxillofacial score exactly what the patient's own prior head CT
 * scored (105 each); the ranker then had nothing left but the clock, and the study
 * scanned five minutes later in that prior trauma session won.
 *
 * So three things are dropped on top of STOP_WORDS: the region group before the
 * `^` (it repeats inside the name anyway when it is genuinely the anatomy — the
 * current study keeps its own 'head' from HEAD_WO), pure-numeric protocol codes,
 * and the age qualifier. RIS-style descriptions have no caret and no code, so they
 * tokenize exactly as before.
 */
function tokenize(desc?: string): Set<string> {
  if (!desc) {
    return new Set();
  }
  return new Set(
    String(desc)
      .replace(PROTOCOL_REGION_GROUP, ' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        tok =>
          tok.length > 2 &&
          !STOP_WORDS.has(tok) &&
          !POPULATION_QUALIFIERS.has(tok) &&
          !/^\d+$/.test(tok)
      )
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
