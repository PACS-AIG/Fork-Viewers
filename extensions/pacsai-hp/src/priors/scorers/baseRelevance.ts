import type { PriorContext, PriorScorer } from '../types';
import type { BodyPart } from '../metadata';
import { getBodyPart, getModalityFamily } from '../metadata';

/**
 * Base anatomical/modality relevance.
 *
 * Encodes the clinical intuition that:
 *  - same modality + same body part is the strongest comparison,
 *  - same body part across modalities is still highly relevant (a prior CT gives
 *    richer context for a current CXR than vice-versa),
 *  - some cross-body-part pairs carry moderate relevance because of overlapping
 *    anatomy (CT abdomen includes the lung bases; a prior CXR shows the lungs).
 *
 * Values are seeded from the proposed model and are intended to be tuned per
 * deployment. Everything is expressed as data tables so tuning is data-only.
 */

const SAME_MODALITY_SAME_BODY_PART = 100;
const SAME_BODY_PART_DIFFERENT_MODALITY_DEFAULT = 70;
// Fallbacks when a body part can't be parsed from the description/metadata.
const SAME_MODALITY_UNKNOWN_BODY_PART = 60;
const DIFFERENT_MODALITY_UNKNOWN_BODY_PART = 20;

/**
 * Directional (current → prior) overrides when the body part matches but the
 * modality differs. Keyed `${currentModalityFamily}>${priorModalityFamily}`.
 */
const SAME_BODY_PART_MODALITY_PAIR: Record<string, number> = {
  'XR>CT': 80, // current CXR, prior CT chest — CT adds detail about same anatomy
  'CT>XR': 60, // current CT, prior CXR — less detail but shows interval change
  'MR>CT': 75,
  'CT>MR': 75,
  'MR>XR': 60, // MR spine vs prior XR spine — alignment/bone visible on both
  'XR>MR': 60,
};

/**
 * Directional (current → prior) cross-body-part relevance, keyed
 * `${currentBodyPart}>${priorBodyPart}`. Only meaningful overlaps are listed;
 * anything not present scores 0 from this scorer.
 */
const CROSS_BODY_PART: Record<string, number> = {
  'abdomen>chest': 50, // CT abdomen lung bases vs prior CXR
  'chest>abdomen': 40, // upper-abdominal findings correlating with CXR
  'chest>cardiac': 50,
  'cardiac>chest': 50,
  'head>neck': 30, // craniocervical junction overlap
  'neck>head': 30,
  'head>spine': 30,
  'spine>neck': 40,
  'neck>spine': 40,
};

/**
 * Spine levels fold to bare 'spine' for the cross-anatomy table ONLY where the fold
 * is anatomically true.
 *
 * Every CROSS_BODY_PART entry touching spine pairs it with head or neck, and those
 * are relations of the CERVICAL spine — the neck IS the cervical region. Folding
 * every level into them made a prior CT LUMBAR SPINE a 40-point comparison for a
 * CT NECK SOFT TISSUE, two regions apart, and 40 clears `minScore`.
 *
 * Narrower than `baseRegion` on purpose: that one answers a different question (is
 * this body part a refinement of that one) and has to fold every level, or
 * "Spine^001_L_SPINE" loses its level to its own protocol group.
 *
 * An unregionalized 'spine' is left alone and still matches: its description named
 * no level, so the relation may well hold, and that is the entry the table was
 * written for.
 */
const crossBodySpine = (part: BodyPart): BodyPart => (part === 'spine-cervical' ? 'spine' : part);

export const baseRelevance: PriorScorer = ({ current, prior }: PriorContext): number => {
  const curMod = getModalityFamily(current);
  const priMod = getModalityFamily(prior);
  const curBp = getBodyPart(current);
  const priBp = getBodyPart(prior);

  const sameBodyPart = curBp !== 'unknown' && curBp === priBp;
  const sameModality = !!curMod && curMod === priMod;

  if (sameBodyPart && sameModality) {
    return SAME_MODALITY_SAME_BODY_PART;
  }

  if (sameBodyPart) {
    const key = `${curMod}>${priMod}`;
    return SAME_BODY_PART_MODALITY_PAIR[key] ?? SAME_BODY_PART_DIFFERENT_MODALITY_DEFAULT;
  }

  // If we couldn't parse a body part for one/both studies, don't assume they're
  // unrelated — lean on modality so a same-modality prior still qualifies. This
  // keeps the primary goal (compare against the obvious prior) working even with
  // cryptic study descriptions.
  if (curBp === 'unknown' || priBp === 'unknown') {
    return sameModality ? SAME_MODALITY_UNKNOWN_BODY_PART : DIFFERENT_MODALITY_UNKNOWN_BODY_PART;
  }

  // Both body parts known and different — use the cross-anatomy overlap table.
  //
  // Retry with the CERVICAL level folded. The table is keyed on bare 'spine' while
  // getBodyPart returns 'spine-cervical' / '-thoracic' / '-lumbar' whenever the
  // description names a level — which is most of the time — so every entry touching
  // spine was unreachable in practice: a neck prior against a cervical spine study
  // looked up 'spine-cervical>neck', missed, and scored 0 where the table says 40.
  // Trying the exact key first keeps a future region-specific entry able to win.
  // Cross-REGION spine pairs never arrive here; spineRegionGate disqualified them.
  return (
    CROSS_BODY_PART[`${curBp}>${priBp}`] ??
    CROSS_BODY_PART[`${crossBodySpine(curBp)}>${crossBodySpine(priBp)}`] ??
    0
  );
};

export default baseRelevance;
