import { DicomMetadataStore } from '@ohif/core';
import { getBrowsingMode, protocolIdForMode } from './browsingMode';
import {
  applyRehangLayout,
  caseSiteProtocol,
  planCaseRehang,
  type CaseHangingService,
} from '../arrange/caseHanging';
import type { DisplaySetFacts } from '../arrange/hangingPresets';
import { hangingPresetsState } from '../arrange/presetStore';

/**
 * Re-hang the currently-loaded studies with the active browsing mode's protocol —
 * a pure re-hang over `getActiveDisplaySets()`, with NO QIDO/re-query. Used by the
 * browsing-mode toolbar switch and by the all-in-one auto-refresh (when a composite
 * is first created). 'append'/'current' pass undefined so the engine auto-selects the
 * active study's compare protocol (now ending in the all-in-one stage) — 'current'
 * then hangs its no-prior stages because the prior's hanging role is suppressed;
 * 'allinone'/'manual' force the dedicated / stock-default protocol.
 */
export function rehangForMode(servicesManager: any): void {
  const { hangingProtocolService, displaySetService } = servicesManager?.services ?? {};
  if (!hangingProtocolService || !displaySetService) {
    return;
  }
  const displaySets = displaySetService.getActiveDisplaySets();
  if (!displaySets?.length) {
    return;
  }
  const activeStudyUID = hangingProtocolService.getState?.()?.activeStudyUID;
  const studyUIDs = [...new Set(displaySets.map((ds: any) => ds.StudyInstanceUID))];
  const studies = studyUIDs
    .map((uid: string) => DicomMetadataStore.getStudy(uid))
    .filter(Boolean);
  if (!studies.length) {
    return;
  }
  const activeStudy =
    studies.find((s: any) => s.StudyInstanceUID === activeStudyUID) ?? studies[0];
  hangingProtocolService.run(
    { studies, displaySets, activeStudy },
    protocolIdForMode(getBrowsingMode(), undefined)
  );
}

/**
 * Milestone 7, PR 3: the all-in-one refresh's re-hang of the case. In the
 * reading window, with the protocol the case's first hang matched (the prior
 * loader's note), it is the case's plan, as the loader's re-hang is: the
 * reader's preset for the study type may stand, its layout put up. Elsewhere
 * (the presets off, or no note) rehangForMode, as before.
 */
export function rehangCase(servicesManager: CaseServices): void {
  const { hangingProtocolService: hps, displaySetService } = servicesManager?.services ?? {};
  const activeStudyUID = hps?.getState?.()?.activeStudyUID;
  const site = hangingPresetsState() === 'off' ? null : caseSiteProtocol(activeStudyUID);
  if (!hps || !site || !activeStudyUID || !displaySetService) {
    rehangForMode(servicesManager);
    return;
  }
  const displaySets = displaySetService.getActiveDisplaySets();
  if (!displaySets?.length) {
    return;
  }
  const uids = [...new Set(displaySets.map(ds => ds.StudyInstanceUID))];
  const studies = uids
    .map(uid => (uid ? (DicomMetadataStore.getStudy(uid) as StudyLike | undefined) : undefined))
    .filter((s): s is StudyLike => !!s);
  const activeStudy = studies.find(s => s.StudyInstanceUID === activeStudyUID);
  if (!activeStudy) {
    rehangForMode(servicesManager);
    return;
  }
  // The case's own study first, as the loader orders them.
  const ordered = [activeStudy, ...studies.filter(s => s !== activeStudy)];
  const rehang = planCaseRehang(hps, site, activeStudyUID, displaySets, activeStudy);
  hps.run({ studies: ordered, displaySets, activeStudy }, rehang.runId);
  applyRehangLayout(hps, rehang);
}

type StudyLike = { StudyInstanceUID?: string; StudyDescription?: unknown };

/** The services rehangCase reads (the viewer's own, as the extension hands them in). */
export interface CaseServices {
  services?: {
    hangingProtocolService?: CaseHangingService & {
      getState?: () => { activeStudyUID?: string } | undefined;
      run: (
        params: { studies: StudyLike[]; displaySets: DisplaySetFacts[]; activeStudy: StudyLike },
        protocolId?: string
      ) => void;
    };
    displaySetService?: { getActiveDisplaySets: () => DisplaySetFacts[] };
  };
}

export default rehangForMode;
