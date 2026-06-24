import React, { useEffect, useState } from 'react';
import {
  getBrowsingMode,
  subscribeBrowsingMode,
  BROWSING_MODES,
  BROWSING_MODE_LABELS,
  type BrowsingMode,
} from '../allinone/browsingMode';

/**
 * Toolbar control for the all-in-one browsing mode (a sticky, global reader
 * preference). Selecting a mode runs the `setBrowsingMode` command, which persists
 * the choice and re-hangs the already-loaded studies with that mode's protocol
 * (append = compare + all-in-one last stage; allinone = all-in-one only; manual =
 * stock default). Always visible (unlike the session switcher) so the reader can
 * switch at any time.
 *
 * Renders a plain styled <select> for portability across OHIF UI versions (mirrors
 * SessionStudyDropdown); restyle/replace with a ui-next dropdown if preferred.
 */
function BrowsingModeDropdown({ commandsManager }: Record<string, any>) {
  const [mode, setMode] = useState<BrowsingMode>(getBrowsingMode());

  useEffect(() => subscribeBrowsingMode(() => setMode(getBrowsingMode())), []);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as BrowsingMode;
    if (next !== mode) {
      commandsManager.runCommand('setBrowsingMode', { mode: next });
    }
  };

  return (
    <select
      data-cy="pacsai-browsing-mode"
      title="Browsing mode — how the all-in-one series is hung"
      value={mode}
      onChange={onChange}
      style={{
        boxSizing: 'border-box',
        height: 36,
        alignSelf: 'center',
        verticalAlign: 'middle',
        maxWidth: 200,
        padding: '0 22px 0 8px',
        margin: '0 6px',
        background: '#041c4a',
        color: '#e6f1ff',
        border: '1px solid #155bb5',
        borderRadius: 4,
        fontSize: 13,
        lineHeight: '34px',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {BROWSING_MODES.map(m => (
        <option key={m} value={m}>
          {BROWSING_MODE_LABELS[m]}
        </option>
      ))}
    </select>
  );
}

export default BrowsingModeDropdown;
