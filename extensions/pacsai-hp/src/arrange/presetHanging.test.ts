/**
 * Rev 11 milestone 7, PR 2 (N06): the reader's preset at a case's re-hang,
 * through OHIF's own HangingProtocolService with the modes' protocols and the
 * viewer's custom attributes (the regression fixtures' harness). The re-hang
 * is replayed as loadRelevantPriors does it: the first hang auto-matched over
 * the current study, then the comparison loaded and the plan run
 * (caseHanging.ts planCaseRehang, run, applyRehangLayout).
 *
 * "Existing auto-hang behavior and compatible fallback remain correct": with
 * the presets off the re-hang is the site's, the protocol id as before; a
 * preset's layout the case cannot fill leaves the protocol's opening layout; a
 * preset whose protocol does not match the case leaves the site protocol.
 * Every study, series and description here is made up.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- drives OHIF's untyped hanging internals */
jest.mock('@ohif/core', () => ({ classes: {} }));

// eslint-disable-next-line import/first
import {
  compositeOf,
  makeStudy,
  newService,
  type DS,
  type StudySpec,
} from '../protocols/__fixtures__/hangingHarness';
// eslint-disable-next-line import/first
import { clearComparisonRoles, setComparisonRoles } from '../priors/roleRegistry';
// eslint-disable-next-line import/first
import {
  getBrowsingMode,
  protocolIdForMode,
  setBrowsingMode,
  storedBrowsingMode,
} from '../allinone/browsingMode';
// eslint-disable-next-line import/first
import { applyRehangLayout, planCaseRehang } from './caseHanging';
// eslint-disable-next-line import/first
import { presetFromImages, studyTypeOf, type HangingPreset } from './hangingPresets';
// eslint-disable-next-line import/first
import {
  caseApplied,
  loadHangingPresets,
  markCaseChoice,
  startHangingCase,
  suspendHangingPresets,
} from './presetStore';

const CHEST: StudySpec = {
  desc: 'CT CHEST WITH CONTRAST',
  modality: 'CT',
  date: '20261101',
  series: [
    { d: 'Topogram 0.6 T20f', n: 1, k: 'T20f' },
    { d: 'AX LUNG 1.25mm', k: 'LUNG' },
    { d: 'AX SOFT 2.5mm', k: 'STANDARD' },
    { d: 'COR SOFT 3mm', k: 'STANDARD' },
    { d: 'SAG SOFT 3mm', k: 'STANDARD' },
    { d: 'AX MIP 10mm', k: 'STANDARD' },
  ],
};
/** The same exam without its coronal and sagittal reformats. */
const CHEST_NO_REFORMATS: StudySpec = {
  ...CHEST,
  series: CHEST.series.filter(s => !/^(COR|SAG)/.test(s.d)),
};
const CHEST_PRIOR: StudySpec = {
  desc: 'CT CHEST WITHOUT CONTRAST',
  modality: 'CT',
  date: '20250301',
  series: [
    { d: 'AX LUNG 1.25mm', k: 'LUNG' },
    { d: 'AX SOFT 2.5mm', k: 'STANDARD' },
    { d: 'COR SOFT 3mm', k: 'STANDARD' },
  ],
};

/** The first hang, then the comparison loaded and the case's re-hang, as loadRelevantPriors does it. */
function hangCase(current: StudySpec, prior: StudySpec | null) {
  clearComparisonRoles();
  const cur = makeStudy(current, 'current');
  const pri = prior ? makeStudy(prior, 'prior') : null;
  let active: DS[] = [...cur.displaySets];
  const hps: any = newService(() => active);
  hps.run({ studies: [cur.study], displaySets: active, activeStudy: cur.study });
  const site = hps.getActiveProtocol().protocol;
  setComparisonRoles({ priors: pri ? [pri.study.StudyInstanceUID] : [], siblings: [] });
  const loaded = [cur, pri].filter(Boolean) as Array<{ study: any; displaySets: DS[] }>;
  active = loaded.flatMap(s => s.displaySets);
  for (const s of loaded) {
    const composite = compositeOf(s.study, s.displaySets);
    if (composite) {
      active.push(composite);
    }
  }
  const studies = loaded.map(s => s.study);
  const rehang = planCaseRehang(hps, site, cur.study.StudyInstanceUID, active, cur.study);
  hps.run({ studies, displaySets: active, activeStudy: cur.study }, rehang.runId);
  applyRehangLayout(hps, rehang);
  const now = hps.getActiveProtocol();
  return {
    hps,
    site,
    rehang,
    protocol: now.protocol,
    stageIndex: now.stageIndex as number,
    statuses: (now.protocol?.stages ?? []).map((s: any) => s.status),
  };
}

/** The reader's presets as the app answers them. */
async function presetsAre(
  entries: Record<string, { revision: number; preset: HangingPreset | null }>
) {
  const hanging = Object.fromEntries(
    Object.entries(entries).map(([k, e]) => [k, { ...e, at: '2026-11-08T14:00:00.000Z' }])
  );
  await loadHangingPresets(
    (async () =>
      ({ ok: true, status: 200, json: async () => ({ data: { hanging } }) }) as Response) as never
  );
}

beforeEach(() => {
  setBrowsingMode('append');
  startHangingCase();
});
afterEach(() => {
  suspendHangingPresets();
  setBrowsingMode('append');
  clearComparisonRoles();
});

describe("the reader's preset at a case's re-hang (milestone 7, PR 2, through OHIF's hanging service)", () => {
  it("presets off (outside the reading window): the site's protocol, as before; nothing noted", () => {
    const h = hangCase(CHEST, CHEST_PRIOR);
    expect(h.site.id).toBe('@pacsai/compareCTChest');
    expect(h.rehang.runId).toBe(protocolIdForMode('append', h.site.id) ?? h.site.id);
    expect(h.rehang.plan.source).toBe('site');
    expect(h.protocol.id).toBe(h.site.id);
    expect(caseApplied()).toBeNull();
  });

  it("the reader's layout for the study type is put up once its protocol has run", async () => {
    // Find a layout of the site protocol other than its opening one.
    const off = hangCase(CHEST, CHEST_PRIOR);
    const target = off.statuses.findIndex(
      (s: string, i: number) => s === 'enabled' && i !== off.stageIndex
    );
    expect(target).toBeGreaterThan(-1);
    const type = studyTypeOf({ siteProtocol: off.site, modality: 'CT', description: CHEST.desc });
    const preset = presetFromImages({
      type: type!,
      protocol: off.protocol,
      stageIndex: target,
      browsing: 'append',
    })!;
    await presetsAre({ [type!.key]: { revision: 1, preset } });
    const h = hangCase(CHEST, CHEST_PRIOR);
    expect(h.rehang.plan.source).toBe('preset');
    expect(h.protocol.id).toBe('@pacsai/compareCTChest');
    expect(h.stageIndex).toBe(target);
    expect(caseApplied()).toEqual({
      source: 'preset',
      skipped: null,
      layout: 'shown',
      missingLayout: null,
    });
  });

  it("a layout the case cannot fill (a series missing): the protocol's opening layout stands, said so", async () => {
    const full = hangCase(CHEST, CHEST_PRIOR);
    const reduced = hangCase(CHEST_NO_REFORMATS, CHEST_PRIOR);
    // A layout the full case fills and the one without reformats cannot.
    const target = full.statuses.findIndex(
      (s: string, i: number) => s === 'enabled' && reduced.statuses[i] === 'disabled'
    );
    expect(target).toBeGreaterThan(-1);
    const type = studyTypeOf({ siteProtocol: full.site, modality: 'CT', description: CHEST.desc })!;
    const preset = presetFromImages({
      type,
      protocol: full.protocol,
      stageIndex: target,
      browsing: 'append',
    })!;
    await presetsAre({ [type.key]: { revision: 1, preset } });
    const h = hangCase(CHEST_NO_REFORMATS, CHEST_PRIOR);
    expect(h.protocol.id).toBe('@pacsai/compareCTChest');
    expect(h.stageIndex).toBe(reduced.stageIndex);
    expect(h.statuses[h.stageIndex]).not.toBe('disabled');
    expect(caseApplied()).toMatchObject({
      source: 'preset',
      layout: 'fallback',
      missingLayout: preset.stageName,
    });
  });

  it("a preset whose protocol does not match the case: the site's protocol (the compatible fallback)", async () => {
    const off = hangCase(CHEST, CHEST_PRIOR);
    const type = studyTypeOf({ siteProtocol: off.site, modality: 'CT', description: CHEST.desc })!;
    const preset: HangingPreset = {
      ...presetFromImages({ type, protocol: off.protocol, stageIndex: 0, browsing: 'append' })!,
      protocolId: '@pacsai/compareCTHead',
    };
    await presetsAre({ [type.key]: { revision: 1, preset } });
    const h = hangCase(CHEST, CHEST_PRIOR);
    expect(h.rehang.plan).toMatchObject({ source: 'site', skipped: 'not-eligible' });
    expect(h.protocol.id).toBe('@pacsai/compareCTChest');
    expect(h.stageIndex).toBe(off.stageIndex);
  });

  it('"current only": the prior is loaded but not hung, for this case; the stored mode is untouched', async () => {
    const off = hangCase(CHEST, CHEST_PRIOR);
    const type = studyTypeOf({ siteProtocol: off.site, modality: 'CT', description: CHEST.desc })!;
    const preset = presetFromImages({
      type,
      protocol: off.protocol,
      stageIndex: off.stageIndex,
      browsing: 'current',
    })!;
    await presetsAre({
      [type.key]: { revision: 1, preset: { ...preset, stageId: null, stageName: null } },
    });
    const h = hangCase(CHEST, CHEST_PRIOR);
    expect(getBrowsingMode()).toBe('current');
    expect(storedBrowsingMode()).toBe('append');
    // The comparison stages need the prior's role: none of them is the one opened.
    const opened = h.protocol.stages[h.stageIndex];
    expect(JSON.stringify(opened.viewports ?? [])).not.toMatch(/prior/i);
  });

  it("a choice made in this case wins: the site's protocol in the mode in use", async () => {
    const off = hangCase(CHEST, CHEST_PRIOR);
    const target = off.statuses.findIndex(
      (s: string, i: number) => s === 'enabled' && i !== off.stageIndex
    );
    const type = studyTypeOf({ siteProtocol: off.site, modality: 'CT', description: CHEST.desc })!;
    const preset = presetFromImages({
      type,
      protocol: off.protocol,
      stageIndex: target,
      browsing: 'append',
    })!;
    await presetsAre({ [type.key]: { revision: 1, preset } });
    markCaseChoice();
    const h = hangCase(CHEST, CHEST_PRIOR);
    expect(h.rehang.plan).toMatchObject({ source: 'case', skipped: 'case-choice' });
    expect(h.stageIndex).toBe(off.stageIndex);
  });

  it("another study type's preset leaves this case to the site", async () => {
    await presetsAre({
      'v1|CT|@pacsai/compareCTHead': {
        revision: 1,
        preset: {
          v: 1,
          label: 'CT Head',
          protocolId: '@pacsai/compareCTHead',
          protocolRevision: 'abcd1234',
          stageId: null,
          stageName: null,
          browsing: 'current',
          summary: 'CT Head Compare · current only',
        },
      },
    });
    const h = hangCase(CHEST, CHEST_PRIOR);
    expect(h.rehang.plan.source).toBe('site');
    expect(h.protocol.id).toBe('@pacsai/compareCTChest');
    expect(getBrowsingMode()).toBe('append');
  });
});
