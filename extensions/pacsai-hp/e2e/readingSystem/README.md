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
| The anatomy layers (`rsAnatomyCpu` without WebGL, `rsAnatomyWebgl` with it): the anatomy artifact is read and its tab offered first; its structures are listed head to feet with their slice extents, and volumes for the measurement-eligible ones only (§2.3); a click on one brings its slice into the viewport, where each label lies exactly over its structure on the rendered image, the clicked one picked out (every other label at a quarter of its strength) with its name beside it and a leader ending inside it, until Esc clears it; hovering names it; the bar's button turns the layers off and on; a structure's research features (contract 1.15) open in a section of their own, marked research use only | §2.16's layer control and hover; D-289's anatomy artifact; guide 04 (never in the segmentation panel) |
| The PathGrade tab (`rsPathgrade`, contract 1.16, D-343; the test serves the two showcase routes itself, as the fixture-mode API serves a showcase only when one was built under its own bundle and mode): offered as "PathGrade (research)", read only once opened; its notice and the cohort's credit first; this study's findings with a reference-case strip, from the served evidence view (else that none has one); its sections in order as the API words them; each picture shown only once its bytes match the sha256 listed (one that does not says why); a click shows one larger, Escape closes it; with none served, the API's 404 words shown plainly | §2.19; invariants 19 to 21; PG-05 |

The tests name studies by fixture key (`renal`, `machine_measurement_update`,
`clinician_prose`): the harness finds each through the API's outbox by its
snapshot id (`fx-<key>`). No study UID is written in a test or printed. Every
document a test compares with is the served API's own; nothing of the reading
system's fixtures is copied here.

The anatomy tests read the fixture study's documents from the served API like
the others, and serve the rest themselves through Playwright's routes: a
synthetic CT series (20 axial slices of 64 x 64, two bright blocks) on the
harness's archive, and its anatomy artifact with two labelmaps on the series'
grid (contract 1.10), every UID a 2.25 placeholder made up for the test. They
need nothing more from the gate. `rsAnatomyWebgl` is skipped where Chrome gives
no WebGL even with SwiftShader.

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
