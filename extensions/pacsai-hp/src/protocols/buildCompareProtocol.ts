import type { Types } from '@ohif/core';

/**
 * Builds a modality-aware current-vs-prior comparison protocol.
 *
 * IMPORTANT: the protocol matches on the CURRENT study's modality only — it does
 * NOT require a prior to exist. This lets it become the active protocol on a
 * fresh single-study load so the prior loader can read its policy and then
 * re-hang with the loaded priors. Prior viewports simply stay unmatched until
 * priors are loaded; `minViewportsMatched` + `allowUnmatchedView` keep the
 * current-only stage valid in the meantime.
 *
 * Study selectors are keyed on `studyInstanceUIDsIndex` (0 = current, 1 = first
 * prior, ...), which the loader controls by ordering the studies array.
 */

type BuildOptions = {
  id: string;
  /** Human-readable protocol name shown in the layout selector. */
  name: string;
  description: string;
  /** Modalities (uppercase) that select this protocol, matched against ModalitiesInStudy. */
  modalities: string[];
  /** Maximum number of priors this protocol can display side-by-side. */
  maxPriors: number;
  /** Weight for the modality protocol-matching rule (must beat the empty `default`). */
  matchWeight?: number;
};

const compareViewportOptions = {
  toolGroupId: 'default',
  allowUnmatchedView: true,
};

/** Selector id for the study at a given index (0 = current). */
function selectorId(index: number): string {
  return index === 0 ? 'currentDisplaySetId' : `priorDisplaySetId${index}`;
}

// The HP matcher (HPMatcher.js) reads a `from` source on matching rules
// (e.g. 'options' to read studyInstanceUIDsIndex), but the core MatchingRule
// type does not declare it. Extend it locally so annotated literals type-check.
type MatchingRuleWithFrom = Types.HangingProtocol.MatchingRule & { from?: string };

function buildStudySelector(index: number): Types.HangingProtocol.DisplaySetSelector {
  const studyMatchingRules: MatchingRuleWithFrom[] = [
    {
      attribute: 'studyInstanceUIDsIndex',
      from: 'options',
      required: true,
      constraint: {
        equals: { value: index },
      },
    },
  ];

  return {
    studyMatchingRules,
    seriesMatchingRules: [
      {
        attribute: 'numImageFrames',
        constraint: {
          greaterThan: { value: 0 },
        },
      },
    ],
  };
}

function buildViewport(index: number): Types.HangingProtocol.Viewport {
  return {
    viewportOptions: compareViewportOptions,
    displaySets: [{ id: selectorId(index) }],
  };
}

export function buildCompareProtocol(options: BuildOptions): Types.HangingProtocol.Protocol {
  const { id, name, description, modalities, maxPriors, matchWeight = 100 } = options;

  // Total studies the densest stage can show: current + maxPriors.
  const maxStudies = maxPriors + 1;

  // One selector per study slot (current + each prior).
  const displaySetSelectors: Record<string, Types.HangingProtocol.DisplaySetSelector> = {};
  for (let i = 0; i < maxStudies; i++) {
    displaySetSelectors[selectorId(i)] = buildStudySelector(i);
  }

  // Stages from densest (current + maxPriors) down to current-only. Each is gated
  // by minViewportsMatched so the densest stage that actually has matches wins.
  const stages: Types.HangingProtocol.ProtocolStage[] = [];
  for (let studies = maxStudies; studies >= 1; studies--) {
    stages.push({
      id: `${studies}-up`,
      name: studies === 1 ? 'Current' : `Current + ${studies - 1} prior${studies - 1 > 1 ? 's' : ''}`,
      stageActivation: {
        enabled: {
          minViewportsMatched: studies,
        },
      },
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: studies,
        },
      },
      viewports: Array.from({ length: studies }, (_, i) => buildViewport(i)),
    });
  }

  return {
    id,
    name,
    description,
    // Match on the current study's modality; do NOT require a prior.
    protocolMatchingRules: [
      {
        id: `${id}-modality`,
        weight: matchWeight,
        attribute: 'ModalitiesInStudy',
        // `contains` with an array matches when ModalitiesInStudy includes ANY
        // of the listed modalities (see HP validator `contains`).
        constraint: {
          contains: modalities,
        },
      },
    ],
    toolGroupIds: ['default'],
    // Positive value: prior studies participate in matching (not active-only).
    numberOfPriorsReferenced: maxPriors,
    displaySetSelectors,
    defaultViewport: {
      viewportOptions: {
        viewportType: 'stack',
        toolGroupId: 'default',
        allowUnmatchedView: true,
      },
      displaySets: [
        {
          id: 'currentDisplaySetId',
          matchedDisplaySetsIndex: -1,
        },
      ],
    },
    stages,
  };
}

export default buildCompareProtocol;
