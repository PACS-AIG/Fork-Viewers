# @ohif/extension-pacsai-hp

Modality-aware hanging protocols with **auto-loaded relevant priors** (ClearCanvas-style).

When a study opens, the viewer auto-selects a comparison protocol by the current
study's modality, fetches the most relevant prior study/studies for the patient,
and re-hangs current-vs-prior side by side.

## What it provides

- **Comparison protocols** (`getHangingProtocolModule`):
  - `@pacsai/compareCT` — CT, current + up to 2 priors
  - `@pacsai/compareMR` — MR, current + up to 2 priors
  - `@pacsai/compareCR` — CR/DX/XR, current + 1 prior

  Each matches on the current study's modality only (not on prior presence) and
  has stages that degrade from densest (current + N priors) to current-only via
  `stageActivation.minViewportsMatched`.

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
