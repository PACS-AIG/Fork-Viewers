# @ohif/extension-pacsai-hp

Modality-aware hanging protocols with **auto-loaded relevant priors** (ClearCanvas-style).

When a study opens, the viewer auto-selects a comparison protocol by the current
study's modality, fetches the most relevant prior study/studies for the patient,
and re-hangs current-vs-prior side by side.

## What it provides

- **Comparison protocols** (`getHangingProtocolModule`), current beside prior:
  - Generic per-modality (fallbacks): `@pacsai/compareCT`, `@pacsai/compareMR`
    (axial/coronal/sagittal), `@pacsai/compareCR` (single image).
  - Exam-specific (higher weight, win when the exam matches):
    - `@pacsai/compareCTSpine` / `@pacsai/compareMRSpine` — **sagittal-first**.
    - `@pacsai/compareCTChest` — axial **lung/soft/bone windows** + coronal.
    - `@pacsai/compareCTHead` — axial **brain/bone windows**.
    - `@pacsai/compareMRBrain` — **by sequence** (T1/T2/FLAIR/DWI).

  Exam protocols match on modality + `StudyDescription` (body part); generic ones
  match modality only. `ProtocolEngine` picks the highest-weight match, so the
  exam protocol wins when it applies and falls back to the generic one otherwise.
  All match on the current study only (not on prior presence): stages with a
  prior viewport stay disabled (via `minViewportsMatched`) until the loader hangs
  a prior. Series matching requires real image counts and excludes scouts/topograms.

- **`loadRelevantPriors` command** (`getCommandsModule`): finds, scores, loads,
  and re-hangs the relevant priors. No-op for non-comparison protocols, data
  sources without patient query, or patients with no qualifying priors.

## Prior relevance scoring (`src/priors`)

Priors are ranked by a composable scoring pipeline (`scorePrior`):

- `scorers/baseRelevance` — modality × body-part relevance matrix
- `scorers/recency` — time-from-current-study bonus
- `scorers/indication` — StudyDescription / finding-keyword match

Per-protocol policy (`priorPolicy.ts`) sets `minScore` / `maxPriors`, overridable
via the customization service key `pacsai.priorPolicy`:

```js
window.config = {
  customizationService: [
    { 'pacsai.priorPolicy': { $set: { '@pacsai/compareCT': { maxPriors: 3, minScore: 40 } } } },
  ],
};
```

## Wiring

Registered in `platform/app/pluginConfig.json` and used by the longitudinal mode
(`modes/longitudinal`), which lists the protocols in `hangingProtocol` and runs
`loadRelevantPriors` from `onSetupRouteComplete`.

## Tests

`yarn jest extensions/pacsai-hp` runs `src/priors/scorePrior.test.ts`.
