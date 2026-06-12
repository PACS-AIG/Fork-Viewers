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
   * region-addressable (matched by `pacsaiRegionTimepoint` = `<region>-session`
   * + plane across all loaded studies — priors excluded), so each region's
   * current-session series lands in its own pane.
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
  /**
   * Optional per-region CURRENT-vs-PRIOR compare. For each loaded region and each
   * view, emits a 2-up [session | prior] stage, region-major (cervical's views,
   * then thoracic's, then lumbar's). Each region pairs with ITS OWN prior (via
   * `pacsaiRegionTimepoint`). A stage is `enabled` (auto-eligible) when both
   * session and prior match, `passive` (manually reachable, session + empty prior)
   * when only the session is present, and `disabled` (skipped) otherwise — so it
   * doubles as the per-region current-only view. Reuses `overview.regions`. When
   * set, it REPLACES the generic current/prior + current-only stages for this
   * protocol (those assume a single region and would mis-pair across regions).
   */
  regionCompare?: {
    /**
     * Regions to compare, each `{ key, region }`. `region` must equal the value the
     * region attribute yields (e.g. spine: 'cervical'; body-part: 'head', 'neck',
     * 'spine-lumbar'). Defaults to `overview.regions` when omitted (spine reuses
     * the survey's regions).
     */
    regions?: Array<{ key: string; region: string; label?: string }>;
    views: Array<{
      key: string;
      /** Short label appended after the region (e.g. "axial T2" -> "Lumbar axial T2"). */
      name: string;
      /** Plane (default 'axial'). */
      plane?: 'axial' | 'coronal' | 'sagittal';
      keywords?: string[];
      excludeKeywords?: string[];
    }>;
  };
  /**
   * Custom attribute that yields `<region>-<timepoint>` for region-addressable
   * matching (overview + regionCompare). Default `pacsaiRegionTimepoint` (spine
   * cervical/thoracic/lumbar). Overridable should another spanning protocol ever
   * need a different region keyspace.
   */
  regionAttribute?: string;
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
    regionCompare,
    regionAttribute = 'pacsaiRegionTimepoint',
  } = cfg;

  // Regions used by per-region compare: its own list, else the survey's.
  const regionCompareRegions = regionCompare?.regions ?? overview?.regions ?? [];

  // Region-addressable series rules (region + timepoint + plane + sequence
  // keywords), matched across ANY loaded study (no role rule). Shared by the
  // whole-spine survey (timepoint 'session') and the per-region compare panes
  // ('session' vs 'prior'). `pacsaiRegionTimepoint` encodes both region and
  // timepoint, so the survey never tiles a prior in place of the current series.
  const regionViewRules = (
    region: string,
    timepoint: 'session' | 'prior',
    plane: string,
    keywords?: string[],
    excludeKeywords?: string[]
  ): Rule[] => {
    const rules: Rule[] = [
      {
        attribute: regionAttribute,
        required: true,
        constraint: { equals: { value: `${region}-${timepoint}` } },
      },
      { attribute: 'pacsaiPlane', required: true, constraint: { equals: { value: plane } } },
    ];
    if (excludeScouts) {
      rules.push({ attribute: 'SeriesDescription', required: true, constraint: { doesNotContainI: SCOUT_WORDS } });
    }
    if (keywords?.length) {
      rules.push({ attribute: 'SeriesDescription', required: true, constraint: { containsI: keywords } });
    }
    if (excludeKeywords?.length) {
      rules.push({ attribute: 'SeriesDescription', required: true, constraint: { doesNotContainI: excludeKeywords } });
    }
    return rules;
  };

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
  // the `pacsaiRole`/`pacsaiRegionTimepoint` series rules pick the right one(s).
  const displaySetSelectors: Record<string, any> = {};
  selectors.forEach(sel => {
    ROLES.forEach(role => {
      displaySetSelectors[`${role}-${sel.key}`] = {
        studyMatchingRules: [],
        seriesMatchingRules: [roleRule(role), ...seriesRulesFor(sel)],
      };
    });
  });

  // Generic catch-all selector for the current study: ANY current-study series.
  // Guarantees the protocol always hangs something (never blank) even for
  // enhanced/multiframe series whose numImageFrames can't be matched. The
  // numImageFrames + scout rules are SOFT (scored, not required), so this still
  // matches anything, but a real recon out-scores a 1-image scout / topogram.
  displaySetSelectors['anyCurrent'] = {
    studyMatchingRules: [],
    seriesMatchingRules: [
      roleRule('current'),
      { attribute: 'numImageFrames', weight: 5, constraint: { greaterThan: { value: seriesFloor } } },
      { attribute: 'SeriesDescription', weight: 5, constraint: { doesNotContainI: SCOUT_WORDS } },
    ],
  };

  // Region-addressable overview selectors, one per (view, region): match a series
  // by spine region + plane + sequence keywords across ANY loaded study (no role
  // rule), so the current study and its loaded same-session siblings each tile
  // into their own region pane.
  const overviewRegions = overview?.regions ?? [];
  (overview?.views ?? []).forEach(view => {
    const plane = view.plane ?? 'sagittal';
    overviewRegions.forEach(r => {
      displaySetSelectors[`overview-${view.key}-${r.key}`] = {
        studyMatchingRules: [],
        seriesMatchingRules: regionViewRules(r.region, 'session', plane, view.keywords, view.excludeKeywords),
      };
    });
  });

  // Per-region compare selectors: a session and a prior selector per (view, region),
  // region-addressable via `pacsaiRegionTimepoint` so each region pairs with ITS OWN
  // prior (not another region's).
  const regionCompareViews = regionCompare?.views ?? [];
  regionCompareViews.forEach(view => {
    const plane = view.plane ?? 'axial';
    regionCompareRegions.forEach(r => {
      (['session', 'prior'] as const).forEach(tp => {
        displaySetSelectors[`rc-${view.key}-${r.key}-${tp}`] = {
          studyMatchingRules: [],
          seriesMatchingRules: regionViewRules(r.region, tp, plane, view.keywords, view.excludeKeywords),
        };
      });
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

  // A compare viewport (session or prior pane) of a per-region compare stage, with
  // cross-study relative scroll sync scoped per (view, region) so the pair scrolls
  // together.
  const rcViewport = (viewKey: string, regionKey: string, tp: 'session' | 'prior') => ({
    viewportOptions: {
      ...compareViewportOptions,
      syncGroups: [
        { type: 'pacsaiscroll', id: `${id}-rcscroll-${viewKey}-${regionKey}`, source: true, target: true },
      ],
    },
    displaySets: [{ id: `rc-${viewKey}-${regionKey}-${tp}` }],
  });

  // Per-region current-vs-prior compare stages: one 2-up [session | prior] per
  // (region, view), region-major (all of cervical's views, then thoracic's, then
  // lumbar's) so you read a region fully before moving on. ENABLED as soon as the
  // SESSION pane matches (minViewportsMatched = 1) so the first real region/view is
  // always the lead — even with no prior (the prior pane then renders empty via
  // allowUnmatchedView). This is critical: requiring both panes would leave a
  // no-prior set with NOTHING enabled, falling through to the catch-all stage (which
  // would hang an arbitrary scout). `disabled` (skipped) only when the session pane
  // is absent. When present, these REPLACE the generic current/prior + current-only
  // stages (which assume one region and would mis-pair across regions).
  const regionCompareStages = [];
  if (regionCompareViews.length && regionCompareRegions.length) {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    regionCompareRegions.forEach(r => {
      const regionLabel = r.label ?? cap(r.region);
      regionCompareViews.forEach(view => {
        regionCompareStages.push({
          id: `rc-${r.key}-${view.key}`,
          name: `${regionLabel} ${view.name}`,
          stageActivation: {
            enabled: { minViewportsMatched: 1 },
            passive: { minViewportsMatched: 1 },
          },
          viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 2 } },
          viewports: [
            rcViewport(view.key, r.key, 'session'),
            rcViewport(view.key, r.key, 'prior'),
          ],
        });
      });
    });
  }

  // When per-region compare is configured it OWNS the comparison + per-region views,
  // so the generic current/prior and current-only stages are dropped (they assume a
  // single region and would mis-pair across regions). Otherwise keep them.
  const hasRegionCompare = regionCompareStages.length > 0;
  const comparisonStages = hasRegionCompare ? regionCompareStages : cpStages;
  const postCompareStages = hasRegionCompare ? [] : fallbackStages;

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
    stages: [...overviewStages, ...comparisonStages, ...postCompareStages, safetyStage],
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
