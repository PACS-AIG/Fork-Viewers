/**
 * Rev 11 milestone 7 (B31): regression fixtures for the existing auto-hanging.
 *
 * "Regression fixtures proving the existing sixteen protocols still hang
 * identically." Each scenario is a synthetic case (a current study, and where it
 * says so a prior and a same-session sibling) hung through OHIF's own
 * HangingProtocolService with the protocols the radcopilot and longitudinal
 * modes offer (their `hangingProtocol` list, read from the mode's source) and
 * the custom attributes the viewer registers (hangingAttributes.ts, the same
 * function preRegistration calls). The hang is replayed the way the viewer
 * does it:
 *
 *   1. the first hang: the current study alone, the protocol auto-matched;
 *   2. once the comparison is loaded (loadRelevantPriors): the roles set, an
 *      all-in-one composite per study, and the matched protocol run again over
 *      every study, in the browsing mode `append`;
 *   3. the other browsing modes over the same studies: `current` (the prior's
 *      hanging role suppressed), `allinone` (the all-in-one protocol) and
 *      `manual` (OHIF's default).
 *
 * For each, what is recorded is what a reader would see: the protocol, the
 * opening stage, every stage's status, and for every stage that can be shown
 * its grid and which display set each viewport gets (with its window preset).
 * The result is compared with `__fixtures__/hanging-baseline.json`, captured on
 * pacs-aig/viewer-dev a91489256 before milestone 7 changed anything. Run with
 * UPDATE_HANGING_BASELINE=1 to write the file again, and only when a change to
 * the hanging is meant (the diff then shows exactly what moved).
 *
 * No patient data: every study, series and description is made up here.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- drives OHIF's untyped hanging internals */
jest.mock('@ohif/core', () => ({ classes: {} }));

// eslint-disable-next-line import/first
import fs from 'fs';
// eslint-disable-next-line import/first
import path from 'path';
// eslint-disable-next-line import/first
import {
  compositeOf,
  makeStudy,
  modeProtocolIds,
  newService,
  type DS,
  type Study,
  type StudySpec,
} from './__fixtures__/hangingHarness';
// eslint-disable-next-line import/first
import { clearComparisonRoles, setComparisonRoles } from '../priors/roleRegistry';
// eslint-disable-next-line import/first
import { setBrowsingMode, protocolIdForMode, type BrowsingMode } from '../allinone/browsingMode';

const BASELINE = path.join(__dirname, '__fixtures__', 'hanging-baseline.json');

// ---- synthetic studies ----------------------------------------------------------

type Scenario = {
  name: string;
  current: StudySpec;
  prior?: StudySpec;
  sibling?: StudySpec;
};

const CT = 'CT';
const MR = 'MR';

const SCENARIOS: Scenario[] = [
  {
    name: 'ct-chest-with-prior',
    current: {
      desc: 'CT CHEST WITH CONTRAST',
      modality: CT,
      date: '20261101',
      series: [
        { d: 'Topogram 0.6 T20f', n: 1, k: 'T20f' },
        { d: 'AX LUNG 1.25mm', k: 'LUNG' },
        { d: 'AX SOFT 2.5mm', k: 'STANDARD' },
        { d: 'COR SOFT 3mm', k: 'STANDARD' },
        { d: 'SAG SOFT 3mm', k: 'STANDARD' },
        { d: 'AX MIP 10mm', k: 'STANDARD' },
      ],
    },
    prior: {
      desc: 'CT CHEST WITHOUT CONTRAST',
      modality: CT,
      date: '20250301',
      series: [
        { d: 'AX LUNG 1.25mm', k: 'LUNG' },
        { d: 'AX SOFT 2.5mm', k: 'STANDARD' },
        { d: 'COR SOFT 3mm', k: 'STANDARD' },
      ],
    },
  },
  {
    name: 'ct-chest-no-prior',
    current: {
      desc: 'CT CHEST WITHOUT CONTRAST',
      modality: CT,
      date: '20261101',
      series: [
        { d: 'AX LUNG 1.25mm', k: 'LUNG' },
        { d: 'AX SOFT 2.5mm', k: 'STANDARD' },
        { d: 'COR SOFT 3mm', k: 'STANDARD' },
        { d: 'SAG SOFT 3mm', k: 'STANDARD' },
      ],
    },
  },
  {
    name: 'ct-head-with-prior',
    current: {
      desc: 'CT HEAD WITHOUT CONTRAST',
      modality: CT,
      date: '20261102',
      series: [
        { d: 'AX BRAIN 5mm', k: 'H31s' },
        { d: 'AX BONE 2mm', k: 'H70h' },
        { d: 'COR BRAIN 3mm', k: 'H31s', t: 'DERIVED\\SECONDARY\\REFORMATTED' },
        { d: 'SAG BRAIN 3mm', k: 'H31s', t: 'DERIVED\\SECONDARY\\REFORMATTED' },
      ],
    },
    prior: {
      desc: 'CT HEAD WITHOUT CONTRAST',
      modality: CT,
      date: '20240610',
      series: [
        { d: 'AX BRAIN 5mm', k: 'H31s' },
        { d: 'AX BONE 2mm', k: 'H70h' },
      ],
    },
  },
  {
    name: 'ct-neck-with-prior',
    current: {
      desc: 'CT NECK SOFT TISSUE WITH CONTRAST',
      modality: CT,
      date: '20261102',
      series: [
        { d: 'AX NECK 2mm', k: 'STANDARD' },
        { d: 'COR NECK 2mm', k: 'STANDARD' },
        { d: 'SAG NECK 2mm', k: 'STANDARD' },
      ],
    },
    prior: {
      desc: 'CT NECK SOFT TISSUE WITH CONTRAST',
      modality: CT,
      date: '20250102',
      series: [
        { d: 'AX NECK 2mm', k: 'STANDARD' },
        { d: 'COR NECK 2mm', k: 'STANDARD' },
      ],
    },
  },
  {
    name: 'ct-temporal-bone-no-prior',
    current: {
      desc: 'CT TEMPORAL BONE WITHOUT CONTRAST',
      modality: CT,
      date: '20261103',
      series: [
        { d: 'AX BONE 0.6mm', k: 'BONE' },
        { d: 'COR BONE 0.6mm', k: 'BONE' },
        { d: 'SAG BONE 0.6mm', k: 'BONE' },
        { d: 'AX SOFT 2mm', k: 'STANDARD' },
        { d: 'COR SOFT 2mm', k: 'STANDARD' },
      ],
    },
  },
  {
    name: 'cta-head-neck-no-prior',
    current: {
      desc: 'CTA HEAD AND NECK',
      modality: CT,
      date: '20261103',
      series: [
        { d: 'AX HEAD CTA 0.6mm', k: 'Hv36' },
        { d: 'AX NECK CTA 0.6mm', k: 'Hv36' },
        { d: 'AX MIP HEAD 10mm', k: 'Hv36' },
        { d: 'COR MIP HEAD 10mm', k: 'Hv36' },
        { d: 'SAG MIP HEAD 10mm', k: 'Hv36' },
        { d: 'COR MIP NECK 10mm', k: 'Hv36' },
        { d: 'SAG MIP NECK 10mm', k: 'Hv36' },
        { d: 'CPR LT ICA', k: 'Hv36', n: 30 },
        { d: 'CPR RT ICA', k: 'Hv36', n: 30 },
        { d: 'Bolus tracking', k: 'Hv36', n: 12 },
      ],
    },
  },
  {
    name: 'cta-chest-pe-with-prior',
    current: {
      desc: 'CTA CHEST PULMONARY EMBOLISM',
      modality: CT,
      date: '20261104',
      series: [
        { d: 'AX SOFT 1mm', k: 'STANDARD' },
        { d: 'AX LUNG 1mm', k: 'LUNG' },
        { d: 'COR SOFT 2mm', k: 'STANDARD' },
        { d: 'SAG SOFT 2mm', k: 'STANDARD' },
        { d: 'AX MIP 10mm', k: 'STANDARD' },
      ],
    },
    prior: {
      desc: 'CTA CHEST PULMONARY EMBOLISM',
      modality: CT,
      date: '20250805',
      series: [
        { d: 'AX SOFT 1mm', k: 'STANDARD' },
        { d: 'AX LUNG 1mm', k: 'LUNG' },
      ],
    },
  },
  {
    name: 'cta-runoff-no-prior',
    current: {
      desc: 'CTA RUNOFF LOWER EXTREMITY',
      modality: CT,
      date: '20261104',
      series: [
        { d: 'AX ANGIO 1mm', k: 'STANDARD' },
        { d: 'COR ANGIO 2mm', k: 'STANDARD' },
        { d: 'SAG ANGIO 2mm', k: 'STANDARD' },
        { d: 'COR MIP 10mm', k: 'STANDARD' },
        { d: 'SAG MIP 10mm', k: 'STANDARD' },
        { d: 'AX MIP 10mm', k: 'STANDARD' },
      ],
    },
  },
  {
    name: 'cta-aorta-abd-pelvis-no-prior',
    current: {
      desc: 'CTA AORTA ABDOMEN PELVIS',
      modality: CT,
      date: '20261104',
      series: [
        { d: 'AX ARTERIAL 1mm', k: 'STANDARD' },
        { d: 'COR ARTERIAL 2mm', k: 'STANDARD' },
        { d: 'SAG ARTERIAL 2mm', k: 'STANDARD' },
        { d: 'AX ARTERIAL BONE 1mm', k: 'BONE' },
        { d: 'AX NON CON 5mm', k: 'STANDARD' },
        { d: 'AX ARTERIAL MIP 10.0', k: 'STANDARD' },
      ],
    },
  },
  {
    name: 'ct-perfusion-no-prior',
    current: {
      desc: 'CT PERFUSION HEAD',
      modality: CT,
      date: '20261105',
      series: [
        { d: 'RAPID Mismatch', n: 6, p: 'RGB' },
        { d: 'RAPID CBF Parameter', n: 12, p: 'RGB' },
        { d: 'RAPID CBV Parameter', n: 12, p: 'RGB' },
        { d: 'RAPID Tmax Parameter', n: 12, p: 'RGB' },
        { d: 'RAPID Summary', n: 4, p: 'RGB' },
        { d: 'PERFUSION 4D SOURCE', n: 240, dyn: true },
      ],
    },
  },
  {
    name: 'ct-lumbar-spine-with-cervical-sibling-and-prior',
    current: {
      desc: 'CT LUMBAR SPINE WITHOUT CONTRAST',
      modality: CT,
      date: '20261105',
      series: [
        { d: 'SAG BONE 2mm', k: 'BONE' },
        { d: 'AX BONE 2mm', k: 'BONE' },
        { d: 'COR BONE 2mm', k: 'BONE' },
        { d: 'SAG SOFT 2mm', k: 'STANDARD' },
        { d: 'AX SOFT 2mm', k: 'STANDARD' },
      ],
    },
    sibling: {
      desc: 'CT CERVICAL SPINE WITHOUT CONTRAST',
      modality: CT,
      date: '20261105',
      series: [
        { d: 'SAG BONE 1mm', k: 'BONE' },
        { d: 'AX BONE 1mm', k: 'BONE' },
        { d: 'COR BONE 1mm', k: 'BONE' },
      ],
    },
    prior: {
      desc: 'CT LUMBAR SPINE WITHOUT CONTRAST',
      modality: CT,
      date: '20231201',
      series: [
        { d: 'SAG BONE 2mm', k: 'BONE' },
        { d: 'AX BONE 2mm', k: 'BONE' },
      ],
    },
  },
  {
    name: 'mr-lumbar-spine-with-prior',
    current: {
      desc: 'MRI LUMBAR SPINE WITHOUT CONTRAST',
      modality: MR,
      date: '20261106',
      series: [
        { d: 'SAG T2 TSE', n: 15 },
        { d: 'SAG T1 TSE', n: 15 },
        { d: 'SAG STIR', n: 15 },
        { d: 'AX T2 TSE', n: 30 },
        { d: 'AX T2 MSMA disc', n: 20 },
      ],
    },
    prior: {
      desc: 'MRI LUMBAR SPINE WITHOUT CONTRAST',
      modality: MR,
      date: '20240406',
      series: [
        { d: 'SAG T2 TSE', n: 15 },
        { d: 'AX T2 TSE', n: 30 },
      ],
    },
  },
  {
    name: 'mr-brain-with-prior',
    current: {
      desc: 'MRI BRAIN WITH AND WITHOUT CONTRAST',
      modality: MR,
      date: '20261106',
      series: [
        { d: 'AX T1 SE', n: 24 },
        { d: 'AX T2 TSE', n: 24 },
        { d: 'AX FLAIR', n: 24 },
        { d: 'AX DWI TRACE', n: 24 },
        { d: 'AX ADC', n: 24 },
        { d: 'AX SWI', n: 48 },
        { d: 'AX T1 POST', n: 24 },
        { d: 'COR T1 POST', n: 24 },
        { d: 'SAG T1 MPRAGE POST', n: 176 },
      ],
    },
    prior: {
      desc: 'MRI BRAIN WITH AND WITHOUT CONTRAST',
      modality: MR,
      date: '20250506',
      series: [
        { d: 'AX T2 TSE', n: 24 },
        { d: 'AX FLAIR', n: 24 },
        { d: 'AX T1 POST', n: 24 },
      ],
    },
  },
  {
    name: 'mr-abdomen-mrcp-no-prior',
    current: {
      desc: 'MRI ABDOMEN MRCP WITH AND WITHOUT CONTRAST',
      modality: MR,
      date: '20261107',
      series: [
        { d: 'COR T2 HASTE', n: 30 },
        { d: 'AX T2 HASTE FS', n: 30 },
        { d: 'AX T1 DIXON IN', n: 60 },
        { d: 'AX T1 DIXON OPP', n: 60 },
        { d: 'AX DWI b800', n: 30 },
        { d: 'AX ADC', n: 30 },
        { d: 'COR MRCP 3D', n: 80 },
        { d: 'AX T1 VIBE POST', n: 72 },
      ],
    },
  },
  {
    name: 'ct-abdomen-generic-with-prior',
    current: {
      desc: 'CT ABDOMEN PELVIS WITH CONTRAST',
      modality: CT,
      date: '20261107',
      series: [
        { d: 'AX VENOUS 3mm', k: 'STANDARD' },
        { d: 'COR VENOUS 3mm', k: 'STANDARD' },
        { d: 'SAG VENOUS 3mm', k: 'STANDARD' },
      ],
    },
    prior: {
      desc: 'CT ABDOMEN PELVIS WITH CONTRAST',
      modality: CT,
      date: '20250707',
      series: [
        { d: 'AX VENOUS 3mm', k: 'STANDARD' },
        { d: 'COR VENOUS 3mm', k: 'STANDARD' },
      ],
    },
  },
  {
    name: 'mr-knee-generic-with-prior',
    current: {
      desc: 'MRI KNEE WITHOUT CONTRAST',
      modality: MR,
      date: '20261107',
      series: [
        { d: 'SAG PD FS', n: 30 },
        { d: 'COR PD FS', n: 30 },
        { d: 'AX PD FS', n: 30 },
        { d: 'SAG T1', n: 30 },
      ],
    },
    prior: {
      desc: 'MRI KNEE WITHOUT CONTRAST',
      modality: MR,
      date: '20240808',
      series: [
        { d: 'SAG PD FS', n: 30 },
        { d: 'COR PD FS', n: 30 },
      ],
    },
  },
  {
    name: 'cr-chest-two-views-with-prior',
    current: {
      desc: 'XR CHEST 2 VIEWS',
      modality: 'CR',
      date: '20261108',
      series: [
        { d: 'CHEST PA', n: 1 },
        { d: 'CHEST LAT', n: 1 },
      ],
    },
    prior: {
      desc: 'XR CHEST 2 VIEWS',
      modality: 'CR',
      date: '20250908',
      series: [
        { d: 'CHEST PA', n: 1 },
        { d: 'CHEST LAT', n: 1 },
      ],
    },
  },
  {
    name: 'dx-chest-with-text-report',
    current: {
      desc: 'XR CHEST 1 VIEW',
      modality: 'DX',
      date: '20261108',
      series: [
        { d: 'CHEST AP PORTABLE', n: 1 },
        { d: 'Report', n: 1, m: 'SR' },
      ],
    },
  },
  {
    name: 'us-abdomen-no-protocol',
    current: {
      desc: 'US ABDOMEN COMPLETE',
      modality: 'US',
      date: '20261108',
      series: [{ d: 'ABDOMEN', n: 40 }],
    },
  },
];

type StageRecord = {
  index: number;
  id: string;
  name: string;
  status: string;
  grid?: string;
  viewports?: Array<{ ds: string[]; voi?: string }>;
};

/** The short name a display set has in the record (study tag + series number). */
function dsName(uid: string, names: Map<string, string>): string {
  return names.get(uid) ?? `?${uid}`;
}

function recordHang(hps: any, names: Map<string, string>, withStages: boolean) {
  const active = hps.getActiveProtocol();
  const protocol = active.protocol;
  if (!protocol) {
    return { protocol: null };
  }
  const opening = { index: active.stageIndex, id: active.stage?.id ?? null };
  if (!withStages) {
    return { protocol: protocol.id, opening };
  }
  const stages: StageRecord[] = protocol.stages.map((stage: any, index: number) => ({
    index,
    id: stage.id,
    name: stage.name,
    status: stage.status,
  }));
  for (const rec of stages) {
    if (rec.status === 'disabled') {
      continue;
    }
    try {
      hps.setProtocol(protocol.id, { stageIndex: rec.index });
    } catch (e) {
      rec.status = `error: ${String((e as Error)?.message ?? e).slice(0, 80)}`;
      continue;
    }
    const now = hps.getActiveProtocol();
    const props = now.stage?.viewportStructure?.properties ?? {};
    rec.grid = `${props.rows ?? '?'}x${props.columns ?? '?'}`;
    // Each viewport: its display sets, the window preset its stage gives them
    // (`options.voi`), and the scroll-sync links its stage sets.
    const defs = now.stage?.viewports ?? [];
    rec.viewports = [...(now.viewportMatchDetails?.values?.() ?? [])].map((v: any, i: number) => {
      const infos = v.displaySetsInfo ?? [];
      const opts = infos[0]?.displaySetOptions ?? {};
      const voi = opts?.options?.voi ?? opts?.voi;
      const sync = (
        v.viewportOptions?.syncGroups ??
        defs[i]?.viewportOptions?.syncGroups ??
        []
      ).map((g: any) => `${g.type}:${g.id}`);
      return {
        ds: infos.map((x: any) => dsName(x.displaySetInstanceUID, names)),
        ...(voi ? { voi: `${voi.windowWidth}/${voi.windowCenter}` } : {}),
        ...(sync.length ? { sync } : {}),
      };
    });
  }
  // Back to the opening stage, as the viewer leaves it.
  try {
    hps.setProtocol(protocol.id, { stageIndex: opening.index });
  } catch (_) {
    /* recorded above */
  }
  return { protocol: protocol.id, opening, stages };
}

function hangScenario(sc: Scenario) {
  clearComparisonRoles();
  setBrowsingMode('append');
  const current = makeStudy(sc.current, 'current');
  const prior = sc.prior ? makeStudy(sc.prior, 'prior') : null;
  const sibling = sc.sibling ? makeStudy(sc.sibling, 'sibling') : null;
  const names = new Map<string, string>();
  for (const [tag, s] of [
    ['current', current],
    ['prior', prior],
    ['sibling', sibling],
  ] as const) {
    s?.displaySets.forEach((ds, i) => names.set(ds.displaySetInstanceUID, `${tag}#${i + 1}`));
  }

  let active: DS[] = [...current.displaySets];
  const hps: any = newService(() => active);

  // 1. The first hang: the current study alone, auto-matched.
  hps.run({ studies: [current.study], displaySets: active, activeStudy: current.study });
  const first = recordHang(hps, names, true);
  const matched = first.protocol;

  // 2. The comparison loaded: roles, composites, the matched protocol again over every study.
  setComparisonRoles({
    priors: prior ? [prior.study.StudyInstanceUID] : [],
    siblings: sibling ? [sibling.study.StudyInstanceUID] : [],
  });
  const loaded = [current, prior, sibling].filter(Boolean) as Array<{
    study: Study;
    displaySets: DS[];
  }>;
  active = loaded.flatMap(s => s.displaySets);
  for (const s of loaded) {
    const composite = compositeOf(s.study, s.displaySets);
    if (composite) {
      names.set(
        composite.displaySetInstanceUID,
        `${names.get(s.displaySets[0].displaySetInstanceUID)?.split('#')[0]}#allinone`
      );
      active.push(composite);
    }
  }
  const studies = loaded.map(s => s.study);
  const runMode = (mode: BrowsingMode) => {
    setBrowsingMode(mode);
    hps.run(
      { studies, displaySets: active, activeStudy: current.study },
      protocolIdForMode(mode, matched ?? undefined) ?? matched
    );
    return recordHang(hps, names, true);
  };
  const afterLoad = runMode('append');
  const browsing = {
    current: runMode('current'),
    allinone: runMode('allinone'),
    manual: runMode('manual'),
  };
  setBrowsingMode('append');
  clearComparisonRoles();
  return { first, afterLoad, browsing };
}

describe('the existing auto-hanging (milestone 7 regression fixtures)', () => {
  const results: Record<string, unknown> = {};
  for (const sc of SCENARIOS) {
    results[sc.name] = hangScenario(sc);
  }

  it('offers the sixteen compare protocols, the all-in-one and the default', () => {
    const ids = modeProtocolIds();
    expect(ids.filter(id => id.startsWith('@pacsai/compare'))).toHaveLength(16);
    expect(ids).toContain('@pacsai/allInOne');
    expect(ids).toContain('default');
  });

  it('auto-matches each of the sixteen in at least one fixture', () => {
    const matched = new Set(Object.values(results).map((r: any) => r.first.protocol as string));
    const compare = modeProtocolIds().filter(id => id.startsWith('@pacsai/compare'));
    expect(compare.filter(id => !matched.has(id))).toEqual([]);
  });

  it('hangs every fixture as it did before milestone 7', () => {
    if (process.env.UPDATE_HANGING_BASELINE === '1') {
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(results, null, 2) + '\n');
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    expect(Object.keys(results).sort()).toEqual(Object.keys(baseline).sort());
    for (const name of Object.keys(baseline)) {
      expect({ [name]: results[name] }).toEqual({ [name]: baseline[name] });
    }
  });
});
