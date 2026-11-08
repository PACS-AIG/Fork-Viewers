import {
  ALL_IN_ONE_CHOICE,
  MANUAL_CHOICE,
  browsingForChoice,
  imagesSummary,
  priorChoices,
  protocolChoices,
  protocolKind,
  protocolLabel,
  sameImages,
  sameWorkspace,
  shareChoices,
  stageChoices,
} from './arrangeModel';

const chest = {
  id: '@pacsai/compareCTChest',
  name: 'CT Chest Compare',
  stages: [
    { id: 'axlung-0-cp', name: 'Axial Lung (current/prior)', status: 'enabled' },
    { id: 'axsoft-1-cp', name: 'Axial Soft Tissue (current/prior)', status: 'passive' },
    { id: 'mip-4-cp', name: 'Axial MIP (current/prior)', status: 'disabled' },
    { id: 'x', name: '', status: 'enabled' },
  ],
};
const generic = { id: '@pacsai/compareCT', name: 'CT Compare' };

describe('Arrange: the Images group', () => {
  it('names the hanging in use in one line', () => {
    expect(imagesSummary(chest, 0, 'append')).toBe(
      'Using: CT Chest Compare · Axial Lung (current/prior)'
    );
    expect(imagesSummary(chest, 1, 'current')).toBe(
      'Using: CT Chest Compare · Axial Soft Tissue (current/prior) · current only'
    );
    expect(imagesSummary({ id: ALL_IN_ONE_CHOICE, stages: [{}] }, 0, 'allinone')).toBe(
      'Using: All-in-one only'
    );
    expect(imagesSummary({ id: MANUAL_CHOICE }, 0, 'manual')).toBe('Using: Manual (pick series)');
    expect(imagesSummary(null, 0, 'append')).toBe('Using: no hanging yet');
    expect(protocolLabel({ id: '@pacsai/compareFoo' })).toBe('compareFoo');
  });

  it('lists the matching protocols best first, then All-in-one only and Manual, the one in use selected', () => {
    const list = protocolChoices([chest, generic, { id: MANUAL_CHOICE }, chest], {
      protocolId: chest.id,
      stageIndex: 0,
      browsing: 'append',
    });
    expect(list.map(c => [c.id, c.kind, c.selected])).toEqual([
      [chest.id, 'compare', true],
      [generic.id, 'compare', false],
      [ALL_IN_ONE_CHOICE, 'allinone', false],
      [MANUAL_CHOICE, 'manual', false],
    ]);
    const allInOne = protocolChoices([chest], {
      protocolId: ALL_IN_ONE_CHOICE,
      stageIndex: 0,
      browsing: 'allinone',
    });
    expect(allInOne.filter(c => c.selected).map(c => c.id)).toEqual([ALL_IN_ONE_CHOICE]);
    // A compare protocol in use that no longer matches stays listed, first.
    const kept = protocolChoices([generic], {
      protocolId: chest.id,
      stageIndex: 0,
      browsing: 'append',
    });
    expect(kept[0]).toMatchObject({ id: chest.id, selected: true });
  });

  it('maps a choice to its browsing mode, keeping the prior off for a compare protocol', () => {
    expect(protocolKind(ALL_IN_ONE_CHOICE)).toBe('allinone');
    expect(protocolKind(MANUAL_CHOICE)).toBe('manual');
    expect(protocolKind(null)).toBe('manual');
    expect(protocolKind(chest.id)).toBe('compare');
    expect(browsingForChoice('compare', 'current')).toBe('current');
    expect(browsingForChoice('compare', 'allinone')).toBe('append');
    expect(browsingForChoice('allinone', 'current')).toBe('allinone');
    expect(browsingForChoice('manual', 'append')).toBe('manual');
  });

  it("lists the protocol's layouts, one the case cannot fill as not available", () => {
    const stages = stageChoices(chest, 1);
    expect(stages.map(s => [s.label, s.available, s.selected])).toEqual([
      ['Axial Lung (current/prior)', true, false],
      ['Axial Soft Tissue (current/prior)', true, true],
      ['Axial MIP (current/prior)', false, false],
      ['Layout 4', true, false],
    ]);
    expect(stageChoices({ id: 'default', stages: [{}] }, 0)).toEqual([]);
  });

  it('offers the prior only for a compare protocol with a prior loaded', () => {
    const state = { protocolId: chest.id, stageIndex: 0, browsing: 'append' as const };
    expect(priorChoices(state, false)).toEqual([]);
    expect(priorChoices({ ...state, protocolId: ALL_IN_ONE_CHOICE }, true)).toEqual([]);
    expect(
      priorChoices({ ...state, browsing: 'current' }, true).map(p => [p.value, p.selected])
    ).toEqual([
      ['append', false],
      ['current', true],
    ]);
  });

  it('compares two hangings', () => {
    const a = { protocolId: 'p', stageIndex: 1, browsing: 'append' as const };
    expect(sameImages(a, { ...a })).toBe(true);
    expect(sameImages(a, { ...a, stageIndex: 2 })).toBe(false);
    expect(sameImages(a, { ...a, browsing: 'current' })).toBe(false);
    expect(sameImages(a, null)).toBe(false);
  });
});

describe('Arrange: the Workspace group', () => {
  it('offers the report widths the window can hold, the one in use selected', () => {
    const shares = shareChoices(0.4, { min: 0.3, max: 0.5 });
    expect(shares.map(s => [s.label, s.available, s.selected])).toEqual([
      ['30 %', true, false],
      ['35 %', true, false],
      ['40 %', true, true],
      ['45 %', true, false],
      ['50 %', true, false],
      ['55 %', false, false],
    ]);
    expect(shareChoices(0.42, null).every(s => !s.available && !s.selected)).toBe(true);
  });

  it('compares two layouts', () => {
    expect(
      sameWorkspace({ mode: 'both', reportRatio: 0.4 }, { mode: 'both', reportRatio: 0.4001 })
    ).toBe(true);
    expect(
      sameWorkspace({ mode: 'both', reportRatio: 0.4 }, { mode: 'report', reportRatio: 0.4 })
    ).toBe(false);
  });
});
