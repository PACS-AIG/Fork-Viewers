# @ohif/mode-radcopilot

PACS AI's reading mode (Rev 11 milestone 6, approach C, phase 1). It is the
longitudinal mode, with the same hanging protocols, SOP class handlers, panels
and lifecycle, plus the reading dock of `@ohif/extension-pacsai-hp`
(`src/readingDock/`): the app's v1 report editor, built as an "island", mounted
in a report column of the viewer's own page, with Images / Both / Report.

- Route: `/viewer/viewer/radcopilot?StudyInstanceUIDs=…&gatewayAET=…` (the
  router basename plus the public URL plus the route name).
- Not in the study list: it has no display name.
- Hotkeys under their own name (`radcopilot-hotkey-definitions`), so a
  reader's saved OHIF hotkeys do not replace them; Alt+1/2/3 switch Images /
  Both / Report.
- `READING_DOCK` (runtime, the deploy repo's `config.js`), default off: off,
  the route is the longitudinal viewer with no report column.
- The app must serve the island (`WORKSPACE_VIEWER_HOST`, answered by
  `/api/workspace/flags` as `viewerHost`); otherwise the column says so.

The longitudinal mode is not changed.
