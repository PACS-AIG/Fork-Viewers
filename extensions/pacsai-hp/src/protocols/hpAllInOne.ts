import type { Types } from '@ohif/core';

/**
 * Mode-2 "all-in-one only" protocol (browsing mode). Hangs ONLY the all-in-one
 * composite: the current study's everything-in-one-scroll, and — when a prior
 * exists — the prior's all-in-one beside it (independent scroll). No diagnostic
 * compare stages.
 *
 * Never auto-selected (empty `protocolMatchingRules`, so it scores 0 in the engine);
 * applied only when the reader picks "all-in-one only", forced via
 * `hangingProtocolService.run(studies, '@pacsai/allInOne')`. Prior discovery still
 * happens under the auto-matched compare protocol on initial load (this protocol
 * needs no prior policy); the browsing-mode switch is a pure re-hang over the
 * already-loaded studies.
 *
 * Matches the composite built by loadRelevantPriors via the `pacsaiAllInOne` marker
 * + `pacsaiRole`. The composite carries the study's real UID, so `pacsaiRole` sorts
 * it current/prior automatically. Shares the selector/stage shape with the all-in-one
 * stage appended to the compare protocols (buildCompareProtocol), so they behave
 * identically.
 */
const allInOneSelector = (role: 'current' | 'prior') => ({
  studyMatchingRules: [],
  seriesMatchingRules: [
    { attribute: 'pacsaiRole', required: true, constraint: { equals: { value: role } } },
    { attribute: 'pacsaiAllInOne', required: true, constraint: { equals: { value: 'allinone' } } },
  ],
});

// Forced stack (mixed geometry/modality must never attempt a volume). The 2-up
// (current|prior) gets plane-grouped scroll sync — scrolling sagittals shows the
// prior's sagittals, axials its axials, etc. (same sync id on both panes); the 1-up
// passes no sync.
const allInOneViewport = (role: 'current' | 'prior', sync = false) => ({
  viewportOptions: {
    toolGroupId: 'default',
    allowUnmatchedView: true,
    viewportType: 'stack',
    ...(sync
      ? {
          syncGroups: [
            {
              type: 'pacsaiallinonescroll',
              id: '@pacsai/allInOne-allinone-scroll',
              source: true,
              target: true,
            },
          ],
        }
      : {}),
  },
  displaySets: [{ id: `${role}-allinone` }],
});

const compareViewportOptions = { toolGroupId: 'default', allowUnmatchedView: true };

export const hpAllInOne: Types.HangingProtocol.Protocol = {
  id: '@pacsai/allInOne',
  name: 'All-in-one',
  description: 'Single concatenated scroll-through of the whole study (and prior, side by side).',
  // Empty: never auto-matched. Applied only by the browsing-mode switch (forced run).
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 1,
  displaySetSelectors: {
    'current-allinone': allInOneSelector('current'),
    'prior-allinone': allInOneSelector('prior'),
    // Last-resort current series (used by the safety stage below).
    anyCurrent: {
      studyMatchingRules: [],
      seriesMatchingRules: [
        { attribute: 'pacsaiRole', required: true, constraint: { equals: { value: 'current' } } },
      ],
    },
  },
  defaultViewport: {
    viewportOptions: { viewportType: 'stack', toolGroupId: 'default', allowUnmatchedView: true },
    displaySets: [{ id: 'current-allinone', matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      id: 'allinone-cp',
      name: 'All-in-one (current/prior)',
      stageActivation: {
        enabled: { minViewportsMatched: 2 },
        passive: { minViewportsMatched: 2 },
      },
      viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 2 } },
      viewports: [allInOneViewport('current', true), allInOneViewport('prior', true)],
    },
    {
      id: 'allinone',
      name: 'All-in-one',
      stageActivation: {
        enabled: { minViewportsMatched: 1 },
        passive: { minViewportsMatched: 1 },
      },
      viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 1 } },
      viewports: [allInOneViewport('current')],
    },
    {
      // A study with no composite (e.g. pure ultrasound) still hangs something rather
      // than a blank viewport. passive minViewportsMatched 0 => never 'disabled'.
      id: 'current-any',
      name: 'Current',
      stageActivation: {
        enabled: { minViewportsMatched: 1 },
        passive: { minViewportsMatched: 0 },
      },
      viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 1 } },
      viewports: [{ viewportOptions: compareViewportOptions, displaySets: [{ id: 'anyCurrent' }] }],
    },
  ],
} as Types.HangingProtocol.Protocol;

export default hpAllInOne;
