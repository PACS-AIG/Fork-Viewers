import { Types, DicomMetadataStore } from '@ohif/core';
import loadRelevantPriors from './priors/loadRelevantPriors';
import {
  setBrowsingMode as persistBrowsingMode,
  protocolIdForMode,
  type BrowsingMode,
} from './allinone/browsingMode';

const getCommandsModule = ({
  servicesManager,
  extensionManager,
}: Types.Extensions.ExtensionParams): Types.Extensions.CommandsModule => {
  const actions = {
    /**
     * Finds, loads, and hangs the most relevant prior study/studies for the
     * active comparison protocol. No-op for non-comparison protocols.
     */
    loadRelevantPriors: () => loadRelevantPriors({ servicesManager, extensionManager }),

    /**
     * Re-focus a co-loaded same-session study (the toolbar study switcher): make it
     * the active study, let the protocol engine auto-select ITS dedicated protocol
     * (so it hangs predictably — head gets compareCTHead, etc.), then load its own
     * prior and re-hang. Mirrors opening the study fresh from the worklist.
     */
    focusSessionStudy: ({ studyInstanceUID }: { studyInstanceUID?: string }) => {
      const { hangingProtocolService, displaySetService } = servicesManager.services;
      if (!studyInstanceUID) {
        return;
      }
      const activeStudyUID = hangingProtocolService?.getState?.()?.activeStudyUID;
      if (studyInstanceUID === activeStudyUID) {
        return; // already focused
      }
      const study = DicomMetadataStore.getStudy(studyInstanceUID);
      if (!study) {
        return;
      }
      // Re-run the engine with the chosen study active and NO protocolId so it
      // auto-selects that study's dedicated protocol; keep all loaded studies so the
      // siblings stay co-loaded. loadRelevantPriors then fetches its prior + re-hangs.
      //
      // CRITICAL: put the focused study FIRST in the studies list. OHIF resolves both
      // the active study and the protocol match as `activeStudy || studies[0]`, so when
      // a sibling of a DIFFERENT region is co-loaded (e.g. focusing the head while a
      // cervical spine is also loaded), a stale studies[0] would otherwise keep the
      // cervical active and re-pick compareCTSpine — hanging the head against the spine
      // prior. Making the focused study studies[0] guarantees its dedicated protocol.
      const displaySets = displaySetService.getActiveDisplaySets();
      const otherUIDs = [...new Set(displaySets.map((ds: any) => ds.StudyInstanceUID))].filter(
        (uid: string) => uid !== studyInstanceUID
      );
      const studies = [studyInstanceUID, ...otherUIDs]
        .map((uid: string) => DicomMetadataStore.getStudy(uid))
        .filter(Boolean);
      hangingProtocolService.run({ studies, displaySets, activeStudy: study });
      // DEBUG: confirm run() actually switched the active study + auto-selected the
      // focused study's protocol (before loadRelevantPriors re-hangs with its prior).
      console.log('[pacsai-hp] focusSessionStudy ->', {
        requested: studyInstanceUID,
        activeAfterRun: hangingProtocolService.getState?.()?.activeStudyUID,
        protocolAfterRun: hangingProtocolService.getActiveProtocol?.()?.protocol?.id,
      });
      loadRelevantPriors({ servicesManager, extensionManager });
    },

    /**
     * Switch the all-in-one browsing mode (toolbar control). Persists the choice,
     * then re-hangs the ALREADY-LOADED studies with the mode's protocol — no
     * re-query: priors/siblings were discovered once under the auto-matched compare
     * protocol and stay loaded, so this is a pure re-hang. 'append' auto-selects the
     * best compare protocol (now ending in the all-in-one stage); 'allinone' forces
     * the dedicated all-in-one protocol; 'manual' forces the stock default.
     */
    setBrowsingMode: ({ mode }: { mode?: BrowsingMode }) => {
      if (!mode) {
        return;
      }
      persistBrowsingMode(mode);
      const { hangingProtocolService, displaySetService } = servicesManager.services;
      const displaySets = displaySetService.getActiveDisplaySets();
      if (!displaySets?.length) {
        return;
      }
      const activeStudyUID = hangingProtocolService?.getState?.()?.activeStudyUID;
      const studyUIDs = [...new Set(displaySets.map((ds: any) => ds.StudyInstanceUID))];
      const studies = studyUIDs
        .map((uid: string) => DicomMetadataStore.getStudy(uid))
        .filter(Boolean);
      if (!studies.length) {
        return;
      }
      const activeStudy =
        studies.find((s: any) => s.StudyInstanceUID === activeStudyUID) ?? studies[0];
      // 'append' => undefined => engine auto-selects the active study's compare
      // protocol; 'allinone'/'manual' => the forced protocol id.
      const protocolId = protocolIdForMode(mode, undefined);
      hangingProtocolService.run({ studies, displaySets, activeStudy }, protocolId);
    },
  };

  const definitions = {
    loadRelevantPriors: actions.loadRelevantPriors,
    focusSessionStudy: actions.focusSessionStudy,
    setBrowsingMode: actions.setBrowsingMode,
  };

  return {
    actions,
    definitions,
    defaultContext: 'DEFAULT',
  };
};

export default getCommandsModule;
