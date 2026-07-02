import SessionStudyDropdown from './toolbar/SessionStudyDropdown';
import BrowsingModeDropdown from './toolbar/BrowsingModeDropdown';
import activeViewportHasCT from './utils/activeViewportHasCT';

/** Toolbar uiType id for the same-session study switcher. */
export const SESSION_SWITCHER_UITYPE = 'pacsai.sessionSwitcher';

/** Toolbar uiType id for the all-in-one browsing-mode selector. */
export const BROWSING_MODE_UITYPE = 'pacsai.browsingMode';

/**
 * Registers the `pacsai.sessionSwitcher` toolbar uiType — a dropdown listing the
 * co-loaded same-session studies (current + siblings); selecting one re-hangs it
 * with its own dedicated protocol via the `focusSessionStudy` command. The
 * component reads the live session list from the role registry and hides itself
 * unless there is more than one session study.
 */
/** Evaluator id: disables a stage-nav button unless the active protocol has >1 reachable stage. */
export const MULTI_STAGE_EVALUATOR = 'evaluate.pacsai.multiStage';

/** Evaluator id: disables a button unless the active viewport is showing CT (HU-calibrated). */
export const CT_ONLY_EVALUATOR = 'evaluate.pacsai.ctOnly';

export default function getToolbarModule({ commandsManager, servicesManager }: withAppTypes) {
  return [
    {
      name: SESSION_SWITCHER_UITYPE,
      defaultComponent: (props: Record<string, any>) =>
        SessionStudyDropdown({ ...props, commandsManager, servicesManager }),
    },
    {
      // All-in-one browsing-mode selector (append / all-in-one only / manual).
      // Selecting a mode persists it and re-hangs the loaded studies via the
      // `setBrowsingMode` command.
      name: BROWSING_MODE_UITYPE,
      defaultComponent: (props: Record<string, any>) =>
        BrowsingModeDropdown({ ...props, commandsManager, servicesManager }),
    },
    {
      // Disable the next/previous-stage buttons when there is nothing to navigate
      // to — i.e. the active protocol has <= 1 stage the engine would land on.
      // next/prev skip 'disabled' stages (HangingProtocolService
      // _setCurrentProtocolStage), so we count stages whose status isn't 'disabled'.
      // Covers a case with NO comparison protocol (e.g. US falls back to OHIF's
      // single-stage default) and any compare protocol where only one stage is live.
      name: MULTI_STAGE_EVALUATOR,
      evaluate: () => {
        const { hangingProtocolService } = servicesManager.services;
        const { protocol } = hangingProtocolService?.getActiveProtocol?.() ?? {};
        const stages = protocol?.stages ?? [];
        // Statuses are computed at hang time; before that they're undefined, which
        // (!== 'disabled') counts as reachable — the single-stage default still
        // resolves to 1 and disables correctly.
        const reachable = stages.filter(
          (s: { status?: string }) => s?.status !== 'disabled'
        ).length;
        const disabled = reachable <= 1;
        return {
          disabled,
          disabledText: disabled ? 'No other hanging protocol stages for this study' : undefined,
        };
      },
    },
    {
      // HU-flavored tools (HU probe) only make sense on CT — the only modality
      // whose pixels are Hounsfield-calibrated. Disabled (not hidden) elsewhere
      // so the toolbar layout stays stable.
      name: CT_ONLY_EVALUATOR,
      evaluate: () => {
        const disabled = !activeViewportHasCT(servicesManager);
        return {
          disabled,
          disabledText: disabled ? 'HU values require a CT viewport' : undefined,
        };
      },
    },
  ];
}
