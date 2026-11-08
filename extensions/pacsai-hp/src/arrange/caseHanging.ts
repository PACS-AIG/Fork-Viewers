/**
 * Rev 11 milestone 7, PR 2 (B31, N06): the reader's preset at a case's
 * re-hang. loadRelevantPriors re-hangs every case once its comparison is
 * loaded (or found to be none): there, instead of the site protocol in the
 * browsing mode in use, the plan (hangingPresets.ts planCase) may be the
 * reader's preset for the case's study type. Outside the reading window the
 * presets are off and the plan is the site's: the same protocol id as before,
 * nothing else touched.
 */
import { getBrowsingMode, previewBrowsingMode, protocolIdForMode } from '../allinone/browsingMode';
import type { ProtocolLike } from './arrangeModel';
import {
  caseFacts,
  planCase,
  presetStageIndex,
  studyTypeOf,
  type CasePlan,
  type DisplaySetFacts,
  type StudyType,
} from './hangingPresets';
import { caseChoiceMade, hangingEntry, hangingPresetsState, noteCaseApplied } from './presetStore';
import type { HeldUpdate } from './lateArrivals';

/** How long a re-hang waits for the reader's presets (read at the case's entry). */
export const PRESET_WAIT_MS = 1500;

export interface CaseHangingService {
  getActiveProtocol: () => {
    protocol?: ProtocolLike | null;
    stageIndex?: number;
  } | null;
  setProtocol: (protocolId: string, options?: { stageIndex?: number }) => void;
  protocolEngine?: {
    findMatchByStudy?: (
      study: unknown,
      options: { studies?: unknown[]; displaySets?: unknown[] }
    ) => Array<{ score?: number; protocol?: ProtocolLike }>;
  };
  studies?: unknown[];
}

export interface RehangPlan {
  plan: CasePlan;
  type: StudyType | null;
  /** The protocol id to run. */
  runId: string;
}

/** The compare protocols the engine matches to the study (score above nought). */
function matchedIds(
  hps: CaseHangingService,
  study: unknown,
  displaySets: ReadonlyArray<unknown>
): Set<string> {
  try {
    const matches =
      hps.protocolEngine?.findMatchByStudy?.(study, {
        studies: hps.studies,
        displaySets: [...displaySets],
      }) ?? [];
    return new Set(
      matches
        .filter(m => (m?.score ?? 0) > 0 && typeof m?.protocol?.id === 'string')
        .map(m => (m.protocol as ProtocolLike).id)
    );
  } catch (_) {
    return new Set();
  }
}

/**
 * The plan for this case's re-hang over `displaySets`, with `siteProtocol` the
 * protocol the first hang matched. A preset's browsing mode goes into memory
 * for this case (previewBrowsingMode: the stored one comes back with the next
 * case), as Arrange's choices do; with `preview: false` (PR 3: asking what a
 * held re-hang would do) nothing goes anywhere.
 */
export function planCaseRehang(
  hps: CaseHangingService,
  siteProtocol: ProtocolLike,
  studyInstanceUID: string,
  displaySets: ReadonlyArray<DisplaySetFacts>,
  study: { StudyDescription?: unknown } | null | undefined,
  { preview = true }: { preview?: boolean } = {}
): RehangPlan {
  const site = (): RehangPlan => {
    const browsing = getBrowsingMode();
    return {
      plan: {
        source: caseChoiceMade() ? 'case' : 'site',
        protocolId: siteProtocol.id,
        browsing,
        preset: null,
        skipped: 'none',
      },
      type: null,
      runId: protocolIdForMode(browsing, siteProtocol.id) ?? siteProtocol.id,
    };
  };
  if (hangingPresetsState() === 'off') {
    return site();
  }
  const type = studyTypeOf({
    siteProtocol,
    ...caseFacts(studyInstanceUID, displaySets, study),
  });
  const preset = type ? (hangingEntry(type.key)?.preset ?? null) : null;
  if (!type || !preset) {
    return { ...site(), type };
  }
  const plan = planCase({
    siteProtocolId: siteProtocol.id,
    browsing: getBrowsingMode(),
    preset,
    matchedIds: matchedIds(hps, study, displaySets),
    caseChoice: caseChoiceMade(),
  });
  if (preview && plan.source === 'preset' && getBrowsingMode() !== plan.browsing) {
    previewBrowsingMode(plan.browsing);
  }
  // The plan's browsing mode: the preset's, else the one in use (planCase).
  return {
    plan,
    type,
    runId: protocolIdForMode(plan.browsing, plan.protocolId) ?? plan.protocolId,
  };
}

/**
 * PR 3: whether running `rehang` would put up another layout than the one on
 * screen: another protocol, or the reader's preset layout where another of the
 * protocol's layouts is shown. Re-running the same protocol only to start it
 * over is not another layout.
 */
export function wouldChangeLayout(hps: CaseHangingService, rehang: RehangPlan): boolean {
  const active = hps.getActiveProtocol();
  const protocol = active?.protocol;
  if (!protocol || protocol.id !== rehang.runId) {
    return true;
  }
  const preset = rehang.plan.source === 'preset' ? rehang.plan.preset : null;
  if (!preset || (!preset.stageId && !preset.stageName)) {
    return false;
  }
  const index = presetStageIndex(protocol, preset);
  if (index === null || protocol.stages?.[index]?.status === 'disabled') {
    return false;
  }
  return index !== (active?.stageIndex ?? 0);
}

/**
 * PR 3: what a held re-hang of this case would bring the reader: the images
 * that arrived since the layout was hung, else another layout (the reader's
 * preset for the study type, or the browsing mode's protocol); null when
 * neither, the layout on screen being what it would put up.
 */
export function caseUpdateKind(
  hps: CaseHangingService,
  siteProtocol: ProtocolLike,
  studyInstanceUID: string,
  displaySets: ReadonlyArray<DisplaySetFacts>,
  study: { StudyDescription?: unknown } | null | undefined,
  imagesArrived: boolean
): HeldUpdate | null {
  if (imagesArrived) {
    return { kind: 'images', label: null };
  }
  const rehang = planCaseRehang(hps, siteProtocol, studyInstanceUID, displaySets, study, {
    preview: false,
  });
  if (!wouldChangeLayout(hps, rehang)) {
    return null;
  }
  return {
    kind: 'layout',
    label: rehang.plan.source === 'preset' ? (rehang.type?.label ?? null) : null,
  };
}

let caseSite: { studyInstanceUID: string; protocol: ProtocolLike } | null = null;

/**
 * PR 3: the prior loader's note of the protocol the case's first hang matched
 * (the site's), so the case's other automatic re-hangs (the all-in-one
 * refresh) plan as the loader's does.
 */
export function noteCaseSite(studyInstanceUID: string, protocol: ProtocolLike): void {
  caseSite = { studyInstanceUID, protocol };
}

/** The site protocol noted for this study, if the loader noted it. */
export function caseSiteProtocol(studyInstanceUID: string | undefined): ProtocolLike | null {
  return caseSite && caseSite.studyInstanceUID === studyInstanceUID ? caseSite.protocol : null;
}

/**
 * After the run: the preset's layout when the case can show it; when it
 * cannot (a series or the prior it needs is missing), the protocol's opening
 * layout stands, the protocol's own fallback. Notes what was done.
 */
export function applyRehangLayout(hps: CaseHangingService, rehang: RehangPlan): void {
  const { plan, runId } = rehang;
  const note = (layout: 'shown' | 'fallback' | 'none', missingLayout: string | null = null) => {
    if (hangingPresetsState() !== 'off') {
      noteCaseApplied({ source: plan.source, skipped: plan.skipped, layout, missingLayout });
    }
  };
  const preset = plan.preset;
  if (plan.source !== 'preset' || !preset || (!preset.stageId && !preset.stageName)) {
    note('none');
    return;
  }
  const active = hps.getActiveProtocol();
  const protocol = active?.protocol;
  if (!protocol || protocol.id !== runId) {
    note('fallback', preset.stageName);
    return;
  }
  const index = presetStageIndex(protocol, preset);
  if (index === null || protocol.stages?.[index]?.status === 'disabled') {
    note('fallback', preset.stageName);
    return;
  }
  if (index !== active?.stageIndex) {
    try {
      hps.setProtocol(runId, { stageIndex: index });
    } catch (_) {
      note('fallback', preset.stageName);
      return;
    }
  }
  note('shown');
}
