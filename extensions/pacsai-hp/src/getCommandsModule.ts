import { Types, DicomMetadataStore } from '@ohif/core';
import loadRelevantPriors from './priors/loadRelevantPriors';

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
      const displaySets = displaySetService.getActiveDisplaySets();
      const studyUIDs = [...new Set(displaySets.map((ds: any) => ds.StudyInstanceUID))];
      const studies = studyUIDs
        .map((uid: string) => DicomMetadataStore.getStudy(uid))
        .filter(Boolean);
      hangingProtocolService.run({ studies, displaySets, activeStudy: study });
      loadRelevantPriors({ servicesManager, extensionManager });
    },
  };

  const definitions = {
    loadRelevantPriors: actions.loadRelevantPriors,
    focusSessionStudy: actions.focusSessionStudy,
  };

  return {
    actions,
    definitions,
    defaultContext: 'DEFAULT',
  };
};

export default getCommandsModule;
