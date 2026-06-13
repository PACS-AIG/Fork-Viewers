/**
 * Prior relevance scoring types.
 *
 * Prior selection is a *scoring pipeline*: each prior study is run through a list
 * of composable scorer functions whose outputs are summed into a final score.
 * Priors are then filtered by a minimum score and sorted descending so the most
 * clinically-relevant prior hangs next to the current study first.
 *
 * The actual point values (modality x body-part matrix, recency buckets,
 * indication weights) live in the individual scorers and are intended to be
 * tuned per-deployment via the customization service.
 */

/** A lightweight view of the metadata a scorer needs about a study. */
export type StudyLike = {
  StudyInstanceUID: string;
  StudyDate?: string;
  /** Study time (00080030), HHMMSS[.frac]. Used with StudyDate for interval comparisons. */
  StudyTime?: string;
  StudyDescription?: string;
  /** Single modality if known (e.g. from QIDO mapping). */
  Modality?: string;
  /** Array/string of modalities present in the study (00080061). */
  ModalitiesInStudy?: string[] | string;
  /** Body part if available (00180015). */
  BodyPartExamined?: string;
  [key: string]: unknown;
};

export type PriorContext = {
  current: StudyLike;
  prior: StudyLike;
};

/**
 * A scorer returns a number of points for a (current, prior) pair. Points may be
 * negative (e.g. a stale prior). A scorer MUST degrade gracefully when the
 * metadata it relies on is missing — return 0 rather than throwing.
 */
export type PriorScorer = (ctx: PriorContext) => number;

/**
 * Per-protocol prior-selection policy. Keyed by hanging-protocol id in
 * `priorPolicy.ts`. All fields are overridable via the customization service.
 */
export type PriorPolicy = {
  /** Ordered list of scorers summed to produce the final relevance score. */
  scorers: PriorScorer[];
  /** Priors scoring strictly below this are discarded. */
  minScore: number;
  /** Maximum number of priors to auto-load and hang. */
  maxPriors: number;
};
