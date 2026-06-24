import { DicomMetadataStore } from '@ohif/core';
import { getBrowsingMode, protocolIdForMode } from './browsingMode';

/**
 * Re-hang the currently-loaded studies with the active browsing mode's protocol —
 * a pure re-hang over `getActiveDisplaySets()`, with NO QIDO/re-query. Used by the
 * browsing-mode toolbar switch and by the all-in-one auto-refresh (when a composite
 * is first created). 'append' passes undefined so the engine auto-selects the active
 * study's compare protocol (now ending in the all-in-one stage); 'allinone'/'manual'
 * force the dedicated / stock-default protocol.
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

export default rehangForMode;
