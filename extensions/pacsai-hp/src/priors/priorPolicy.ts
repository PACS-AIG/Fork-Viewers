import type { PriorPolicy } from './types';
import baseRelevance from './scorers/baseRelevance';
import recency from './scorers/recency';
import indication from './scorers/indication';
import spineRegionGate from './scorers/spineRegion';

/**
 * Per-protocol prior-selection policies, keyed by hanging-protocol id. These are
 * the defaults; deployments can override `minScore` / `maxPriors` (and could
 * extend the map for additional protocols) via the customization service under
 * the `pacsai.priorPolicy` key.
 */
// spineRegionGate first so a cross-region spine sibling is hard-disqualified
// regardless of any recency/indication bonus the other scorers would add.
const DEFAULT_SCORERS = [spineRegionGate, baseRelevance, recency, indication];

// All pacsai compare protocols hang current vs a single most-relevant prior, so
// they share one default policy. A protocol-specific entry here overrides it.
const COMPARE_DEFAULT: PriorPolicy = { scorers: DEFAULT_SCORERS, minScore: 30, maxPriors: 1 };

const DEFAULT_POLICIES: Record<string, PriorPolicy> = {};

/** Returns true for any pacsai comparison protocol id. */
function isCompareProtocol(protocolId: string): boolean {
  return protocolId.startsWith('@pacsai/compare');
}

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
  const base =
    DEFAULT_POLICIES[protocolId] ?? (isCompareProtocol(protocolId) ? COMPARE_DEFAULT : undefined);
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
