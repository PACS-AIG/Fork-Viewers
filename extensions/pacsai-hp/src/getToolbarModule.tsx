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
export default function getToolbarModule({ commandsManager, servicesManager }: withAppTypes) {
  return [
    {
      name: SESSION_SWITCHER_UITYPE,
      defaultComponent: (props: Record<string, any>) =>
        SessionStudyDropdown({ ...props, commandsManager, servicesManager }),
    },
  ];
}
