import { Types, DicomMetadataStore } from '@ohif/core';
import loadRelevantPriors from './priors/loadRelevantPriors';
import selectPrior from './priors/selectPrior';
import { setBrowsingMode as persistBrowsingMode, type BrowsingMode } from './allinone/browsingMode';
import { rehangForMode } from './allinone/rehang';
import { toggleClinicalContextVisibility } from './clinicalContext/clinicalContextStore';
import activeViewportHasCT from './utils/activeViewportHasCT';
import HotkeysHelp from './components/HotkeysHelp';

const getCommandsModule = ({
  servicesManager,
  extensionManager,
  commandsManager,
  hotkeysManager,
}: Types.Extensions.ExtensionParams): Types.Extensions.CommandsModule => {
  const actions = {
    /**
     * Finds, loads, and hangs the most relevant prior study/studies for the
     * active comparison protocol. No-op for non-comparison protocols.
     */
    loadRelevantPriors: () => loadRelevantPriors({ servicesManager, extensionManager }),

    /**
     * Hang a DIFFERENT prior than the one the policy auto-picked (the on-image
     * prior switcher, and available as a command for hotkeys/console). Loads the
     * chosen study's display sets if needed, re-points the `prior` role, and
     * re-hangs the active browsing mode's protocol — no re-query.
     */
    selectPrior: ({
      studyInstanceUID,
      replaceUID,
    }: {
      studyInstanceUID?: string;
      replaceUID?: string;
    }) => selectPrior({ servicesManager, extensionManager, studyInstanceUID, replaceUID }),

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
     * best compare protocol (now ending in the all-in-one stage); 'current' hangs that
     * same protocol's no-prior stages (the prior stays loaded but gets no hanging role,
     * siblings still compare); 'allinone' forces the dedicated all-in-one protocol;
     * 'manual' forces the stock default.
     */
    setBrowsingMode: ({ mode }: { mode?: BrowsingMode }) => {
      if (!mode) {
        return;
      }
      persistBrowsingMode(mode);
      rehangForMode(servicesManager);
    },

    /**
     * Show/hide the on-image clinical-context overlay (age · sex · indication).
     * Preference persists across sessions; the overlay re-renders via the store
     * subscription. Bound to a hotkey in the app config.
     */
    toggleClinicalContextOverlay: () => toggleClinicalContextVisibility(),

    /**
     * Modality-gated wrapper around `setWindowLevel` for the 1-9 preset
     * hotkeys: the preset values are CT Hounsfield-unit windows, meaningless
     * on CR/DX/MR/US pixels (on an X-ray they wash the image out to white),
     * so this is a no-op unless the ACTIVE viewport is showing CT. Mirrors the
     * WL corner menu, whose preset table is already keyed by modality.
     */
    setCtWindowLevel: (props: { window: string; level: string }) => {
      if (!activeViewportHasCT(servicesManager)) {
        return;
      }
      commandsManager.runCommand('setWindowLevel', props);
    },

    /**
     * Read-only shortcut sheet (`?`). Reads the LIVE bindings from
     * hotkeysManager at open time, so user-customized keys show correctly.
     */
    openHotkeysHelp: () => {
      const { uiModalService } = servicesManager.services;
      uiModalService.show({
        title: 'Keyboard Shortcuts',
        content: HotkeysHelp,
        contentProps: { hotkeyDefinitions: hotkeysManager?.hotkeyDefinitions },
        containerDimensions: 'w-[560px] max-w-[90vw]',
      });
    },
  };

  const definitions = {
    loadRelevantPriors: actions.loadRelevantPriors,
    selectPrior: actions.selectPrior,
    focusSessionStudy: actions.focusSessionStudy,
    setBrowsingMode: actions.setBrowsingMode,
    toggleClinicalContextOverlay: actions.toggleClinicalContextOverlay,
    setCtWindowLevel: actions.setCtWindowLevel,
    openHotkeysHelp: actions.openHotkeysHelp,
  };

  return {
    actions,
    definitions,
    defaultContext: 'DEFAULT',
  };
};

export default getCommandsModule;
