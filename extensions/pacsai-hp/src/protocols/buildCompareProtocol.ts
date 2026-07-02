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
  subdural: { windowWidth: 215, windowCenter: 75 },
  cta: { windowWidth: 700, windowCenter: 100 },
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
  /**
   * Prefer (but do not require) a reconstruction kernel class — adds weight so a
   * matching-kernel recon wins when several share the plane, but a series of another
   * kernel still matches. Use instead of `kernel` when the pane should always fill:
   * e.g. a lung-axial pane that takes a dedicated lung-kernel recon when present but
   * falls back to the soft axial (read at a lung window) when the study has none.
   */
  preferKernel?: 'soft' | 'lung' | 'bone';
  /** SeriesDescription must contain ANY of these (case-insensitive). Omit for "any image series". */
  keywords?: string[];
  /**
   * SeriesDescription must satisfy EVERY group — contain ANY term within each group
   * (AND across groups, OR within a group). Use when a selector needs two independent
   * tokens, e.g. a neck MIP = contains 'mip' AND ('neck' | 'carotid'). Each group adds
   * its own required containsI rule. Combine freely with `keywords`/`excludeKeywords`.
   */
  keywordGroups?: string[][];
  /** SeriesDescription must NOT contain any of these (e.g. exclude FLAIR from a T2 selector). */
  excludeKeywords?: string[];
  /**
   * Prefer (but do not require) series whose ImageType contains ANY of these
   * (e.g. 'ORIGINAL' to favor the primary acquisition over derived reformats when
   * both share a plane). Weighted, not required — falls back gracefully when
   * ImageType is absent or only reformats exist.
   */
  preferImageType?: string | string[];
  /**
   * Prefer (but do not require) the high-b diffusion trace via the `pacsaiBValue`
   * attribute (stamped on split DWI displaySets). Adds graduated weight so b1000
   * outranks b500 outranks b0 when a series is split by b-value; an unsplit trace
   * (no b-value) still matches with no bonus. Use on the DWI selector so the stage
   * hangs the high-b image the reader wants, not b0.
   */
  preferHighBValue?: boolean;
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
  /**
   * If set, the StudyDescription must NOT contain any of these. Use to carve a body
   * region OUT of an otherwise-broad match — e.g. compareCTA matches "angio" but
   * excludes chest/abdomen so a chest CTA falls to compareCTAChest instead of
   * mis-hanging on head/neck selectors. Emitted as a required doesNotContainI rule.
   */
  bodyPartExcludeKeywords?: string[];
  /**
   * Additional required StudyDescription keyword groups, AND-ed with bodyPartKeywords
   * and with each other (each group is itself an OR-list). Use to require e.g. an
   * "angio"/"cta" token IN ADDITION to a body-part token, so the protocol claims only
   * the intersection (CTA chest) and not every angio nor every chest study. Each group
   * adds a required containsI rule weighted like bodyPartKeywords.
   */
  requireKeywordGroups?: string[][];
  /** Base weight of the modality rule (default 100). Body-part rule adds 2x when present. */
  matchWeight?: number;
  /** Minimum numImageFrames for a series to qualify (default 5; excludes scouts). CR uses 0. */
  seriesFloor?: number;
  /** Exclude topogram/scout/localizer by description (default true). */
  excludeScouts?: boolean;
  /**
   * Exclude COLOR series (RGB/palette/YBR, via the `pacsaiColor` attribute) from
   * the diagnostic role selectors, and soft-deprioritize them in the catch-all.
   * For angio/perfusion studies this drops the RAPID/iSchemaView summary renders,
   * perfusion parameter maps and 3D-spin volumes — derived overlays that aren't
   * source/MIP series and also trip cornerstone's RGB render crash. Default false
   * (grayscale-only modalities don't need it).
   */
  excludeColorSeries?: boolean;
  /**
   * Selector keys to tile in the current study when NO prior is available, most
   * important first (e.g. ['ax','cor','sag']). The builder emits descending-density
   * stages so the engine auto-picks the densest layout whose every pane matched —
   * no empty panes when a view is absent. Defaults to the distinct stage selectors.
   */
  currentView?: string[];
  /**
   * Optional pageable CURRENT-ONLY stages, each tiling 1–N selectors side by side,
   * for studies that typically have NO prior (e.g. stroke CTA). Each entry becomes
   * its own stage you can page through (e.g. source axials, then MIPs, then CPR).
   * A group is auto-eligible only when ALL its selectors match (no empty pane on
   * auto-hang) but stays manually reachable when at least one matches. Placed after
   * the current/prior compare stages (which lead when a prior exists) and before the
   * descending-density `currentView` fallback. Distinct from `currentView`, which is
   * a single front-anchored stack that degrades by dropping panes.
   */
  currentStages?: Array<{ name: string; selectors: string[]; voi?: VOI }>;
  /**
   * Place the `currentStages` groups AFTER the densest current-only overview stage
   * instead of before it. Default (false) front-anchors them so they LEAD a no-prior
   * study (e.g. CTA runoff → runoff reformats first). Set true when the overview
   * should open first and the group is a secondary read one page right — e.g. a
   * no-prior brain MR opens on the T1/T2/FLAIR(/DWI) overview, with the DWI+ADC pair
   * next. Only affects the no-prior ordering; compare stages still lead when a prior
   * exists.
   */
  currentGroupsAfterLeadView?: boolean;
  /**
   * Multi-WINDOW stages ("all-in-one CT"): ONE current series — the selector's best
   * match — tiled into N linked-scroll panes, EACH at its own CT window (e.g. the
   * head axial as Brain | Subdural | Bone). Unlike `stages`/`currentStages`, which
   * pair DIFFERENT series, every pane here renders the SAME displaySet (no
   * matchedDisplaySetsIndex) with an independent per-pane VOI, so a study with a
   * single soft recon still offers every read window side by side. Scroll is linked
   * (one shared `pacsaiscroll` id — trivially correct, identical stacks); W/L stays
   * per-pane (no VOI sync group), and the pane's preset is registered as its cs3d
   * DEFAULT so Reset restores the intended window, not the metadata VOI. Placed with
   * the pageable current-only groups (after compare stages / after the lead view when
   * `currentGroupsAfterLeadView`). Not emitted for region-compare protocols.
   */
  multiWlStages?: Array<{
    name: string;
    selector: string;
    panes: Array<{ name: string; voi: VOI }>;
  }>;
  /**
   * Tile up to N of the CURRENT study's images side by side in one stage — for
   * projection radiography (CR/DX), where a single "study" holds several distinct
   * single-image views (ankle AP/Lat/Obl, chest PA/Lat, …) the radiologist reads
   * together. Each pane takes the next-ranked match of the first selector via
   * `matchedDisplaySetsIndex` (0..N-1), so it tiles WHATEVER views exist without
   * hard-coding projection names (handles e.g. two obliques). Emits descending-
   * density stages (N..2 panes; the 1-pane case is the existing current-only/safety),
   * so the engine auto-picks the densest layout that fully fills — no empty panes.
   * A study with more than N views shows the first N (cap is a readability choice).
   * Placed after the current/prior compare (which leads when a prior exists) and
   * before the 1-pane fallback. 4 lays out 2x2; 2–3 as a single row.
   */
  tileCurrentImages?: number;
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
      /**
       * Prefer (but do not require) a kernel class per region tile — keeps the survey
       * consistent (e.g. spine CT: prefer the bone sagittal across C/T/L) while still
       * tiling a region that only has another kernel.
       */
      preferKernel?: 'soft' | 'lung' | 'bone';
    }>;
  };
  /**
   * Optional per-region CURRENT-vs-PRIOR compare. For each loaded region, emits
   * (region-major: cervical's stages, then thoracic's, then lumbar's):
   *   - a 2-up [session | prior] compare stage per view, each region pairing with
   *     ITS OWN prior (via `pacsaiRegionTimepoint`). These are `enabled` ONLY when
   *     both session and prior match — i.e. only when a prior exists; with no prior
   *     they are `disabled` (skipped) so the region never renders an empty prior half.
   *   - the current-only multi-plane stage(s) tiling every view's session pane side
   *     by side (e.g. sag | ax | cor). This leads the region when no prior exists and
   *     stays reachable as a current-only glance when a prior does. With `kernels`
   *     set, this becomes ONE stage per kernel (e.g. spine: a bone sag/ax/cor 3-up
   *     that leads, then a soft sag/ax/cor 3-up), so both reconstructions are shown.
   * Reuses `overview.regions`. When set, it REPLACES the generic current/prior +
   * current-only stages for this protocol (those assume a single region and would
   * mis-pair across regions).
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
    /**
     * Optional kernel variants for the per-region current-only multi-plane stage.
     * When set, that single `rc-{region}-all` stage becomes one stage PER kernel, in
     * order — e.g. spine CT: `[{key:'bone',kernel:'bone'},{key:'soft',kernel:'soft'}]`
     * yields a bone sag/ax/cor 3-up (leads) then a soft sag/ax/cor 3-up, so the
     * radiologist sees both reconstructions instead of one arbitrary kernel per plane.
     * Each variant requires its kernel (a region lacking it just skips that variant).
     */
    kernels?: Array<{ key: string; label?: string; kernel: 'soft' | 'lung' | 'bone' }>;
    /**
     * View keys (a subset of `views`) to tile in the per-region current-only "all"
     * glance — defaults to EVERY compare view. Tiling all compare views forces an
     * empty pane for any view a region lacks (e.g. a disc-oblique axial that only some
     * regions have, or a coronal that's usually absent), so set a compact list of the
     * views that are reliably present. Order matters: the often-absent view(s) must be
     * LAST, because the glance is emitted at full density and one step down, picking the
     * layout whose every pane fills — so a region missing the trailing view falls to the
     * shorter, fully-filled tile (no empty pane) while a region that has it leads with
     * the full one. Views omitted here still get their own per-view compare stage.
     */
    allViews?: string[];
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

// Substring (case-insensitive) match. 'topo' covers both the full 'TOPOGRAM' and the
// abbreviated 'Topo PA' / 'Topo LAT' that some scanners (e.g. Siemens auto-protocols)
// emit — these are scouts and must never hang in a diagnostic stage.
const SCOUT_WORDS = ['topo', 'scout', 'localizer'];
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

// Excludes the synthetic all-in-one composite stack from a selector. The
// `pacsaiAllInOne` attribute is 'allinone' for the composite and 'series' for every
// real series, so requiring `=== 'series'` keeps the composite out of every
// diagnostic plane/kernel/region pane; the all-in-one stage's own selectors instead
// require `=== 'allinone'` so ONLY the composite matches them.
function notAllInOneRule(): Rule {
  return { attribute: 'pacsaiAllInOne', required: true, constraint: { equals: { value: 'series' } } };
}

export function buildCompareProtocol(cfg: CompareConfig): Types.HangingProtocol.Protocol {
  const {
    id,
    name,
    description,
    modalities,
    bodyPartKeywords,
    bodyPartExcludeKeywords,
    requireKeywordGroups,
    matchWeight = 100,
    seriesFloor = 5,
    excludeScouts = true,
    excludeColorSeries = false,
    currentView,
    currentStages,
    currentGroupsAfterLeadView = false,
    multiWlStages,
    tileCurrentImages,
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
    excludeKeywords?: string[],
    kernel?: 'soft' | 'lung' | 'bone',
    preferKernel?: 'soft' | 'lung' | 'bone'
  ): Rule[] => {
    const rules: Rule[] = [
      notAllInOneRule(),
      {
        attribute: regionAttribute,
        required: true,
        constraint: { equals: { value: `${region}-${timepoint}` } },
      },
      { attribute: 'pacsaiPlane', required: true, constraint: { equals: { value: plane } } },
    ];
    if (kernel) {
      // Required: restricts a per-kernel variant stage to that recon (e.g. spine bone vs soft).
      rules.push({ attribute: 'pacsaiKernel', required: true, constraint: { equals: { value: kernel } } });
    }
    if (preferKernel) {
      // Weighted, NOT required: prefers this kernel (e.g. bone for the spine survey)
      // but still matches another so a region lacking it still tiles.
      rules.push({ attribute: 'pacsaiKernel', weight: 10, constraint: { equals: { value: preferKernel } } });
    }
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
      notAllInOneRule(),
      { attribute: 'numImageFrames', constraint: { greaterThan: { value: seriesFloor } } },
    ];
    if (excludeScouts) {
      // Required: scouts/topograms/localizers must never hang in a diagnostic stage
      // (the `anyCurrent` safety selector keeps this soft so it can still show one).
      rules.push({ attribute: 'SeriesDescription', required: true, constraint: { doesNotContainI: SCOUT_WORDS } });
    }
    if (excludeColorSeries) {
      // Required: derived COLOR series (RAPID renders, perfusion maps, 3D-spin) must
      // never hang in a diagnostic stage. `pacsaiColor` is 'mono' unless positively
      // RGB, so this only drops confirmed color series.
      rules.push({ attribute: 'pacsaiColor', required: true, constraint: { equals: { value: 'mono' } } });
    }
    if (sel.plane) {
      // Match the computed plane (orientation-based) rather than the description.
      rules.push({ attribute: 'pacsaiPlane', required: true, constraint: { equals: { value: sel.plane } } });
    }
    if (sel.preferPlane) {
      // Weighted, NOT required: prefers this plane but still matches others.
      rules.push({ attribute: 'pacsaiPlane', weight: 10, constraint: { equals: { value: sel.preferPlane } } });
    }
    if (sel.preferImageType) {
      // Weighted, NOT required: prefers e.g. ORIGINAL (primary acquisition) over
      // derived reformats when both share the plane/kernel. ImageType is an array
      // (e.g. ['ORIGINAL','PRIMARY','AXIAL']); containsI matches membership.
      rules.push({ attribute: 'ImageType', weight: 15, constraint: { containsI: sel.preferImageType } });
    }
    if (sel.kernel) {
      // Match the computed kernel class (soft/bone) from ConvolutionKernel.
      rules.push({ attribute: 'pacsaiKernel', required: true, constraint: { equals: { value: sel.kernel } } });
    }
    if (sel.preferKernel) {
      // Weighted, NOT required: prefers this kernel class but still matches others,
      // so the pane falls back (e.g. soft axial when no lung-kernel recon exists).
      rules.push({ attribute: 'pacsaiKernel', weight: 10, constraint: { equals: { value: sel.preferKernel } } });
    }
    if (sel.preferHighBValue) {
      // Weighted, NOT required: graduated so a split DWI trace ranks b1000 > b500 > b0
      // (each threshold stacks), while an unsplit trace (no pacsaiBValue) still matches
      // via keywords with no bonus. Keeps the DWI stage on the high-b image.
      rules.push({ attribute: 'pacsaiBValue', weight: 20, constraint: { greaterThan: { value: 100 } } });
      rules.push({ attribute: 'pacsaiBValue', weight: 20, constraint: { greaterThan: { value: 500 } } });
    }
    if (sel.keywords?.length) {
      rules.push({ attribute: 'SeriesDescription', required: true, constraint: { containsI: sel.keywords } });
    }
    if (sel.keywordGroups?.length) {
      // Each group is its own required containsI rule => AND across groups, OR within.
      sel.keywordGroups.forEach(group => {
        if (group.length) {
          rules.push({ attribute: 'SeriesDescription', required: true, constraint: { containsI: group } });
        }
      });
    }
    if (sel.excludeKeywords?.length) {
      // Required: an excluded sequence (e.g. MIP for the source-axial selector,
      // FLAIR/SWI for a T2 selector) must be hard-disqualified, not just deprioritized.
      rules.push({ attribute: 'SeriesDescription', required: true, constraint: { doesNotContainI: sel.excludeKeywords } });
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
      notAllInOneRule(),
      { attribute: 'numImageFrames', weight: 5, constraint: { greaterThan: { value: seriesFloor } } },
      { attribute: 'SeriesDescription', weight: 5, constraint: { doesNotContainI: SCOUT_WORDS } },
      // Soft (not required): prefer a grayscale series over a derived color one as the
      // last-resort hang, but still allow color if it is genuinely all that exists.
      ...(excludeColorSeries
        ? [{ attribute: 'pacsaiColor', weight: 5, constraint: { equals: { value: 'mono' } } }]
        : []),
    ],
  };

  // All-in-one composite selectors: the single concatenated scroll-through stack per
  // study (built by loadRelevantPriors). Matched ONLY via the `pacsaiAllInOne` marker
  // + role, so the composite never competes with the diagnostic plane/kernel
  // selectors (which require `pacsaiAllInOne === 'series'`).
  ROLES.forEach(role => {
    displaySetSelectors[`${role}-allinone`] = {
      studyMatchingRules: [],
      seriesMatchingRules: [
        roleRule(role),
        { attribute: 'pacsaiAllInOne', required: true, constraint: { equals: { value: 'allinone' } } },
      ],
    };
  });

  // Region-AGNOSTIC overview selector, one per view: matches the sequence/plane in
  // ANY loaded spine region of the current session (`pacsaiRegionTimepoint` ends in
  // '-session' — current + same-session siblings, never a prior), excluding the
  // all-in-one composite. The survey then tiles the regions PRESENT via
  // matchedDisplaySetsIndex (descending density below), so a region that wasn't
  // imaged drops out instead of leaving an empty pane. The engine dedups by series,
  // so the usual 1-series-per-region-per-sequence survey puts one region per pane
  // (ordered by match rank — the opened region first, then siblings).
  const overviewAnyRules = (
    plane: string,
    keywords?: string[],
    excludeKeywords?: string[],
    preferKernel?: 'soft' | 'lung' | 'bone'
  ): Rule[] => {
    const rules: Rule[] = [
      notAllInOneRule(),
      { attribute: regionAttribute, required: true, constraint: { containsI: ['-session'] } },
      { attribute: 'pacsaiPlane', required: true, constraint: { equals: { value: plane } } },
    ];
    if (preferKernel) {
      rules.push({ attribute: 'pacsaiKernel', weight: 10, constraint: { equals: { value: preferKernel } } });
    }
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
  (overview?.views ?? []).forEach(view => {
    displaySetSelectors[`overview-${view.key}-any`] = {
      studyMatchingRules: [],
      seriesMatchingRules: overviewAnyRules(
        view.plane ?? 'sagittal',
        view.keywords,
        view.excludeKeywords,
        view.preferKernel
      ),
    };
  });

  // Per-region compare selectors: a session and a prior selector per (view, region),
  // region-addressable via `pacsaiRegionTimepoint` so each region pairs with ITS OWN
  // prior (not another region's).
  const regionCompareViews = regionCompare?.views ?? [];
  const regionCompareKernels = regionCompare?.kernels ?? [];
  regionCompareViews.forEach(view => {
    const plane = view.plane ?? 'axial';
    regionCompareRegions.forEach(r => {
      (['session', 'prior'] as const).forEach(tp => {
        displaySetSelectors[`rc-${view.key}-${r.key}-${tp}`] = {
          studyMatchingRules: [],
          seriesMatchingRules: regionViewRules(r.region, tp, plane, view.keywords, view.excludeKeywords),
        };
      });
      // Kernel-restricted SESSION selectors for the per-kernel current-only stages
      // (e.g. spine bone vs soft) — region + plane + kernel, current session only.
      regionCompareKernels.forEach(k => {
        displaySetSelectors[`rc-${view.key}-${r.key}-session-${k.key}`] = {
          studyMatchingRules: [],
          seriesMatchingRules: regionViewRules(
            r.region,
            'session',
            plane,
            view.keywords,
            view.excludeKeywords,
            k.kernel
          ),
        };
      });
    });
  });

  // Scroll-sync current vs prior. The sync id is scoped per selector (plane /
  // sequence) so the axial pair scrolls together but the "Current (3 planes)"
  // fallback doesn't cross-sync different planes. `imageslice` syncs the scrolled
  // slice and works across studies (different frames of reference).
  // `index` (matchedDisplaySetsIndex) selects the Nth-ranked match of the selector —
  // used to tile several series of ONE selector side by side (e.g. the two per-leg
  // coronal reformats of a bilateral runoff). Default 0 = the best match.
  const viewport = (role: Role, selectorKey: string, voi?: VOI, index = 0) => ({
    viewportOptions: {
      ...compareViewportOptions,
      syncGroups: [
        // Cross-study relative scroll sync (registered by the extension as
        // 'pacsaiscroll'); the built-in 'imageslice' sync is position-based and
        // does not work across different studies / frames of reference. Scoped per
        // (selector, index) so tiled panes of one selector don't cross-sync.
        { type: 'pacsaiscroll', id: `${id}-scroll-${selectorKey}-${index}`, source: true, target: true },
      ],
    },
    displaySets: [
      {
        id: `${role}-${selectorKey}`,
        ...(index ? { matchedDisplaySetsIndex: index } : {}),
        ...(voi ? { options: { voi } } : {}),
      },
    ],
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

  // Window preset configured for each selector in the compare stages, so the
  // no-prior fallback view hangs at the same window as the current/prior layout.
  const voiBySelector = new Map(stages.map(s => [s.selector, s.voi]));

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
      viewports: keys.map(key => viewport('current', key, voiBySelector.get(key))),
    });
  }

  // Pageable current-only group stages (e.g. CTA with no prior): each tiles a
  // small set of selectors side by side. Auto-eligible only when ALL its panes
  // match (enabled minViewportsMatched = N, so an auto-hang never shows an empty
  // pane); still manually reachable when at least one matches (passive = 1). These
  // sit AFTER the current/prior stages (which lead when a prior exists) and BEFORE
  // the descending currentView fallback. A selector listed MORE THAN ONCE tiles its
  // 1st, 2nd, … ranked matches (matchedDisplaySetsIndex), e.g. ['cor','cor'] shows
  // the two per-leg coronal reformats of a bilateral runoff side by side.
  const currentGroupStages = (currentStages ?? [])
    .map((cs, i) => {
      const keys = cs.selectors.filter(key => selectors.some(s => s.key === key));
      if (!keys.length) {
        return null;
      }
      const keyIndex: Record<string, number> = {};
      return {
        id: `current-group-${i}`,
        name: cs.name,
        stageActivation: {
          enabled: { minViewportsMatched: keys.length },
          passive: { minViewportsMatched: 1 },
        },
        viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: keys.length } },
        viewports: keys.map(key => {
          const index = keyIndex[key] ?? 0;
          keyIndex[key] = index + 1;
          return viewport('current', key, cs.voi ?? voiBySelector.get(key), index);
        }),
      };
    })
    .filter(Boolean);

  // Multi-window stages: the SAME current series in N linked-scroll panes, each
  // at its own window (see CompareConfig.multiWlStages). All panes reference the
  // same selector with NO matchedDisplaySetsIndex, so the engine re-uses the one
  // best match (index-tiling is what the pageable groups above do — deliberately
  // not this). One shared scroll-sync id across the panes; per-pane VOI via
  // displaySetOptions so W/L stays independent. Auto-eligible only when the
  // series exists (enabled = all panes matched — same series, so all-or-none).
  const multiWlStageDefs = (multiWlStages ?? [])
    .map((mw, i) => {
      if (!mw.panes?.length || !selectors.some(s => s.key === mw.selector)) {
        return null;
      }
      return {
        id: `multi-wl-${i}`,
        name: mw.name,
        stageActivation: {
          enabled: { minViewportsMatched: mw.panes.length },
          passive: { minViewportsMatched: 1 },
        },
        viewportStructure: {
          layoutType: 'grid',
          properties: { rows: 1, columns: mw.panes.length },
        },
        viewports: mw.panes.map((pane, paneIndex) => ({
          viewportOptions: {
            ...compareViewportOptions,
            syncGroups: [
              { type: 'pacsaiscroll', id: `${id}-multiwl-${i}`, source: true, target: true },
            ],
          },
          displaySets: [
            {
              id: `current-${mw.selector}`,
              options: {
                voi: pane.voi,
                // Stable per-pane LUT-presentation key: the presentation id
                // serializes options VALUE-BLIND (`voi=[object Object]`), so
                // without this the panes would collide and only be told apart
                // by an order-based index. With it, a manual W/L on the Bone
                // pane is remembered for the Bone pane specifically.
                id: `multiwl-${i}-${paneIndex}`,
              },
            },
          ],
        })),
      };
    })
    .filter(Boolean);

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

  // All-in-one stage(s): one scrollable stack of the whole current study (every
  // diagnostic series concatenated by series number) — and, when a prior exists, the
  // prior's all-in-one beside it for a quick whole-study glance. INDEPENDENT scroll
  // (no cross-study sync): the two concatenated stacks have different series/counts
  // and no slice correspondence. `viewportType: 'stack'` forced — the mixed geometry
  // must never attempt a volume. Appended as the FINAL stage(s) — AFTER the safety
  // catch-all — so the "compare + all-in-one" mode pages to it at the very end:
  // present in every compare protocol, this is the default "append" browsing mode.
  // (The safety `current-any` stays just before it as the US / no-composite fallback;
  // it only needs to exist and stay non-disabled, not be last.) The composite is built
  // after the initial hang (same lifecycle as priors), so these stages stay `disabled`
  // until it exists.
  const allInOneViewport = (role: Role, sync = false) => ({
    viewportOptions: {
      toolGroupId: 'default',
      allowUnmatchedView: true,
      viewportType: 'stack',
      // Plane-grouped cross-study scroll for the 2-up (current|prior): scrolling the
      // current's sagittals shows the prior's sagittals, axials its axials, etc. Same
      // id on both panes so they share one sync group. (1-up stage passes no sync.)
      ...(sync
        ? {
            syncGroups: [
              { type: 'pacsaiallinonescroll', id: `${id}-allinone-scroll`, source: true, target: true },
            ],
          }
        : {}),
    },
    displaySets: [{ id: `${role}-allinone` }],
  });
  const allInOneStages = [
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
  ];

  // Whole-region overview: one LEAD stage per sequence (T2 sag, STIR sag, T1 sag,
  // T1 +C), each tiling the spine regions PRESENT side by side. Requires the prior
  // loader to fetch the same-session sibling regions. Shows ALL regions when all are
  // loaded and drops to just the regions present (NO empty pane) when one wasn't
  // imaged — e.g. a thoracic + lumbar set with no cervical hangs a clean 2-up, not a
  // 3-up with a blank cervical pane (which looked broken).
  const overviewStages = [];
  if (overview?.regions?.length && overview?.views?.length) {
    const regionCount = overview.regions.length;
    // Per sequence, tile the region-agnostic session selector at descending density
    // (N down to 2 panes) via matchedDisplaySetsIndex; each level requires ALL its
    // panes filled (minViewportsMatched = k), so the engine auto-picks the densest
    // layout that fully fills: N when all regions are loaded, the count present when
    // one is absent. Two levels only (N, N-1) to keep next/prev uncluttered. A single
    // region doesn't reach here — it falls to the per-region compare / current-only
    // stages.
    const minRegions = Math.min(2, regionCount);
    overview.views.forEach(view => {
      for (let k = regionCount; k >= minRegions; k--) {
        overviewStages.push({
          id: `overview-${view.key}-${k}`,
          name: view.name,
          stageActivation: {
            enabled: { minViewportsMatched: k },
            passive: { minViewportsMatched: k },
          },
          viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: k } },
          viewports: Array.from({ length: k }, (_, i) => ({
            viewportOptions: compareViewportOptions,
            displaySets: [{ id: `overview-${view.key}-any`, matchedDisplaySetsIndex: i }],
          })),
        });
      }
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

  // Per-region compare stages, region-major (all of cervical's stages, then
  // thoracic's, then lumbar's) so you read a region fully before moving on. For
  // each region we emit, in order:
  //   1. One 2-up [session | prior] compare per view, ENABLED only when BOTH panes
  //      match (minViewportsMatched = 2) — i.e. only when a prior exists for this
  //      region. With no prior they go `disabled` and stage navigation skips them,
  //      so the region never shows an empty prior half.
  //   2. One current-only multi-plane stage tiling every view's SESSION pane side
  //      by side (e.g. sag | ax | cor). It leads the region when no prior exists
  //      (the compares above are then disabled) and stays reachable as a
  //      current-only glance when a prior does (placed after the compares so a
  //      prior, when present, still leads). ENABLED as soon as one plane matches;
  //      `disabled` (skipped entirely) only when the region isn't loaded at all.
  // Together these REPLACE the generic current/prior + current-only stages (which
  // assume one region and would mis-pair across regions).
  const regionCompareStages = [];
  if (regionCompareViews.length && regionCompareRegions.length) {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    // Views tiled in the per-region current-only "all" glance: the curated `allViews`
    // (validated against the compare views), else every compare view.
    const allViewKeys = (
      regionCompare?.allViews?.length ? regionCompare.allViews : regionCompareViews.map(v => v.key)
    ).filter(key => regionCompareViews.some(v => v.key === key));
    // Balanced grid for the glance: a single row up to 4 panes, then two rows.
    const rcAllGrid = (k: number) => {
      const rows = k >= 5 ? 2 : 1;
      return { layoutType: 'grid', properties: { rows, columns: Math.ceil(k / rows) } };
    };
    regionCompareRegions.forEach(r => {
      const regionLabel = r.label ?? cap(r.region);
      regionCompareViews.forEach(view => {
        regionCompareStages.push({
          id: `rc-${r.key}-${view.key}`,
          name: `${regionLabel} ${view.name}`,
          stageActivation: {
            enabled: { minViewportsMatched: 2 },
            passive: { minViewportsMatched: 2 },
          },
          viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 2 } },
          viewports: [
            rcViewport(view.key, r.key, 'session'),
            rcViewport(view.key, r.key, 'prior'),
          ],
        });
      });
      // Current-only multi-plane stage(s) for this region. Plain (no cross-study
      // scroll sync): the panes are different planes of the same study, so there is
      // nothing to relative-sync. Absent planes render empty via allowUnmatchedView.
      // With `kernels` set, emit one variant per kernel (e.g. spine: bone 3-up leads,
      // soft 3-up next) using the kernel-restricted session selectors; otherwise a
      // single kernel-agnostic 3-up.
      const allVariants = regionCompareKernels.length
        ? regionCompareKernels.map(k => ({
            id: `rc-${r.key}-all-${k.key}`,
            name: `${regionLabel} (${k.label ?? k.key})`,
            selectorSuffix: `-${k.key}`,
          }))
        : [{ id: `rc-${r.key}-all`, name: regionLabel, selectorSuffix: '' }];
      allVariants.forEach(variant => {
        if (regionCompare?.allViews?.length) {
          // Curated glance: emit at full density and ONE step down (k = N, N-1). Each
          // level requires ALL its panes matched (minViewportsMatched = k), so the engine
          // picks the densest layout that fully fills — a region missing the single
          // trailing view (e.g. C/T with no disc-oblique axial) falls to the shorter tile
          // with NO empty pane, while a region that has it (lumbar) leads with the full
          // tile. Only two levels so navigation isn't cluttered with ever-sparser subsets.
          const floor = Math.max(1, allViewKeys.length - 1);
          for (let k = allViewKeys.length; k >= floor; k--) {
            const keys = allViewKeys.slice(0, k);
            regionCompareStages.push({
              id: `${variant.id}-${k}`,
              name: variant.name,
              stageActivation: {
                enabled: { minViewportsMatched: k },
                passive: { minViewportsMatched: k },
              },
              viewportStructure: rcAllGrid(k),
              viewports: keys.map(key => ({
                viewportOptions: compareViewportOptions,
                displaySets: [{ id: `rc-${key}-${r.key}-session${variant.selectorSuffix}` }],
              })),
            });
          }
        } else {
          // Default (e.g. CT spine): one glance tiling every compare view, ENABLED as
          // soon as a single plane matches. Views a region lacks render empty.
          regionCompareStages.push({
            id: variant.id,
            name: variant.name,
            stageActivation: {
              enabled: { minViewportsMatched: 1 },
              passive: { minViewportsMatched: 1 },
            },
            viewportStructure: {
              layoutType: 'grid',
              properties: { rows: 1, columns: regionCompareViews.length },
            },
            viewports: regionCompareViews.map(view => ({
              viewportOptions: compareViewportOptions,
              displaySets: [{ id: `rc-${view.key}-${r.key}-session${variant.selectorSuffix}` }],
            })),
          });
        }
      });
    });
  }

  // Multi-view tiling of the current study (projection radiography): descending-
  // density stages that tile N..2 of the current study's images by ranked index, so
  // all projections of an exam (e.g. ankle AP/Lat/Obl) hang together. The engine
  // auto-picks the densest stage that fully fills (minViewportsMatched = k). 4 lays
  // out 2x2; 2-3 a single row. The 1-pane case falls through to the current-only/
  // safety stages below.
  const tileStages = [];
  if (tileCurrentImages && tileCurrentImages >= 2) {
    const tileSelectorId = `current-${selectors[0].key}`;
    const gridFor = (k: number) => {
      const rows = k >= 4 ? 2 : 1;
      return { rows, columns: Math.ceil(k / rows) };
    };
    for (let k = tileCurrentImages; k >= 2; k--) {
      tileStages.push({
        id: `current-tile-${k}`,
        name: 'Current (all views)',
        stageActivation: {
          enabled: { minViewportsMatched: k },
          passive: { minViewportsMatched: k },
        },
        viewportStructure: { layoutType: 'grid', properties: gridFor(k) },
        viewports: Array.from({ length: k }, (_, i) => ({
          viewportOptions: compareViewportOptions,
          displaySets: [{ id: tileSelectorId, matchedDisplaySetsIndex: i }],
        })),
      });
    }
  }

  // When per-region compare is configured it OWNS the comparison + per-region views,
  // so the generic current/prior and current-only stages are dropped (they assume a
  // single region and would mis-pair across regions). Otherwise keep them.
  const hasRegionCompare = regionCompareStages.length > 0;
  const comparisonStages = hasRegionCompare ? regionCompareStages : cpStages;
  // No-prior path: pageable current-only groups, then multi-view tiling (projection
  // radiography), then the descending currentView fallback. Region-compare protocols
  // manage their own current-only views, so none of these apply there.
  let postCompareStages: any[];
  if (hasRegionCompare) {
    postCompareStages = [];
  } else if (currentGroupsAfterLeadView && currentGroupStages.length && fallbackStages.length) {
    // Overview leads a no-prior study; the pageable current groups sit right after
    // the densest current-only view (so e.g. brain MR opens on the T1/T2/FLAIR
    // overview and the DWI+ADC pair is one page right, not the opening view).
    postCompareStages = [
      fallbackStages[0],
      ...currentGroupStages,
      ...multiWlStageDefs,
      ...fallbackStages.slice(1),
      ...tileStages,
    ];
  } else {
    postCompareStages = [...currentGroupStages, ...multiWlStageDefs, ...tileStages, ...fallbackStages];
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
  if (bodyPartExcludeKeywords?.length) {
    protocolMatchingRules.push({
      id: `${id}-bodypart-exclude`,
      weight: matchWeight * 2,
      required: true,
      attribute: 'StudyDescription',
      constraint: { doesNotContainI: bodyPartExcludeKeywords },
    });
  }
  (requireKeywordGroups ?? []).forEach((group, i) => {
    if (!group.length) {
      return;
    }
    protocolMatchingRules.push({
      id: `${id}-require-${i}`,
      weight: matchWeight * 2,
      required: true,
      attribute: 'StudyDescription',
      constraint: { containsI: group },
    });
  });

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
    stages: [
      ...overviewStages,
      ...comparisonStages,
      ...postCompareStages,
      safetyStage,
      // All-in-one LAST so "compare + all-in-one" mode pages to it at the very end.
      ...allInOneStages,
    ],
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
