/**
 * Rev 11 milestone 7, PR 3 (N06: "late arrivals do not unexpectedly reshuffle
 * the active reading layout"; docs/12 §6: "late arrivals do not rehang after
 * interaction; explicit Update layout works"), through OHIF's own
 * HangingProtocolService with the modes' protocols (the regression fixtures'
 * harness). A case is hung as the route hangs it (the current study); then its
 * comparison arrives and the prior loader's re-hang is replayed as
 * loadRelevantPriors does it, through the gate (lateArrivals.ts holdOrRun).
 * The latch watches the service itself: each run notes the images it hung.
 * Every study, series and description here is made up.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- drives OHIF's untyped hanging internals */
const mockStudies: Record<string, unknown> = {};
jest.mock('@ohif/core', () => ({
  classes: {},
  DicomMetadataStore: { getStudy: (uid: string) => mockStudies[uid] },
}));

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
import { setBrowsingMode } from '../allinone/browsingMode';
// eslint-disable-next-line import/first
import { rehangCase } from '../allinone/rehang';
// eslint-disable-next-line import/first
import { applyRehangLayout, caseUpdateKind, noteCaseSite, planCaseRehang } from './caseHanging';
// eslint-disable-next-line import/first
import { presetFromImages, studyTypeOf, type HangingPreset } from './hangingPresets';
// eslint-disable-next-line import/first
import { loadHangingPresets, startHangingCase, suspendHangingPresets } from './presetStore';
// eslint-disable-next-line import/first
import {
  holdOrRun,
  latchInteraction,
  lateCaseEntered,
  lateCaseLeft,
  lateCounts,
  lateView,
  newImagesSinceHang,
  updateLayout,
} from './lateArrivals';

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

type Shown = { protocol: string; stageIndex: number; viewports: string[][] };

/** The layout on screen: the protocol, its layout and each viewport's series. */
function shown(hps: any): Shown {
  const a = hps.getActiveProtocol();
  const viewports = [...(a.viewportMatchDetails?.values?.() ?? [])].map((d: any) =>
    (d?.displaySetsInfo ?? []).map((i: any) => i.displaySetInstanceUID)
  );
  return { protocol: a.protocol?.id, stageIndex: a.stageIndex, viewports };
}
const showsPrior = (s: Shown) => s.viewports.flat().some(uid => uid.startsWith('9.9.study.prior'));

/**
 * A case in the reading window (`on`): the route's first hang over the current
 * study, the latch watching the service. `arrive` loads the comparison (its
 * all-in-one composites built, data only); `rehang` is the loader's re-hang
 * through the gate.
 */
function openCase(current: StudySpec, prior: StudySpec | null, { on = true } = {}) {
  clearComparisonRoles();
  const cur = makeStudy(current, 'current');
  const pri = prior ? makeStudy(prior, 'prior') : null;
  mockStudies[cur.study.StudyInstanceUID] = cur.study;
  if (pri) {
    mockStudies[pri.study.StudyInstanceUID] = pri.study;
  }
  let active: DS[] = [...cur.displaySets];
  const hps: any = newService(() => active);
  const displaySetService = { getActiveDisplaySets: () => active };
  lateCaseEntered(on, { hangingProtocolService: hps, displaySetService });
  hps.run({ studies: [cur.study], displaySets: active, activeStudy: cur.study });
  const site = hps.getActiveProtocol().protocol;
  noteCaseSite(cur.study.StudyInstanceUID, site);
  setComparisonRoles({ priors: pri ? [pri.study.StudyInstanceUID] : [], siblings: [] });
  const loaded = [cur, pri].filter(Boolean) as Array<{ study: any; displaySets: DS[] }>;
  const arrive = () => {
    active = loaded.flatMap(s => s.displaySets);
    for (const s of loaded) {
      const composite = compositeOf(s.study, s.displaySets);
      if (composite) {
        active.push(composite);
      }
    }
  };
  const rehang = () =>
    holdOrRun({
      kind: () =>
        caseUpdateKind(
          hps,
          site,
          cur.study.StudyInstanceUID,
          active,
          cur.study,
          newImagesSinceHang(active)
        ),
      run: () => {
        const plan = planCaseRehang(hps, site, cur.study.StudyInstanceUID, active, cur.study);
        hps.run(
          { studies: loaded.map(s => s.study), displaySets: active, activeStudy: cur.study },
          plan.runId
        );
        applyRehangLayout(hps, plan);
      },
    });
  return {
    hps,
    site,
    arrive,
    rehang,
    services: { services: { hangingProtocolService: hps, displaySetService } },
  };
}

/** The reader's presets as the app answers them (the reading window reads them). */
async function presetsAre(
  entries: Record<string, { revision: number; preset: HangingPreset | null }>
) {
  const hanging = Object.fromEntries(
    Object.entries(entries).map(([k, e]) => [k, { ...e, at: '2026-11-09T09:00:00.000Z' }])
  );
  await loadHangingPresets(
    (async () =>
      ({ ok: true, status: 200, json: async () => ({ data: { hanging } }) }) as Response) as never
  );
}

/** What the untouched case ends up showing once its comparison is hung. */
function untouchedResult(): Shown {
  const c = openCase(CHEST, CHEST_PRIOR);
  c.arrive();
  c.rehang();
  return shown(c.hps);
}

beforeEach(async () => {
  setBrowsingMode('append');
  startHangingCase();
  await presetsAre({});
});
afterEach(() => {
  lateCaseLeft();
  suspendHangingPresets();
  setBrowsingMode('append');
  clearComparisonRoles();
});

describe('late arrivals through OHIF’s hanging service (milestone 7, PR 3)', () => {
  it('untouched, the comparison that arrives is hung, as before: late metadata may still improve the hanging', () => {
    const c = openCase(CHEST, CHEST_PRIOR);
    const first = shown(c.hps);
    expect(showsPrior(first)).toBe(false);
    c.arrive();
    expect(c.rehang()).toBe('ran');
    const after = shown(c.hps);
    expect(after.protocol).toBe('@pacsai/compareCTChest');
    expect(showsPrior(after)).toBe(true);
    expect(lateView().held).toBeNull();
  });

  it('once the reader has worked the images, the comparison does not move the layout; Update layout hangs it', () => {
    const expected = untouchedResult();
    const c = openCase(CHEST, CHEST_PRIOR);
    const first = shown(c.hps);
    latchInteraction('scroll');
    c.arrive();
    const changesBefore = lateCounts().protocolChanges;
    expect(c.rehang()).toBe('held');
    // The layout on screen is the one the reader was working: protocol, layout, every viewport's series.
    expect(shown(c.hps)).toEqual(first);
    expect(lateCounts().protocolChanges).toBe(changesBefore);
    expect(lateView()).toEqual({ latched: true, held: { kind: 'images', label: null } });
    expect(updateLayout()).toBe(true);
    expect(shown(c.hps)).toEqual(expected);
    expect(showsPrior(shown(c.hps))).toBe(true);
    expect(lateView().held).toBeNull();
  });

  it('latched after the comparison loaded but before its re-hang (the presets read), it is still news', () => {
    const c = openCase(CHEST, CHEST_PRIOR);
    const first = shown(c.hps);
    c.arrive();
    latchInteraction('keys');
    expect(c.rehang()).toBe('held');
    expect(shown(c.hps)).toEqual(first);
    expect(lateView().held?.kind).toBe('images');
  });

  it('outside the reading window nothing waits: the comparison is hung as before', () => {
    const c = openCase(CHEST, CHEST_PRIOR, { on: false });
    latchInteraction('scroll');
    c.arrive();
    expect(c.rehang()).toBe('ran');
    expect(showsPrior(shown(c.hps))).toBe(true);
  });

  it("no comparison and only the reader's layout waiting: offered as theirs, put up by Update layout", async () => {
    const probe = openCase(CHEST, null);
    // Another layout the case can fill than the one it opens on (without a
    // prior the compare protocol opens past its comparison layouts).
    const opening = probe.hps.getActiveProtocol().stageIndex;
    const statuses = probe.hps.getActiveProtocol().protocol.stages.map((s: any) => s.status);
    const target = statuses.findIndex((s: string, i: number) => s === 'enabled' && i !== opening);
    expect(target).toBeGreaterThan(-1);
    const type = studyTypeOf({
      siteProtocol: probe.site,
      modality: 'CT',
      description: CHEST.desc,
    })!;
    const preset = presetFromImages({
      type,
      protocol: probe.hps.getActiveProtocol().protocol,
      stageIndex: target,
      browsing: 'append',
    })!;
    await presetsAre({ [type.key]: { revision: 1, preset } });
    const c = openCase(CHEST, null);
    const first = shown(c.hps);
    latchInteraction('images');
    c.arrive(); // the current study's composite only: no images new
    expect(c.rehang()).toBe('held');
    expect(shown(c.hps)).toEqual(first);
    expect(lateView().held).toEqual({ kind: 'layout', label: type.label });
    updateLayout();
    expect(shown(c.hps).stageIndex).toBe(target);
  });

  it('nothing new and no other layout: the held re-hang goes, nothing offered, nothing moved', () => {
    const c = openCase(CHEST, null);
    const first = shown(c.hps);
    latchInteraction('images');
    c.arrive();
    expect(c.rehang()).toBe('dropped');
    expect(shown(c.hps)).toEqual(first);
    expect(lateView().held).toBeNull();
  });

  it("the all-in-one refresh's re-hang (rehangCase) is the case's plan: the reader's layout stays put", async () => {
    // The reader's layout for the study type, applied at the loader's re-hang.
    const probe = openCase(CHEST, CHEST_PRIOR);
    probe.arrive();
    probe.rehang();
    const statuses = probe.hps.getActiveProtocol().protocol.stages.map((s: any) => s.status);
    const target = statuses.findIndex(
      (s: string, i: number) => s === 'enabled' && i !== probe.hps.getActiveProtocol().stageIndex
    );
    expect(target).toBeGreaterThan(-1);
    const type = studyTypeOf({
      siteProtocol: probe.site,
      modality: 'CT',
      description: CHEST.desc,
    })!;
    const preset = presetFromImages({
      type,
      protocol: probe.hps.getActiveProtocol().protocol,
      stageIndex: target,
      browsing: 'append',
    })!;
    await presetsAre({ [type.key]: { revision: 1, preset } });
    const c = openCase(CHEST, CHEST_PRIOR);
    c.arrive();
    c.rehang();
    expect(shown(c.hps).stageIndex).toBe(target);
    // A late series grows a composite; the refresh re-hangs, untouched: still the reader's layout.
    rehangCase(c.services);
    expect(shown(c.hps).stageIndex).toBe(target);
    expect(shown(c.hps).protocol).toBe(probe.site.id);
  });
});
