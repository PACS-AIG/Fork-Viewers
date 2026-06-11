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
 *   display-set selectors keyed on the `pacsaiRole` attribute (current/prior),
 *   so matching is independent of study load order (see roleRegistry).
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
   * Prefer (but do not require) a plane — adds weight so that, when multiple
   * planes of a series exist, this one wins; but a series in another plane still
   * matches (e.g. a 3D sagittal-acquired MR sequence when no axial exists).
   */
  preferPlane?: 'axial' | 'coronal' | 'sagittal';
  /**
   * Match the reconstruction kernel class via the `pacsaiKernel` custom attribute
   * ('soft' = smooth kernel, 'lung' / 'bone' = sharp kernels). Robust to
   * descriptions that omit the kernel (classified from ConvolutionKernel, with
   * description as fallback).
   */
  kernel?: 'soft' | 'lung' | 'bone';
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
  /**
   * Selector keys to tile in the current study when NO prior is available, most
   * important first (e.g. ['ax','cor','sag']). The builder emits descending-density
   * stages so the engine auto-picks the densest layout whose every pane matched —
   * no empty panes when a view is absent. Defaults to the distinct stage selectors.
   */
  currentView?: string[];
  selectors: SelectorDef[];
  stages: StageDef[];
  /**
   * Optional whole-region overview that tiles the SAME-SESSION sibling exams of a
   * multi-part study (e.g. the cervical/thoracic/lumbar spine acquired together)
   * side by side. Unlike the current/prior stages, overview viewports are
   * region-addressable (matched by `pacsaiSpineRegion` + plane across ALL loaded
   * studies, regardless of role/order), so each region's series lands in its own
   * pane.
   *
   * Emits ONE whole-spine stage per `view` (e.g. T2 sag, STIR sag, T1 sag,
   * T1 sag +C), in order — the radiologist works down the sequence list, each
   * tiled across the spine. A stage tiles WHATEVER regions are loaded (panes use
   * allowUnmatchedView, so an absent region/sequence just renders empty) and
   * activates only when >= 2 regions have that view; a single region falls through
   * to the per-region compare / current-only stages. Axials are intentionally NOT
   * tiled here — they are reviewed per region via those later stages. Requires the
   * prior loader to fetch the same-session sibling studies.
   */
  overview?: {
    /** Regions to tile, in anatomical (display) order. */
    regions: Array<{ key: string; region: 'cervical' | 'thoracic' | 'lumbar' }>;
    /** One whole-spine stage per view (sequence/plane), in display order. */
    views: Array<{
      /** Short key, e.g. 't2','stir','t1','t1post'. Used in selector/stage ids. */
      key: string;
      /** Stage name shown in the UI (e.g. "Whole spine T2 sag"). */
      name: string;
      /** Plane to show for each region (default 'sagittal'). */
      plane?: 'axial' | 'coronal' | 'sagittal';
      /** SeriesDescription must contain ANY of these (e.g. ['t2']). */
      keywords?: string[];
      /** SeriesDescription must NOT contain any of these (e.g. exclude 'stir' from T2). */
      excludeKeywords?: string[];
    }>;
  };
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

// Series are matched by comparison ROLE (current/prior/sibling) via the
// `pacsaiRole` custom attribute, NOT by study order (studyInstanceUIDsIndex).
// Order-based matching breaks once same-session siblings are loaded (a sibling
// would occupy index 1 and be matched by the `prior` selector); roles decouple
// matching from load order. This is a series-level rule because the attribute is
// computed from the display set's study.
function roleRule(role: string): Rule {
  return { attribute: 'pacsaiRole', required: true, constraint: { equals: { value: role } } };
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
    currentView,
    selectors,
    stages,
    overview,
  } = cfg;

  const seriesRulesFor = (sel: SelectorDef): Rule[] => {
    // numImageFrames is a soft (scored, NOT required) filter: enhanced/multiframe
    // series (one multiframe object, instance-level frame metadata) can read as
    // unsatisfied here and would be wrongly disqualified if required. Scouts are
    // excluded by the SCOUT_WORDS description rule below instead of by frame count.
    const rules: Rule[] = [
      { attribute: 'numImageFrames', constraint: { greaterThan: { value: seriesFloor } } },
    ];
    if (excludeScouts) {
      rules.push({ attribute: 'SeriesDescription', constraint: { doesNotContainI: SCOUT_WORDS } });
    }
    if (sel.plane) {
      // Match the computed plane (orientation-based) rather than the description.
      rules.push({ attribute: 'pacsaiPlane', required: true, constraint: { equals: { value: sel.plane } } });
    }
    if (sel.preferPlane) {
      // Weighted, NOT required: prefers this plane but still matches others.
      rules.push({ attribute: 'pacsaiPlane', weight: 10, constraint: { equals: { value: sel.preferPlane } } });
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

  // studyMatchingRules are empty: the matcher then scans ALL loaded studies and
  // the `pacsaiRole`/`pacsaiSpineRegion` series rules pick the right one(s).
  const displaySetSelectors: Record<string, any> = {};
  selectors.forEach(sel => {
    ROLES.forEach(role => {
      displaySetSelectors[`${role}-${sel.key}`] = {
        studyMatchingRules: [],
        seriesMatchingRules: [roleRule(role), ...seriesRulesFor(sel)],
      };
    });
  });

  // Generic catch-all selector for the current study: ANY current-study series,
  // with only the role rule. Guarantees the protocol always hangs something
  // (never blank, never "Can't find applicable stage") even for enhanced/
  // multiframe series whose numImageFrames can't be matched.
  displaySetSelectors['anyCurrent'] = {
    studyMatchingRules: [],
    seriesMatchingRules: [roleRule('current')],
  };

  // Region-addressable overview selectors, one per (view, region): match a series
  // by spine region + plane + sequence keywords across ANY loaded study (no role
  // rule), so the current study and its loaded same-session siblings each tile
  // into their own region pane.
  (overview?.views ?? []).forEach(view => {
    const plane = view.plane ?? 'sagittal';
    (overview?.regions ?? []).forEach(r => {
      const rules: Rule[] = [
        { attribute: 'pacsaiSpineRegion', required: true, constraint: { equals: { value: r.region } } },
        { attribute: 'pacsaiPlane', required: true, constraint: { equals: { value: plane } } },
      ];
      if (excludeScouts) {
        rules.push({ attribute: 'SeriesDescription', required: true, constraint: { doesNotContainI: SCOUT_WORDS } });
      }
      if (view.keywords?.length) {
        rules.push({ attribute: 'SeriesDescription', required: true, constraint: { containsI: view.keywords } });
      }
      if (view.excludeKeywords?.length) {
        rules.push({ attribute: 'SeriesDescription', required: true, constraint: { doesNotContainI: view.excludeKeywords } });
      }
      displaySetSelectors[`overview-${view.key}-${r.key}`] = {
        studyMatchingRules: [],
        seriesMatchingRules: rules,
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

  // Current|prior stages — require BOTH current and prior matched (enabled and
  // passive minViewportsMatched = 2). A comparison stage therefore exists only
  // when there is a real pair to compare; it never renders an empty prior half.
  // Current-only content (no prior, or a series the prior lacks) is shown by the
  // multi-view current-only stages below instead.
  const cpStages = stages.map((st, i) => ({
    id: `${st.selector}-${i}-cp`,
    name: st.name,
    stageActivation: {
      enabled: { minViewportsMatched: 2 },
      passive: { minViewportsMatched: 2 },
    },
    viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 2 } },
    viewports: [viewport('current', st.selector, st.voi), viewport('prior', st.selector, st.voi)],
  }));

  const distinctSelectors = [...new Set(stages.map(s => s.selector))];

  // Current-only multi-view (used when no prior is available). Validate the
  // configured keys against actual selectors; default to the distinct stage
  // selectors. Most-important key first — stages drop from the end.
  const currentViewKeys = (currentView?.length ? currentView : distinctSelectors).filter(key =>
    selectors.some(s => s.key === key)
  );

  // Descending-density stages: [k..1] panes. Each requires all its panes matched
  // (enabled & passive minViewportsMatched = k), so the engine auto-selects the
  // densest layout whose every current view is present — never an empty pane.
  const fallbackStages = [];
  for (let k = currentViewKeys.length; k >= 1; k--) {
    const keys = currentViewKeys.slice(0, k);
    fallbackStages.push({
      id: `current-only-${k}`,
      name: 'Current',
      stageActivation: {
        enabled: { minViewportsMatched: k },
        passive: { minViewportsMatched: k },
      },
      viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: k } },
      viewports: keys.map(key => viewport('current', key)),
    });
  }

  // Guaranteed last-resort stage so the protocol NEVER fails to hang.
  // `passive: minViewportsMatched 0` means it is never 'disabled' (matches how
  // the stock `default` protocol stays applicable even with 0 matched viewports),
  // so _setProtocol can always find an applicable stage.
  const safetyStage = {
    id: 'current-any',
    name: 'Current',
    stageActivation: {
      enabled: { minViewportsMatched: 1 },
      passive: { minViewportsMatched: 0 },
    },
    viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 1 } },
    viewports: [
      { viewportOptions: compareViewportOptions, displaySets: [{ id: 'anyCurrent' }] },
    ],
  };

  // Whole-region overview: one LEAD stage per view (sequence), in order — the
  // radiologist works down the sequence list (T2 sag, STIR sag, T1 sag, T1 +C),
  // each tiled across the spine. Panes use `allowUnmatchedView`, so an absent
  // region/sequence renders empty rather than spawning subset stages (which would
  // clutter next/prev navigation). Each stage activates when >= 2 regions have
  // that view (enabled & passive minViewportsMatched = 2): 3 regions -> 3 filled;
  // 2 -> 2 filled + 1 empty; a single region falls through to the per-region
  // compare / current-only stages. Requires the prior loader to fetch the siblings.
  const overviewStages = [];
  if (overview?.regions?.length && overview?.views?.length) {
    const regions = overview.regions;
    const minRegions = Math.min(2, regions.length);
    overview.views.forEach(view => {
      overviewStages.push({
        id: `overview-${view.key}`,
        name: view.name,
        stageActivation: {
          enabled: { minViewportsMatched: minRegions },
          passive: { minViewportsMatched: minRegions },
        },
        viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: regions.length } },
        viewports: regions.map(r => ({
          viewportOptions: compareViewportOptions,
          displaySets: [{ id: `overview-${view.key}-${r.key}` }],
        })),
      });
    });
  }

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
    stages: [...overviewStages, ...cpStages, ...fallbackStages, safetyStage],
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
