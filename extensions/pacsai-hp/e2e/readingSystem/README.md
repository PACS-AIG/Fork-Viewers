# The CT reading system's pane: end-to-end tests (RS-36)

These tests drive the radcopilot viewer's CT analysis pane (the Copilot, the
inbox and the change list, `extensions/pacsai-hp/src/readingSystem/`) against
the reading system's served API in fixture mode. PACS-AIG/ct-analysis-system
runs them as its `rs-editor-ui` gate (its BP-14b; decision D-320), at a pinned
commit of this fork. This fork is public, so that CI can check it out without
a token.

The pane sits at the top of the reading dock's report column, above the
report editor (the island), which keeps the rest of the column. It needs
`READING_DOCK` and `PACSAI_READING_SYSTEM_API`; the harness serves both.

## What they check

| Test | Clause (ct-analysis-system) |
| --- | --- |
| A study with no images opens on the radcopilot route with the complete published draft in the report column, above the island; folded, the pane gives the column back | invariant 1; exit criterion 1 |
| Clicking a sentence selects it and opens nothing; one key (`K`, or Enter on the sentence) opens the Copilot on its finding, showing the evidence view's measurement, sources and unresolved predicates; `K` in a text field is typing | invariant 16; exit criterion 3 |
| A result that completes after opening lands in the inbox with its exact preview, and the published draft is unchanged; the change list shows it | invariant 5; exit criterion 4 |
| Accepting the entry publishes the change at one revision; nothing is left in the change list; one Undo restores the draft and the entry | invariants 4 and 5; exit criterion 4 |
| An action against a revision another reader moved is answered 409, applies nothing, and the pane shows the current draft | event intake's stale base revision |
| Rejecting an entry leaves the draft as it was; a patch of the reader's own wording is shown, never applied | invariant 6; §2.13's three-way patch |
| The anatomy layers (`rsAnatomyCpu` without WebGL, `rsAnatomyWebgl` with it): the anatomy artifact is read and its tab offered first; its structures are listed head to feet with their slice extents, and volumes for the measurement-eligible ones only (§2.3); a click on one brings its slice into the viewport, where each label lies exactly over its structure on the rendered image, the clicked one picked out (every other label at a quarter of its strength) with its name beside it and a leader ending inside it, until Esc or Show all in the layers' row clears it; hovering names it; the bar's button turns the layers off and on; a structure's research features (contract 1.15) open in a section of their own, marked research use only; the series' 3D button (contract 1.17's display surfaces, read only then) draws the structures from the front, the liver on the left, following the tab's switches (the body cavities hidden until shown, then see-through), enlarged over the images beside the report column and back with Esc; without WebGL the 3D view says so. These run with the grid's 3D cell switched off | §2.16's layer control and hover; D-289's anatomy artifact; D-345's display surfaces; guide 04 (never in the segmentation panel) |
| The 3D anatomy in a cell of the viewer's grid (`rsAnatomyGrid`, with WebGL; WeiWei, 25 Nov 2026): the gear menu's setting on (the default), the protocol's one viewport gains the cell beside it (1x2) once the surfaces are offered; the cell draws the model from the front, its sides inside the narrow cell, the image keeping its labels; the tab's 3D button and the cell's x take it out (the protocol's 1x1 back) and the button puts it in again; the gear menu's switch off takes it out and the 3D button opens the model in the tab, on again puts it back | D-345's display surfaces; guide 04 (never in the segmentation panel) |
| The PathGrade tab (`rsPathgrade`): this study's PathGrade results only (WeiWei, 25 Nov 2026; D-344). The served study's strip is empty, so its tab is hidden; with that strip turned held by the test in the evidence view the pane reads, the tab is there, counted, and lists the finding as the pane names it with the strip as the evidence view words it. No showcase is read in either | §2.14's reference-case strip; PG-05 |
| The refine tool (`rsRefine`, without WebGL; RS-38, WeiWei, 26 Nov 2026), on the fixture `refine` (fx-refine) against the served refine routes (D-347, contract 1.18): the main toolbar's Refine outline button arms it; a box drawn around the candidate on its slice sends one `POST /segment` refine naming the lesion's revisions as `refine_targets` gives them (the task's own recipe, no `alternative` or `trigger`), the box put exactly on the slice; SAM2CT's outline (the fixture's: the block grown by a voxel, 1,620 voxels) is drawn with its edges on its voxels, beside the current one, with the bar's Keep, Discard and Try again; Keep accepts the attempt (`accept`, target `proposal`) and the targets read again show outline revision 2; a click sends one positive point and Discard rejects that attempt; a mark far from the lesion sends nothing and says so; the server's stale (409) and refused (422) answers, provoked by altering one request in flight, are said; a keep against a published revision that moved is answered 409, sent again and kept; nothing becomes a measurement; another tool disarms it | FINAL_SPEC §2.4 (a reader's refinement request); D-117; D-347 |

The tests name studies by fixture key (`renal`, `machine_measurement_update`,
`clinician_prose`, `refine`): the harness finds each through the API's outbox by its
snapshot id (`fx-<key>`). No study UID is written in a test or printed. Every
document a test compares with is the served API's own; nothing of the reading
system's fixtures is copied here.

The anatomy tests read the fixture study's documents from the served API like
the others, and serve the rest themselves through Playwright's routes: a
synthetic CT series (20 axial slices of 64 x 64, two bright blocks) on the
harness's archive, and its anatomy artifact with two labelmaps on the series'
grid (contract 1.10) and their display surfaces, a box around each block
(contract 1.17), every UID a 2.25 placeholder made up for the test. They
need nothing more from the gate. `rsAnatomyWebgl` and `rsAnatomyGrid` are
skipped where Chrome gives no WebGL even with SwiftShader.

## What the gate needs

1. **This fork at the pinned commit**, Node 18, and its dependencies:
   `yarn install --frozen-lockfile` (yarn 1.22).
2. **Playwright's Chromium for the pinned `@playwright/test` (1.48.0):**
   `node_modules/.bin/playwright install --with-deps chromium`.
3. **The built viewer at the root path:**
   `PUBLIC_URL=/ QUICK_BUILD=true yarn --cwd platform/app run build:viewer`
   (writes `platform/app/dist`, about 15 s from a warm cache).
4. **The served API in fixture mode, on a fresh record store** (the tests
   change the records of the two studies with a late result, so give each run
   its own database), from ct-analysis-system:
   - `make rs-migrate` and `make compile-fixtures`;
   - `python -m claimengine.serve api --mode fixture --bundle build/fixture_bundle --fixtures tests/fixtures --root <an empty directory> --refresh-s 1 --port 8300`
     with `RS_DATABASE_URL` and `RS_API_TOKEN_FILE` (a token of at least 32
     characters). `--refresh-s 1` lets a late result reach the pane within
     about a second. No CORS origin is needed: the harness forwards on the
     page's own origin.
5. **A command that commits a fixture's late result** into that store, named
   by `RS_E2E_LATE_RESULT` with `{fixture}` for the fixture key. Nothing in
   ct-analysis-system does this yet; its half of the gate adds it. It must do
   what its fixture demonstration does after the reader opened the study:
   build `claimengine.scenarios.late_result(<the fixture snapshot>,
   <the study's current output:segment.mask version>)` and commit it with
   `RecordStore.commit_result(<study>, claimengine.scenarios.MODEL, <it>, {})`
   on `RS_DATABASE_URL`. The running server publishes it at its next refresh.
   It prints no UID or URL. The tests fail, not skip, when the variable is
   unset.
6. **Run:**
   ```bash
   RS_API_URL=http://127.0.0.1:8300 RS_API_TOKEN_FILE=<token file> RS_E2E_LATE_RESULT='<command with {fixture}>' node_modules/.bin/playwright test -c extensions/pacsai-hp/e2e/readingSystem/playwright.config.ts
   ```
   The exit code is the gate's result. The JSON report is
   `extensions/pacsai-hp/e2e/readingSystem/test-results/rs-editor-ui.json`
   (`RS_E2E_REPORT` moves it); a failing test keeps its trace there.

The harness (`harness.mjs`) is started by the Playwright config, or reused if
it already runs on `RS_E2E_PORT` (default 3036). It serves the built viewer
and its own viewer config; it forwards `/rs-api/*` to `RS_API_URL` with the
bearer token, as the app's proxy route will on dev. With `HTTP(S)_PROXY` set,
the browser goes through the proxy except for loopback (`NO_PROXY`) and any hosts
`RS_E2E_PROXY_BYPASS` lists, and so does a non-loopback `RS_API_URL`. The tests
reach no image archive: the harness's DICOMweb has no studies (the anatomy
tests answer its routes themselves).

## Locally

The same steps, with ct-analysis-system's `.venv` and a throwaway Postgres.
`RS_E2E_CHANNEL=chrome` drives an installed Google Chrome instead of
Playwright's own Chromium.

## On dev

The pane reads `window.PACSAI_READING_SYSTEM_API`, a base path on the
viewer's own origin. On dev that is the app's proxy route (PACS-AIG/app, not
built yet). It must hold the API's token server-side, forward `GET` and
`POST` with the body and `Content-Type`, take the page's session, and pass
200, 409 and 422 through unchanged. Leave `PACSAI_READING_SYSTEM_MODE` unset
there, so the viewer reads clinical documents only.
