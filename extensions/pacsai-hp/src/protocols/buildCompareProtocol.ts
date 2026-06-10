import type { Types } from '@ohif/core';

/**
 * Builds a modality-aware current-vs-prior comparison protocol from a compact
 * config of series *selectors* and *stages*.
 *
 * IMPORTANT: the protocol matches on the current study (modality, and optionally
 * body part / exam) — it does NOT require a prior to exist. This lets it become
 * the active protocol on a fresh single-study load so the prior loader can read
 * its policy and re-hang with the loaded prior. Prior viewports stay unmatched
 * (and their stages disabled) until a prior is loaded.
 *
 * - `selectors` define how to pick series for the current and prior study
 *   (e.g. axial recon, T2 sequence). Each becomes `current-<key>` / `prior-<key>`
 *   display-set selectors keyed on `studyInstanceUIDsIndex` (0 = current, 1 = prior).
 * - `stages` define the current|prior layouts you cycle with next/previous stage,
 *   each referencing a selector and optionally applying a window (VOI) preset.
 *
 * Exam-specific protocols (spine, chest, head, brain) set `bodyPartKeywords` so
 * they out-weight the generic per-modality protocol when the exam matches, and
 * fall back to it otherwise. Selection is by weight in `ProtocolEngine`.
 */

// Window/VOI presets in Hounsfield units (CT) — applied via displaySet options.
export const WINDOW = {
  lung: { windowWidth: 1500, windowCenter: -600 },
  softTissue: { windowWidth: 400, windowCenter: 40 },
  bone: { windowWidth: 2000, windowCenter: 500 },
  brain: { windowWidth: 80, windowCenter: 40 },
} as const;

type VOI = { windowWidth: number; windowCenter: number };

type SelectorDef = {
  /** Short key, e.g. 'ax', 't2'. */
  key: string;
  /**
   * Match a computed image plane (axial/coronal/sagittal) via the `pacsaiPlane`
   * custom attribute — robust to MPR reformats whose description omits the plane.
   */
  plane?: 'axial' | 'coronal' | 'sagittal';
  /**
   * Match the reconstruction kernel class via the `pacsaiKernel` custom attribute
   * ('soft' = smooth/brain kernel, 'bone' = sharp kernel). Robust to descriptions
   * that omit "bone" (classified from ConvolutionKernel, description as fallback).
   */
  kernel?: 'soft' | 'bone';
  /** SeriesDescription must contain ANY of these (case-insensitive). Omit for "any image series". */
  keywords?: string[];
  /** SeriesDescription must NOT contain any of these (e.g. exclude FLAIR from a T2 selector). */
  excludeKeywords?: string[];
};

type StageDef = {
  name: string;
  /** Selector key to display, current beside prior. */
  selector: string;
  /** Optional window preset applied to both viewports. */
  voi?: VOI;
};

export type CompareConfig = {
  id: string;
  name: string;
  description: string;
  /** Modalities (uppercase) that select this protocol, matched against ModalitiesInStudy. */
  modalities: string[];
  /** If set, the StudyDescription must contain one of these — makes the protocol exam-specific. */
  bodyPartKeywords?: string[];
  /** Base weight of the modality rule (default 100). Body-part rule adds 2x when present. */
  matchWeight?: number;
  /** Minimum numImageFrames for a series to qualify (default 5; excludes scouts). CR uses 0. */
  seriesFloor?: number;
  /** Exclude topogram/scout/localizer by description (default true). */
  excludeScouts?: boolean;
  selectors: SelectorDef[];
  stages: StageDef[];
};

// The HP matcher reads a `from` source on rules; core's MatchingRule omits it.
// The validator also supports case-insensitive containsI/doesNotContainI and
// array constraint values which the Constraint type under-specifies.
type LooseConstraint = {
  equals?: { value: number | string | boolean };
  greaterThan?: { value: number };
  contains?: string[];
  containsI?: string | string[];
  doesNotContainI?: string | string[];
};
type Rule = {
  attribute: string;
  from?: string;
  weight?: number;
  required?: boolean;
  constraint?: LooseConstraint;
};

const compareViewportOptions = {
  toolGroupId: 'default',
  allowUnmatchedView: true,
};

const SCOUT_WORDS = ['topogram', 'scout', 'localizer'];
const ROLES = ['current', 'prior'] as const;
type Role = (typeof ROLES)[number];
const ROLE_INDEX: Record<Role, number> = { current: 0, prior: 1 };

function studyRule(role: Role): Rule {
  return {
    attribute: 'studyInstanceUIDsIndex',
    from: 'options',
    required: true,
    constraint: { equals: { value: ROLE_INDEX[role] } },
  };
}

export function buildCompareProtocol(cfg: CompareConfig): Types.HangingProtocol.Protocol {
  const {
    id,
    name,
    description,
    modalities,
    bodyPartKeywords,
    matchWeight = 100,
    seriesFloor = 5,
    excludeScouts = true,
    selectors,
    stages,
  } = cfg;

  const seriesRulesFor = (sel: SelectorDef): Rule[] => {
    const rules: Rule[] = [
      { attribute: 'numImageFrames', required: true, constraint: { greaterThan: { value: seriesFloor } } },
    ];
    if (excludeScouts) {
      rules.push({ attribute: 'SeriesDescription', constraint: { doesNotContainI: SCOUT_WORDS } });
    }
    if (sel.plane) {
      // Match the computed plane (orientation-based) rather than the description.
      rules.push({ attribute: 'pacsaiPlane', required: true, constraint: { equals: { value: sel.plane } } });
    }
    if (sel.kernel) {
      // Match the computed kernel class (soft/bone) from ConvolutionKernel.
      rules.push({ attribute: 'pacsaiKernel', required: true, constraint: { equals: { value: sel.kernel } } });
    }
    if (sel.keywords?.length) {
      rules.push({ attribute: 'SeriesDescription', required: true, constraint: { containsI: sel.keywords } });
    }
    if (sel.excludeKeywords?.length) {
      rules.push({ attribute: 'SeriesDescription', constraint: { doesNotContainI: sel.excludeKeywords } });
    }
    return rules;
  };

  const displaySetSelectors: Record<string, any> = {};
  selectors.forEach(sel => {
    ROLES.forEach(role => {
      displaySetSelectors[`${role}-${sel.key}`] = {
        studyMatchingRules: [studyRule(role)],
        seriesMatchingRules: seriesRulesFor(sel),
      };
    });
  });

  // Scroll-sync current vs prior. The sync id is scoped per selector (plane /
  // sequence) so the axial pair scrolls together but the "Current (3 planes)"
  // fallback doesn't cross-sync different planes. `imageslice` syncs the scrolled
  // slice and works across studies (different frames of reference).
  const viewport = (role: Role, selectorKey: string, voi?: VOI) => ({
    viewportOptions: {
      ...compareViewportOptions,
      syncGroups: [
        // Cross-study relative scroll sync (registered by the extension as
        // 'pacsaiscroll'); the built-in 'imageslice' sync is position-based and
        // does not work across different studies / frames of reference.
        { type: 'pacsaiscroll', id: `${id}-scroll-${selectorKey}`, source: true, target: true },
      ],
    },
    displaySets: [{ id: `${role}-${selectorKey}`, ...(voi ? { options: { voi } } : {}) }],
  });

  // Current|prior stages (min 2 matched → only active once a prior is loaded),
  // in the configured order, followed by a current-only fallback (min 1).
  const cpStages = stages.map((st, i) => ({
    id: `${st.selector}-${i}-cp`,
    name: st.name,
    // Require BOTH viewports (current + prior) to fill. `passive` also at 2 means
    // a stage that can't match both becomes 'disabled' (skipped on next/previous)
    // rather than a navigable empty stage that errors.
    stageActivation: {
      enabled: { minViewportsMatched: 2 },
      passive: { minViewportsMatched: 2 },
    },
    viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 2 } },
    viewports: [viewport('current', st.selector, st.voi), viewport('prior', st.selector, st.voi)],
  }));

  const distinctSelectors = [...new Set(stages.map(s => s.selector))];
  const fallbackStage = {
    id: 'current-only',
    name: 'Current',
    stageActivation: {
      enabled: { minViewportsMatched: 1 },
      passive: { minViewportsMatched: 1 },
    },
    viewportStructure: {
      layoutType: 'grid',
      properties: { rows: 1, columns: distinctSelectors.length },
    },
    viewports: distinctSelectors.map(key => viewport('current', key)),
  };

  const protocolMatchingRules: Rule[] = [
    {
      id: `${id}-modality`,
      weight: matchWeight,
      required: true,
      attribute: 'ModalitiesInStudy',
      constraint: { contains: modalities },
    },
  ];
  if (bodyPartKeywords?.length) {
    protocolMatchingRules.push({
      id: `${id}-bodypart`,
      weight: matchWeight * 2,
      required: true,
      attribute: 'StudyDescription',
      constraint: { containsI: bodyPartKeywords },
    });
  }

  return {
    id,
    name,
    description,
    protocolMatchingRules,
    toolGroupIds: ['default'],
    numberOfPriorsReferenced: 1,
    displaySetSelectors,
    defaultViewport: {
      viewportOptions: { viewportType: 'stack', toolGroupId: 'default', allowUnmatchedView: true },
      displaySets: [{ id: `current-${selectors[0].key}`, matchedDisplaySetsIndex: -1 }],
    },
    stages: [...cpStages, fallbackStage],
  } as Types.HangingProtocol.Protocol;
}

// Common selector sets reused across protocols. Plane is matched via the
// computed `pacsaiPlane` attribute (orientation-based), so these work even when
// the SeriesDescription omits the plane.
export const PLANE_SELECTORS: SelectorDef[] = [
  { key: 'ax', plane: 'axial' },
  { key: 'cor', plane: 'coronal' },
  { key: 'sag', plane: 'sagittal' },
];

export default buildCompareProtocol;
