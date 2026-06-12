import React, { useEffect, useState } from 'react';
import { getSessionStudies, subscribeSessionStudies } from '../priors/roleRegistry';

/**
 * Toolbar study switcher for same-session multi-region sets (e.g. CT head + CT
 * cervical, CT/CTA). Lists the co-loaded session studies; selecting one runs the
 * `focusSessionStudy` command, which re-hangs that study with ITS dedicated
 * protocol + prior (a full, predictable re-hang — no dragging series).
 *
 * Hidden unless there is more than one session study, so single-study reads are
 * unaffected. Renders a plain styled <select> for portability across OHIF UI
 * versions; restyle/replace with a ui-next dropdown if preferred.
 */
function SessionStudyDropdown({ commandsManager, servicesManager }: Record<string, any>) {
  const hangingProtocolService = servicesManager?.services?.hangingProtocolService;
  const [studies, setStudies] = useState(getSessionStudies());
  const [activeUID, setActiveUID] = useState<string | undefined>(
    hangingProtocolService?.getState?.()?.activeStudyUID
  );

  useEffect(() => {
    const refresh = () => {
      setStudies(getSessionStudies());
      setActiveUID(hangingProtocolService?.getState?.()?.activeStudyUID);
    };
    const unsubSession = subscribeSessionStudies(refresh);
    // Keep the active highlight in sync when the protocol re-hangs.
    const sub = hangingProtocolService?.subscribe?.(
      hangingProtocolService.EVENTS?.PROTOCOL_CHANGED,
      refresh
    );
    return () => {
      unsubSession();
      sub?.unsubscribe?.();
    };
  }, [hangingProtocolService]);

  if (!studies || studies.length < 2) {
    return null;
  }

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const studyInstanceUID = e.target.value;
    if (studyInstanceUID && studyInstanceUID !== activeUID) {
      commandsManager.runCommand('focusSessionStudy', { studyInstanceUID });
    }
  };

  return (
    <select
      data-cy="pacsai-session-switcher"
      title="Switch to another study in this session"
      value={activeUID ?? ''}
      onChange={onChange}
      style={{
        background: '#041c4a',
        color: '#e6f1ff',
        border: '1px solid #155bb5',
        borderRadius: 4,
        padding: '2px 6px',
        margin: '0 6px',
        maxWidth: 220,
        height: 28,
      }}
    >
      {studies.map(s => (
        <option key={s.uid} value={s.uid}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

export default SessionStudyDropdown;
