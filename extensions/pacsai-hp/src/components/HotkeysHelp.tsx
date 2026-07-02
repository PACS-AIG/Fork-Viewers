import React from 'react';

/**
 * Read-only keyboard-shortcut sheet, opened with `?` (see the longitudinal
 * mode's hotkeys) or via the `openHotkeysHelp` command. Renders whatever is
 * CURRENTLY bound — including user overrides from the User Preferences dialog —
 * by reading hotkeysManager.hotkeyDefinitions at open time, so it never drifts
 * from reality. Editing stays in User Preferences; this is just for looking up
 * "what was that key again?" mid-read.
 */

function Keys({ keys }: { keys: unknown }) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean).map(String);
  return (
    <span className="flex shrink-0 gap-1">
      {list.map((key, i) => (
        <kbd
          key={i}
          className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] leading-none text-white/90"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export default function HotkeysHelp({
  hotkeyDefinitions,
}: {
  hotkeyDefinitions?: Record<string, { label?: string; keys?: unknown }>;
}) {
  const definitions = Object.values(hotkeyDefinitions ?? {}).filter(
    definition => definition?.label && definition?.keys
  );

  if (!definitions.length) {
    return <div className="text-white/70">No keyboard shortcuts are bound.</div>;
  }

  return (
    <div className="max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        {definitions.map((definition, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 border-b border-white/10 py-1.5"
          >
            <span className="text-[13px] text-white/90">{definition.label}</span>
            <Keys keys={definition.keys} />
          </div>
        ))}
      </div>
      <div className="pt-3 text-[12px] text-white/50">
        Shortcuts can be customized in the user-menu → Preferences.
      </div>
    </div>
  );
}
