import SessionStudyDropdown from './toolbar/SessionStudyDropdown';

/** Toolbar uiType id for the same-session study switcher. */
export const SESSION_SWITCHER_UITYPE = 'pacsai.sessionSwitcher';

/**
 * Registers the `pacsai.sessionSwitcher` toolbar uiType — a dropdown listing the
 * co-loaded same-session studies (current + siblings); selecting one re-hangs it
 * with its own dedicated protocol via the `focusSessionStudy` command. The
 * component reads the live session list from the role registry and hides itself
 * unless there is more than one session study.
 */
/** Evaluator id: disables a stage-nav button unless the active protocol has >1 reachable stage. */
export const MULTI_STAGE_EVALUATOR = 'evaluate.pacsai.multiStage';

export default function getToolbarModule({ commandsManager, servicesManager }: withAppTypes) {
  return [
    {
      name: SESSION_SWITCHER_UITYPE,
      defaultComponent: (props: Record<string, any>) =>
        SessionStudyDropdown({ ...props, commandsManager, servicesManager }),
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
  ];
}
