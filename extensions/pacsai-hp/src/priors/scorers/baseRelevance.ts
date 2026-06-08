import type { PriorContext, PriorScorer } from '../types';
import { getBodyPart, getModality } from '../metadata';

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

/** Treat projection radiography modalities as one family. */
function modalityFamily(modality?: string): string | undefined {
  if (!modality) {
    return undefined;
  }
  if (modality === 'CR' || modality === 'DX' || modality === 'XR' || modality === 'RG') {
    return 'XR';
  }
  return modality;
}

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

export const baseRelevance: PriorScorer = ({ current, prior }: PriorContext): number => {
  const curMod = modalityFamily(getModality(current));
  const priMod = modalityFamily(getModality(prior));
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

  // Different (or unknown) body part — fall back to cross-anatomy overlap table.
  const crossKey = `${curBp}>${priBp}`;
  return CROSS_BODY_PART[crossKey] ?? 0;
};

export default baseRelevance;
