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
 * The unregionalized region a body part belongs to. Spine is the only part this
 * module subdivides, and two callers need it flattened: `baseRelevance`'s
 * cross-anatomy table is keyed on bare 'spine', and a scanner protocol's region
 * group names 'Spine' while the protocol itself names the level.
 */
export function baseRegion(part: BodyPart): BodyPart {
  return part.startsWith('spine-') ? 'spine' : part;
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
// Treat any NON-LETTER (underscore, hyphen, digit, space, start/end) as a token
// boundary instead of \b. Scanner / auto-protocol names delimit with underscores
// (e.g. "Spine^001_Cspine (Adult)"), and \b never fires at "_Cspine" because
// underscore is a word character — so \bc[-\s]?spine\b would miss it and the study
// would fall through to a generic 'spine'. Mirrors getImagePlane's letterBounded.
const spineBounded = (body: string): RegExp => new RegExp(`(?<![a-z])(?:${body})(?![a-z])`, 'i');

export function getSpineRegion(text: string): BodyPart | undefined {
  if (spineBounded('lumbar|lumbosacral|l[-_\\s]?spine|ls[-_\\s]?spine').test(text)) {
    return 'spine-lumbar';
  }
  if (spineBounded('thoracic\\s+spine|t[-_\\s]?spine|dorsal\\s+spine').test(text)) {
    return 'spine-thoracic';
  }
  if (spineBounded('cervical\\s+spine|c[-_\\s]?spine').test(text)) {
    return 'spine-cervical';
  }
  if (spineBounded('spine|spinal|vertebr\\w*|myelogram').test(text)) {
    return 'spine';
  }
  return undefined;
}

/**
 * Ancillary / non-diagnostic modalities that ride along with a real series but
 * must never define a study's modality. The common offender is a plain CXR
 * stored with a Presentation State as "PR\CR": naively taking the first token
 * yields 'PR', so the study reads as a different modality than the current CR
 * and a genuine prior CXR gets demoted below an older one. When a study lists
 * several modalities we prefer the first DIAGNOSTIC one; a study that is ONLY
 * an ancillary type (e.g. a standalone SR) still falls back to that type.
 */
const NON_DIAGNOSTIC_MODALITIES = new Set([
  'PR', // presentation state
  'SR', // structured report
  'KO', // key object selection
  'SEG', // segmentation
  'REG', // registration
  'RTSTRUCT',
  'RTPLAN',
  'RTDOSE',
  'RTRECORD',
  'PLAN',
  'FID', // fiducials
  'DOC', // encapsulated document
  'AU', // audio
  'PMAP', // parametric map
  'OT', // "other"
]);

function pickDiagnosticModality(mods: string[]): string | undefined {
  const cleaned = mods.map(m => m.trim().toUpperCase()).filter(Boolean);
  if (!cleaned.length) {
    return undefined;
  }
  return cleaned.find(m => !NON_DIAGNOSTIC_MODALITIES.has(m)) ?? cleaned[0];
}

export function getModality(study: StudyLike): string | undefined {
  // Modality may be a single value, ModalitiesInStudy an array or a
  // backslash/comma-delimited string ("PR\\CR"); normalize all to the
  // study's diagnostic modality.
  const raw = study.Modality ?? study.ModalitiesInStudy;
  if (Array.isArray(raw) && raw.length) {
    return pickDiagnosticModality(raw.map(String));
  }
  if (typeof raw === 'string' && raw.length) {
    return pickDiagnosticModality(raw.split(/[\\,]/));
  }
  return undefined;
}

/** Projection radiography is one family — a CR, DX, XR or RG chest are the same exam. */
function modalityFamily(modality?: string): string | undefined {
  if (!modality) {
    return undefined;
  }
  const m = modality.toUpperCase();
  return m === 'CR' || m === 'DX' || m === 'XR' || m === 'RG' ? 'XR' : m;
}

/**
 * The study's modality folded to its FAMILY — what every same-modality COMPARISON
 * must be made on. `baseRelevance` always folded, but the ranker's tier test and
 * the sibling filter compared raw values, so a current CR against a prior DX chest
 * read as different modalities: it fell to the same tier as a prior CT and lost to
 * it on recency, contradicting the rad's "same modality, then most recent" spec.
 *
 * `getModality` deliberately stays raw — the prior switcher prints it, and a rad
 * looking at a menu row wants the exam's own "CR"/"DX", not the family label.
 */
export function getModalityFamily(study: StudyLike): string | undefined {
  return modalityFamily(getModality(study));
}

/**
 * Word boundary for the anatomy vocabulary, plus an optional plural `s`.
 *
 * NOT `\b`, for two reasons real descriptions make unmissable. `\b` counts `_` as
 * a word character, so every scanner protocol name hid its region behind the
 * underscore ("Vascular^001_PE_CHEST (Adult)" resolved to unknown). And `\b` after
 * a singular stem excludes every plural the table does not spell out, so "US DUP
 * CAROTIDS BILATERAL" and "XR FINGERS 2+ VIEWS LEFT" both missed off a stem the
 * table already carried. Terms whose plural is not a bare -s (sinus/sinuses) stay
 * spelled out, and a stem ending in `\w*` has already eaten the suffix.
 * Same boundary rule as `spineBounded` above.
 */
const anatomyBounded = (body: string): RegExp =>
  new RegExp(`(?<![a-z])(?:${body})s?(?![a-z])`, 'i');

/**
 * Keyword → body-part mapping applied to StudyDescription (BodyPartExamined as a
 * fallback). Includes common radiology abbreviations (ABD, PEL, CXR, C-SPINE, ...)
 * since real-world descriptions rarely spell anatomy out in full.
 * Order matters: the first match wins (e.g. an "ABD PEL" study resolves to
 * abdomen, which is fine as long as current and prior resolve consistently).
 *
 * Kept deliberately WIDE, because an unclassified study is not merely a study that
 * scores lower — it is one that OUTSCORES the studies we can read. A prior whose
 * body part is 'unknown' collects `SAME_MODALITY_UNKNOWN_BODY_PART` (60), which
 * clears `minScore`, while a correctly-classified cross-body pair the relevance
 * table has no entry for scores 0 and is filtered out. Being unreadable beat being
 * read: a cervical spine CT hung against a CT CEREBRAL PERFUSION, ahead of the same
 * patient's own head CT, purely because "CEREBRAL" was not in this table.
 *
 * Mirrors the app repo's `comparisonAutoFill.ts` vocabulary, which was measured
 * over 69,733 real reports (16.7% → 0.7% unclassified, with no description that
 * already had an answer changing it). Keep the two in step.
 */
const BODY_PART_VOCAB: Array<[string, BodyPart]> = [
  // Maxillofacial belongs to head: sinuses, orbits, facial bones and temporal
  // bones are all read alongside a head CT. `mandible` deliberately does not match
  // "submandibular", a neck gland claimed by the row below — anatomyBounded's
  // lookbehind rejects a preceding letter, so it still doesn't.
  [
    'brain|cerebr\\w*|cerebell\\w*|encephal\\w*|intracranial|supratentorial|infratentorial|subdural|head|skull|cranial|calvari\\w*|mastoid|hd|facial|face|sinus(es)?|orbit|maxillofacial|maxilla|mandible|temporal|nasal|pituitary|sella|iac|tmj|zygoma',
    'head',
  ],
  [
    'neck|cervical|carotid|c-?spine|thyroid|parathyroid|larynx|laryngeal|submandibular|parotid|salivary|trachea',
    'neck',
  ],
  ['chest|thorax|thoracic|lung|cxr|cx|pulmonary|thx|rib|sternum|sternal', 'chest'],
  ['cardiac|heart|coronary|echo', 'cardiac'],
  // KUB and urogram span kidneys to bladder; abdomen is the closer of the two.
  // `pancrea` and `vertebr` (below) were written as stems but compiled with a
  // closing \b, so they matched NOTHING — not even the word they were truncated
  // from. Same defect as `mammo` in the breast row.
  [
    'abdomen|abdominal|abdo|abd|liver|hepat\\w*|kidney|renal|pancrea\\w*|mrcp|urogram|kub|gallbladder|biliary|spleen|splenic|bowel|colon|appendix|adrenal|ureter|retroperiton\\w*|mesenteric',
    'abdomen',
  ],
  [
    'spine|spinal|lumbar|l-?spine|t-?spine|vertebr\\w*|scoliosis|sacrum|sacral|coccyx|coccygeal',
    'spine',
  ],
  // Obstetric ultrasound is read on the pelvis and names nothing above it. `ob` is
  // safe this far down the row because "US PELVIS NON OB COMPLETE" is claimed by
  // `pelvis` in the same alternation, whichever branch the engine tries first.
  [
    'pelvis|pelvic|pelv|pel|hip|bladder|prostate|scrotum|scrotal|testic\\w*|uterus|uterine|ovary|ovarian|adnexa|transvaginal|groin|ob|obstetric\\w*|fetal|fetus(es)?|gestation\\w*|biophysical|nuchal|pregnan\\w*',
    'pelvis',
  ],
  // mammo\w* rather than a bare `mammo` stem: there is no word boundary inside
  // "MAMMOGRAM", so the stem matched neither it nor "mammography" and every
  // screening study came back 'unknown' — then outscored the real prior mammogram.
  ['breast|mammo\\w*|mg', 'breast'],
  // ext / extrem are how vascular ultrasound writes it ("DUPLEX LOWER EXT VENOUS").
  [
    'arm|leg|knee|shoulder|ankle|wrist|elbow|femur|tibia|fibula|humerus|radius|ulna|clavicle|scapula|forearm|hand|foot|finger|thumb|toe|calcaneus|patella|extrem\\w*|ext',
    'extremity',
  ],
];

/** Compiled once. */
const BODY_PART_KEYWORDS: Array<[RegExp, BodyPart]> = BODY_PART_VOCAB.map(([vocab, part]) => [
  anatomyBounded(vocab),
  part,
]);

/** Resolve one text source to a body part, or undefined when it names none. */
function scanBodyPart(source: string): BodyPart | undefined {
  if (!source.trim()) {
    return undefined;
  }
  // Spine (incl. cervical/thoracic/lumbar regions) is resolved first — see
  // getSpineRegion — so "cervical/thoracic spine" don't fall into neck/chest.
  const spine = getSpineRegion(source);
  if (spine) {
    return spine;
  }
  for (const [re, part] of BODY_PART_KEYWORDS) {
    if (re.test(source)) {
      return part;
    }
  }
  return undefined;
}

/**
 * Siemens-style protocol names put the scanner's own region group before the `^`:
 * "Head^001_IAC_TEMP_BONES (Adult)", "Upper Extremities^001_WRIST_ABOVE_HEAD (Adult)".
 */
export const PROTOCOL_REGION_GROUP = /^([^^]{2,40})\^/;

/**
 * Study → body part, from the StudyDescription first and DICOM BodyPartExamined
 * only as a fallback.
 *
 * The description leads because BodyPartExamined is scanner-populated and coarse: a
 * study described "Spine^001_Cspine (Adult)" can carry BodyPartExamined "HEAD". The
 * tag still rescues a description that names nothing (a cryptic exam code), which is
 * the case it is really there for. Today this ordering is academic on the prior path
 * — `toStudyLike` in loadRelevantPriors never populates BodyPartExamined from QIDO,
 * so both sides already resolve off the description — but the app repo hit the
 * tag-first bug on real data, and the moment anyone maps the QIDO field through, the
 * comparison would go asymmetric: priors have only a description, so a tag-derived
 * current would be compared against description-derived priors and disagree exactly
 * when the tag is wrong.
 */
export function getBodyPart(study: StudyLike): BodyPart {
  const description = study.StudyDescription ? String(study.StudyDescription) : '';
  const resolved =
    scanBodyPart(description) ??
    scanBodyPart(study.BodyPartExamined ? String(study.BodyPartExamined) : '') ??
    'unknown';

  // A protocol's region group is the region the protocol was FILED under, which
  // beats any single word found deeper in the name — that is where positioning
  // language lives, and "Upper Extremities^001_WRIST_ABOVE_HEAD" resolved to 'head'
  // off ABOVE_HEAD. It must not overrule a refinement of ITSELF, though:
  // "Spine^001_C_SPINE (Adult)" has group 'spine' and full-string 'spine-cervical',
  // and the specific answer is the right one — so only a genuinely different region wins.
  const group = PROTOCOL_REGION_GROUP.exec(description)?.[1];
  const grouped = group ? scanBodyPart(group) : undefined;
  if (grouped && grouped !== resolved && baseRegion(resolved) !== grouped) {
    return grouped;
  }
  return resolved;
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

/**
 * Parse DICOM StudyDate (YYYYMMDD) + StudyTime (HHMMSS[.frac]) into a millisecond
 * UTC timestamp, or undefined when the date is absent/unparseable. StudyTime is
 * optional — when missing or malformed the time falls back to 00:00:00, so this
 * degrades to `parseStudyDate`'s midnight value. Used for interval-based
 * same-session vs prior classification (vs `parseStudyDate`'s calendar-day grain,
 * which the recency scorer still uses for "days ago").
 */
export function parseStudyDateTime(study: StudyLike): number | undefined {
  const raw = study.StudyDate;
  if (!raw || typeof raw !== 'string') {
    return undefined;
  }
  const dm = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!dm) {
    return undefined;
  }
  const [, y, mo, d] = dm;
  let hh = 0;
  let mi = 0;
  let ss = 0;
  const rawTime = study.StudyTime;
  if (rawTime && typeof rawTime === 'string') {
    const tm = rawTime.match(/^(\d{2})(\d{2})?(\d{2})?/);
    if (tm) {
      hh = Number(tm[1]) || 0;
      mi = Number(tm[2]) || 0;
      ss = Number(tm[3]) || 0;
    }
  }
  const ts = Date.UTC(Number(y), Number(mo) - 1, Number(d), hh, mi, ss);
  return Number.isNaN(ts) ? undefined : ts;
}

/**
 * Time window within which two studies of one patient are treated as a single
 * concurrent imaging SESSION (siblings) rather than current-vs-prior. Replaces the
 * old same-calendar-day rule, so studies a couple of hours apart across midnight
 * still count as one session, and a study >24h earlier is a genuine prior.
 */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
