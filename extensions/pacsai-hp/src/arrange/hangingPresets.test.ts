/**
 * Rev 11 milestone 7, PR 2 (N06): the study type, the preset made from the
 * images on screen, where its layout is, and the precedence at a re-hang.
 * Every study, series and description here is made up.
 */
import {
  caseFacts,
  GENERIC_PROTOCOLS,
  planCase,
  presetFromImages,
  presetStageIndex,
  procedurePart,
  protocolRevision,
  readEntries,
  readPreset,
  showsPreset,
  studyTypeOf,
  type HangingPreset,
} from './hangingPresets';

const CTA = {
  id: '@pacsai/compareCTA',
  name: 'CTA Head/Neck Compare',
  stages: [
    { id: 'cta-src-0-cp', name: 'CTA Source axial (head + neck)', status: 'enabled' },
    { id: 'cta-mip-1-cp', name: 'CTA Head MIP (ax + cor + sag)', status: 'enabled' },
    { id: 'current-only-0', name: 'Current', status: 'enabled' },
    { id: 'current-only-1', name: 'Current', status: 'enabled' },
    { id: 'cta-cpr-2-cp', name: 'CPR carotids', status: 'disabled' },
  ],
};
const GENERIC_CT = {
  id: '@pacsai/compareCT',
  name: 'CT Compare',
  stages: [
    { id: 'g0', name: 'Axial', status: 'enabled' },
    { id: 'g1', name: 'Coronal', status: 'enabled' },
  ],
};

describe('the study type (milestone 7, PR 2)', () => {
  it('an exam-specific protocol is the type: modality and protocol, named without "Compare"', () => {
    expect(
      studyTypeOf({ siteProtocol: CTA, modality: 'ct', description: 'CTA HEAD AND NECK' })
    ).toEqual({
      key: 'v1|CT|@pacsai/compareCTA',
      label: 'CTA Head/Neck',
      generic: false,
    });
    // Another procedure the same protocol takes is the same type.
    expect(studyTypeOf({ siteProtocol: CTA, modality: 'CT', description: 'CTA NECK' })?.key).toBe(
      'v1|CT|@pacsai/compareCTA'
    );
  });

  it('a generic protocol adds the procedure, whole: one save never reaches every CT', () => {
    expect([...GENERIC_PROTOCOLS].sort()).toEqual([
      '@pacsai/compareCR',
      '@pacsai/compareCT',
      '@pacsai/compareMR',
    ]);
    const abd = studyTypeOf({
      siteProtocol: GENERIC_CT,
      modality: 'CT',
      description: 'ct abdomen/pelvis w contrast',
    });
    const ext = studyTypeOf({
      siteProtocol: GENERIC_CT,
      modality: 'CT',
      description: 'CT LOWER EXTREMITY',
    });
    expect(abd).toEqual({
      key: 'v1|CT|@pacsai/compareCT|CT ABDOMEN/PELVIS W CONTRAST',
      label: 'CT ABDOMEN/PELVIS W CONTRAST',
      generic: true,
    });
    expect(ext?.key).not.toBe(abd?.key);
    // No procedure named: no type.
    expect(studyTypeOf({ siteProtocol: GENERIC_CT, modality: 'CT', description: '  ' })).toBeNull();
  });

  it('a procedure part drops dates and long numbers: the kind of exam, never one', () => {
    expect(procedurePart('CT HEAD 2026-11-08 acc 12345678')).toBe('CT HEAD ACC');
    expect(procedurePart('XR CHEST 2 VIEWS')).toBe('XR CHEST 2 VIEWS');
    expect(procedurePart('MRI L-SPINE W/O #3')).toBe('MRI L-SPINE W/O 3');
    expect(procedurePart('20261108')).toBeNull();
    expect(procedurePart(42)).toBeNull();
  });

  it('no type without a compare protocol or a modality', () => {
    expect(studyTypeOf({ siteProtocol: null, modality: 'CT', description: 'X' })).toBeNull();
    expect(
      studyTypeOf({ siteProtocol: { id: '@pacsai/allInOne' }, modality: 'CT', description: 'X' })
    ).toBeNull();
    expect(
      studyTypeOf({ siteProtocol: { id: 'default' }, modality: 'CT', description: 'X' })
    ).toBeNull();
    expect(studyTypeOf({ siteProtocol: CTA, modality: '', description: 'X' })).toBeNull();
    expect(studyTypeOf({ siteProtocol: CTA, modality: 'C T', description: 'X' })).toBeNull();
  });

  it("the case's facts: its own image series' modality, the study's description", () => {
    const ds = [
      { StudyInstanceUID: 'A', Modality: 'SR' },
      { StudyInstanceUID: 'A', Modality: 'CT', instances: [{ StudyDescription: 'FROM SERIES' }] },
      { StudyInstanceUID: 'A', Modality: 'CT' },
      { StudyInstanceUID: 'A', Modality: 'MR' },
      { StudyInstanceUID: 'A', Modality: 'CT', isAllInOne: true },
      { StudyInstanceUID: 'P', Modality: 'MR' },
      { StudyInstanceUID: 'P', Modality: 'MR' },
    ];
    expect(caseFacts('A', ds, { StudyDescription: 'CT CHEST' })).toEqual({
      modality: 'CT',
      description: 'CT CHEST',
    });
    expect(caseFacts('A', ds, null)).toEqual({ modality: 'CT', description: 'FROM SERIES' });
    expect(caseFacts('Z', ds, null)).toEqual({ modality: null, description: null });
  });
});

describe('the preset (milestone 7, PR 2)', () => {
  const type = { key: 'v1|CT|@pacsai/compareCTA', label: 'CTA Head/Neck', generic: false };

  it('is the protocol on screen, its layout by id and name, and the prior choice', () => {
    const p = presetFromImages({ type, protocol: CTA, stageIndex: 1, browsing: 'current' });
    expect(p).toEqual({
      v: 1,
      label: 'CTA Head/Neck',
      protocolId: '@pacsai/compareCTA',
      protocolRevision: protocolRevision(CTA),
      stageId: 'cta-mip-1-cp',
      stageName: 'CTA Head MIP (ax + cor + sag)',
      browsing: 'current',
      summary: 'CTA Head/Neck Compare · CTA Head MIP (ax + cor + sag) · current only',
    });
    expect(
      presetFromImages({ type, protocol: CTA, stageIndex: 0, browsing: 'append' })?.summary
    ).toBe('CTA Head/Neck Compare · CTA Source axial (head + neck) · prior when available');
  });

  it('All-in-one only and Manual keep their own browsing; one layout keeps none', () => {
    const aio = presetFromImages({
      type,
      protocol: { id: '@pacsai/allInOne', name: 'All-in-one', stages: [{ id: 'a', name: 'All' }] },
      stageIndex: 0,
      browsing: 'append',
    });
    expect(aio).toMatchObject({
      browsing: 'allinone',
      stageId: null,
      stageName: null,
      summary: 'All-in-one only',
    });
    const manual = presetFromImages({
      type,
      protocol: { id: 'default' },
      stageIndex: 0,
      browsing: 'current',
    });
    expect(manual).toMatchObject({ browsing: 'manual', summary: 'Manual (pick series)' });
  });

  it('its layout is found by id, by name when the id moved, and not guessed when names repeat', () => {
    const want = { stageId: 'cta-mip-1-cp', stageName: 'CTA Head MIP (ax + cor + sag)' };
    expect(presetStageIndex(CTA, want)).toBe(1);
    const moved = {
      ...CTA,
      stages: [CTA.stages[1], CTA.stages[0]].map((s, i) => ({ ...s, id: `x${i}` })),
    };
    expect(presetStageIndex(moved, want)).toBe(0);
    expect(presetStageIndex(CTA, { stageId: 'gone', stageName: 'Current' })).toBeNull();
    expect(presetStageIndex(CTA, { stageId: null, stageName: null })).toBeNull();
    // Found, and disabled here: the caller falls back.
    expect(presetStageIndex(CTA, { stageId: 'cta-cpr-2-cp', stageName: 'CPR carotids' })).toBe(4);
  });

  it('the revision moves with the layouts, not with anything else', () => {
    expect(protocolRevision(CTA)).toMatch(/^[0-9a-f]{8}$/);
    expect(protocolRevision({ ...CTA, name: 'Renamed' })).toBe(protocolRevision(CTA));
    expect(
      protocolRevision({
        ...CTA,
        stages: [...CTA.stages, { id: 'new', name: 'New', status: 'enabled' }],
      })
    ).not.toBe(protocolRevision(CTA));
  });

  it('shows on screen only with its protocol, prior choice and layout', () => {
    const p = presetFromImages({
      type,
      protocol: CTA,
      stageIndex: 1,
      browsing: 'append',
    }) as HangingPreset;
    expect(showsPreset(p, { protocol: CTA, stageIndex: 1, browsing: 'append' })).toBe(true);
    expect(showsPreset(p, { protocol: CTA, stageIndex: 0, browsing: 'append' })).toBe(false);
    expect(showsPreset(p, { protocol: CTA, stageIndex: 1, browsing: 'current' })).toBe(false);
    expect(showsPreset(p, { protocol: GENERIC_CT, stageIndex: 1, browsing: 'append' })).toBe(false);
    expect(showsPreset(null, { protocol: CTA, stageIndex: 1, browsing: 'append' })).toBe(false);
  });
});

describe('the precedence at a re-hang (milestone 7, PR 2)', () => {
  const preset = (over: Partial<HangingPreset> = {}): HangingPreset => ({
    v: 1,
    label: 'CTA Head/Neck',
    protocolId: '@pacsai/compareCTHead',
    protocolRevision: 'abcd1234',
    stageId: 's1',
    stageName: 'Coronal',
    browsing: 'current',
    summary: 'x',
    ...over,
  });
  const matched = new Set(['@pacsai/compareCTA', '@pacsai/compareCTHead', '@pacsai/compareCT']);
  const site = {
    siteProtocolId: '@pacsai/compareCTA',
    browsing: 'append' as const,
    matchedIds: matched,
  };

  it("no preset: the site's protocol in the mode in use", () => {
    expect(planCase({ ...site, preset: null, caseChoice: false })).toEqual({
      source: 'site',
      protocolId: '@pacsai/compareCTA',
      browsing: 'append',
      preset: null,
      skipped: 'none',
    });
  });

  it("the reader's preset, when its protocol matches the case: its protocol and prior choice", () => {
    expect(planCase({ ...site, preset: preset(), caseChoice: false })).toEqual({
      source: 'preset',
      protocolId: '@pacsai/compareCTHead',
      browsing: 'current',
      preset: preset(),
      skipped: null,
    });
  });

  it('a choice made in this case wins over the preset', () => {
    expect(planCase({ ...site, preset: preset(), caseChoice: true })).toMatchObject({
      source: 'case',
      protocolId: '@pacsai/compareCTA',
      browsing: 'append',
      skipped: 'case-choice',
    });
  });

  it("a preset whose protocol does not match the case: the site's (the compatible fallback)", () => {
    expect(
      planCase({
        ...site,
        preset: preset({ protocolId: '@pacsai/compareCTChest' }),
        caseChoice: false,
      })
    ).toMatchObject({ source: 'site', protocolId: '@pacsai/compareCTA', skipped: 'not-eligible' });
  });

  it('All-in-one only or Manual: the browsing mode chooses their protocol', () => {
    expect(
      planCase({
        ...site,
        preset: preset({
          protocolId: '@pacsai/allInOne',
          browsing: 'allinone',
          stageId: null,
          stageName: null,
        }),
        caseChoice: false,
      })
    ).toMatchObject({ source: 'preset', protocolId: '@pacsai/compareCTA', browsing: 'allinone' });
  });
});

describe('what the app answers, checked (milestone 7, PR 2)', () => {
  const good = {
    v: 1,
    label: 'CTA Head/Neck',
    protocolId: '@pacsai/compareCTA',
    protocolRevision: 'abcd1234',
    stageId: 'cta-src-0-cp',
    stageName: 'CTA Source axial (head + neck)',
    browsing: 'append',
    summary: 'CTA Head/Neck Compare · CTA Source axial (head + neck) · prior when available',
  };

  it('keeps well-formed entries under well-formed keys, a reset as no preset', () => {
    const read = readEntries({
      'v1|CT|@pacsai/compareCTA': { revision: 2, preset: good, at: '2026-11-08T14:00:00.000Z' },
      'v1|CT|@pacsai/compareCT|CT ABDOMEN': { revision: 3, preset: null, at: 'x' },
      'not a key': { revision: 1, preset: good, at: 'x' },
      'v1|CT|@pacsai/compareCTChest': { revision: 1, preset: { ...good, browsing: 'up' }, at: 'x' },
      'v1|MR|@pacsai/compareMRBrain': { revision: 0, preset: good, at: 'x' },
    });
    expect(Object.keys(read).sort()).toEqual([
      'v1|CT|@pacsai/compareCTA',
      'v1|CT|@pacsai/compareCT|CT ABDOMEN',
    ]);
    expect(read['v1|CT|@pacsai/compareCT|CT ABDOMEN'].preset).toBeNull();
    expect(readEntries(null)).toEqual({});
    expect(readEntries([1])).toEqual({});
  });

  it('refuses a preset field that is not one', () => {
    expect(readPreset(good)).toEqual(good);
    for (const bad of [
      { v: 0 },
      { label: '' },
      { summary: 'a\nb' },
      { protocolId: 'a b' },
      { stageName: 7 },
    ]) {
      expect(readPreset({ ...good, ...bad })).toBeNull();
    }
  });
});
