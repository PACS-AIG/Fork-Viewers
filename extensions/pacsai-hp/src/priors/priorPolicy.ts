import type { PriorPolicy } from './types';
import baseRelevance from './scorers/baseRelevance';
import recency from './scorers/recency';
import indication from './scorers/indication';

/**
 * Per-protocol prior-selection policies, keyed by hanging-protocol id. These are
 * the defaults; deployments can override `minScore` / `maxPriors` (and could
 * extend the map for additional protocols) via the customization service under
 * the `pacsai.priorPolicy` key.
 */
const DEFAULT_SCORERS = [baseRelevance, recency, indication];

const DEFAULT_POLICIES: Record<string, PriorPolicy> = {
  '@pacsai/compareCT': { scorers: DEFAULT_SCORERS, minScore: 30, maxPriors: 2 },
  '@pacsai/compareMR': { scorers: DEFAULT_SCORERS, minScore: 30, maxPriors: 2 },
  '@pacsai/compareCR': { scorers: DEFAULT_SCORERS, minScore: 30, maxPriors: 1 },
};

export const PRIOR_POLICY_CUSTOMIZATION_KEY = 'pacsai.priorPolicy';

type PolicyOverride = Partial<Pick<PriorPolicy, 'minScore' | 'maxPriors'>>;

/**
 * Resolve the prior policy for a protocol, applying any customization-service
 * override. Returns undefined for protocols that have no policy (i.e. ones that
 * should not auto-load priors).
 */
export function getPriorPolicy(
  protocolId: string,
  customizationService?: { getCustomization?: (key: string) => unknown }
): PriorPolicy | undefined {
  const base = DEFAULT_POLICIES[protocolId];
  if (!base) {
    return undefined;
  }

  const overrides = customizationService?.getCustomization?.(PRIOR_POLICY_CUSTOMIZATION_KEY) as
    | Record<string, PolicyOverride>
    | undefined;

  const override = overrides?.[protocolId];
  if (!override) {
    return base;
  }

  return {
    ...base,
    ...(override.minScore !== undefined ? { minScore: override.minScore } : {}),
    ...(override.maxPriors !== undefined ? { maxPriors: override.maxPriors } : {}),
  };
}

export { DEFAULT_POLICIES };
