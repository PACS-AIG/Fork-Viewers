import type { StudyLike } from './types';

/**
 * Helpers to extract normalized modality / body-part / date from a study, used
 * by the scorers. Everything is best-effort: QIDO results frequently omit
 * BodyPartExamined and may not include a reliable single Modality, so callers
 * must tolerate `undefined`.
 */

/** Normalized body-part regions. Extend as needed. */
export type BodyPart =
  | 'head'
  | 'neck'
  | 'chest'
  | 'cardiac'
  | 'abdomen'
  | 'spine'
  | 'spine-cervical'
  | 'spine-thoracic'
  | 'spine-lumbar'
  | 'pelvis'
  | 'extremity'
  | 'breast'
  | 'unknown';

/** True for any spine body part (generic or a specific cervical/thoracic/lumbar region). */
export function isSpine(part: BodyPart): boolean {
  return part === 'spine' || part.startsWith('spine-');
}

/**
 * Resolve the spine region of a description, or undefined if it is not a spine
 * study. Runs BEFORE the generic body-part table because cervical/thoracic spine
 * descriptions would otherwise be mis-classified as 'neck'/'chest' (the keyword
 * table lists those regions first, and "cervical"/"thoracic" match them).
 *
 *  - "lumbar" / "L-spine" is unambiguously spine on its own.
 *  - "cervical"/"thoracic" only count as spine when clearly spinal (with "spine"
 *    or the C-/T-spine abbreviation), so soft-tissue NECK and CHEST/THORAX exams
 *    are left to the generic table.
 *  - a bare "spine"/"spinal"/"vertebr"/"myelogram" (no region) stays generic 'spine'.
 */
export function getSpineRegion(text: string): BodyPart | undefined {
  if (/\b(lumbar|lumbosacral|l[-\s]?spine|ls[-\s]?spine)\b/i.test(text)) {
    return 'spine-lumbar';
  }
  if (/\bthoracic\s+spine\b|\bt[-\s]?spine\b|\bdorsal\s+spine\b/i.test(text)) {
    return 'spine-thoracic';
  }
  if (/\bcervical\s+spine\b|\bc[-\s]?spine\b/i.test(text)) {
    return 'spine-cervical';
  }
  if (/\b(spine|spinal|vertebr|myelogram)\b/i.test(text)) {
    return 'spine';
  }
  return undefined;
}

export function getModality(study: StudyLike): string | undefined {
  if (study.Modality) {
    return String(study.Modality).toUpperCase();
  }
  const m = study.ModalitiesInStudy;
  if (Array.isArray(m) && m.length) {
    return String(m[0]).toUpperCase();
  }
  if (typeof m === 'string' && m.length) {
    // ModalitiesInStudy may be a backslash-delimited string.
    return m.split(/[\\,]/)[0].trim().toUpperCase();
  }
  return undefined;
}

/**
 * Keyword → body-part mapping applied to BodyPartExamined / StudyDescription.
 * Includes common radiology abbreviations (ABD, PEL, CXR, C-SPINE, ...) since
 * real-world descriptions rarely spell anatomy out in full.
 * Order matters: the first match wins (e.g. an "ABD PEL" study resolves to
 * abdomen, which is fine as long as current and prior resolve consistently).
 */
const BODY_PART_KEYWORDS: Array<[RegExp, BodyPart]> = [
  [/\b(brain|head|skull|cranial|hd)\b/i, 'head'],
  [/\b(neck|cervical|carotid|c-?spine)\b/i, 'neck'],
  [/\b(chest|thorax|thoracic|lung|cxr|cx|pulmonary|thx)\b/i, 'chest'],
  [/\b(cardiac|heart|coronary|echo)\b/i, 'cardiac'],
  [/\b(abdomen|abdominal|abdo|abd|liver|kidney|renal|pancrea)\b/i, 'abdomen'],
  [/\b(spine|spinal|lumbar|l-?spine|t-?spine|vertebr)\b/i, 'spine'],
  [/\b(pelvis|pelvic|pelv|pel|hip|bladder|prostate)\b/i, 'pelvis'],
  [/\b(breast|mammo|mg)\b/i, 'breast'],
  [/\b(arm|leg|knee|shoulder|ankle|wrist|elbow|femur|tibia|hand|foot|extremity)\b/i, 'extremity'],
];

export function getBodyPart(study: StudyLike): BodyPart {
  const sources = [study.BodyPartExamined, study.StudyDescription];
  for (const source of sources) {
    if (!source) {
      continue;
    }
    const str = String(source);
    // Spine (incl. cervical/thoracic/lumbar regions) is resolved first — see
    // getSpineRegion — so "cervical/thoracic spine" don't fall into neck/chest.
    const spine = getSpineRegion(str);
    if (spine) {
      return spine;
    }
    for (const [re, part] of BODY_PART_KEYWORDS) {
      if (re.test(str)) {
        return part;
      }
    }
  }
  return 'unknown';
}

/** Parse a DICOM date (YYYYMMDD) into a millisecond timestamp, or undefined. */
export function parseStudyDate(study: StudyLike): number | undefined {
  const raw = study.StudyDate;
  if (!raw || typeof raw !== 'string') {
    return undefined;
  }
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) {
    return undefined;
  }
  const [, y, mo, d] = m;
  const ts = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(ts) ? undefined : ts;
}
