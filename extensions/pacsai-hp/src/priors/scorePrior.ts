import type { PriorContext, PriorScorer } from './types';

/**
 * Run a (current, prior) pair through a list of scorers and sum the results.
 * Scorers are independent and individually fault-tolerant, so the total is just
 * their sum. Higher is more relevant.
 */
export function scorePrior(ctx: PriorContext, scorers: PriorScorer[]): number {
  return scorers.reduce((total, scorer) => {
    try {
      return total + (scorer(ctx) || 0);
    } catch {
      // A misbehaving scorer must never break prior selection.
      return total;
    }
  }, 0);
}

export default scorePrior;
