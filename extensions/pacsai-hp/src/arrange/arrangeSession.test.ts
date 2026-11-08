/**
 * Rev 11 milestone 7 (N05): Arrange previews the images and the workspace on
 * the real services, writes nothing while it does, puts back everything held
 * on Cancel, and keeps the reader's choice on Use this case.
 */
import { createArrange, type ArrangeDeps } from './arrangeSession';
import { ALL_IN_ONE_CHOICE, MANUAL_CHOICE } from './arrangeModel';
import type { BrowsingMode } from '../allinone/browsingMode';

const CHEST = {
  id: '@pacsai/compareCTChest',
  name: 'CT Chest Compare',
  stages: [
    { id: 's0', name: 'Axial Lung (current/prior)', status: 'enabled' },
    { id: 's1', name: 'Axial Soft Tissue (current/prior)', status: 'enabled' },
    { id: 's2', name: 'Axial MIP (current/prior)', status: 'disabled' },
  ],
};
const GENERIC = {
  id: '@pacsai/compareCT',
  name: 'CT Compare',
  stages: [
    { id: 'g0', name: 'Axial', status: 'enabled' },
    { id: 'g1', name: 'Coronal', status: 'enabled' },
  ],
};
const PROTOCOLS: Record<string, typeof CHEST> = {
  [CHEST.id]: CHEST,
  [GENERIC.id]: GENERIC,
  [ALL_IN_ONE_CHOICE]: {
    id: ALL_IN_ONE_CHOICE,
    name: 'All-in-one',
    stages: [{ id: 'a0', name: 'All-in-one', status: 'enabled' }],
  },
  [MANUAL_CHOICE]: {
    id: MANUAL_CHOICE,
    name: 'Default',
    stages: [{ id: 'd0', name: 'default', status: 'enabled' }],
  },
};

function world() {
  const calls: string[] = [];
  const hp = {
    protocolId: CHEST.id,
    stageIndex: 0,
    active: 'study-A',
  };
  let browsing: BrowsingMode = 'append';
  let layout = { mode: 'both' as const, reportRatio: 0.4 } as {
    mode: 'images' | 'both' | 'report';
    reportRatio: number;
  };
  let routeRef = 'ref-A';
  let held: typeof layout | null = null;
  const hanging = {
    getActiveProtocol: () => ({
      protocol: PROTOCOLS[hp.protocolId],
      stageIndex: hp.stageIndex,
      activeStudy: { StudyInstanceUID: hp.active },
    }),
    getState: () => ({
      protocolId: hp.protocolId,
      stageIndex: hp.stageIndex,
      activeStudyUID: hp.active,
    }),
    run: jest.fn((_d: unknown, protocolId?: string, options?: { stageIndex?: number }) => {
      calls.push(`run ${protocolId} ${options?.stageIndex ?? '-'} (${browsing})`);
      hp.protocolId = protocolId ?? CHEST.id;
      hp.stageIndex = options?.stageIndex ?? 0;
    }),
    setProtocol: jest.fn((protocolId: string, options?: { stageIndex?: number }) => {
      const stage = PROTOCOLS[protocolId].stages[options?.stageIndex ?? 0];
      if (!stage || stage.status === 'disabled') {
        throw new Error('no stage');
      }
      calls.push(`stage ${protocolId} ${options?.stageIndex}`);
      hp.stageIndex = options?.stageIndex ?? 0;
    }),
    protocolEngine: {
      findMatchByStudy: () => [
        { score: 300, protocol: CHEST },
        { score: 100, protocol: GENERIC },
        { score: 0, protocol: PROTOCOLS[MANUAL_CHOICE] },
      ],
    },
    studies: [{ StudyInstanceUID: 'study-A' }, { StudyInstanceUID: 'study-P' }],
  };
  const place = {
    capture: jest.fn(() => ({ grid: { token: 'held' } as never, viewports: [] })),
    restore: jest.fn(async () => {
      calls.push('restore view');
      return { missing: [] as string[] };
    }),
    series: () => [],
  };
  const dock = {
    layoutNow: () => ({ ...layout }),
    splitBoundsNow: () => ({ min: 0.3, max: 0.5 }),
    previewLayout: jest.fn((l: { mode?: 'images' | 'both' | 'report'; reportRatio?: number }) => {
      if (l.mode === 'images' && dockRefusesImages) {
        return false;
      }
      if (!held) {
        held = { ...layout };
      }
      layout = { mode: l.mode ?? layout.mode, reportRatio: l.reportRatio ?? layout.reportRatio };
      calls.push(`preview ${layout.mode} ${layout.reportRatio}`);
      return true;
    }),
    endLayoutPreview: jest.fn((apply: boolean) => {
      if (held && !apply) {
        layout = held;
      }
      if (held) {
        calls.push(apply ? 'apply layout' : 'layout back');
      }
      held = null;
    }),
    layoutMenu: () => ({ modality: 'CT', ownLayout: false }),
    layoutAction: jest.fn((action: string) => {
      calls.push(`action ${action}`);
      held = null;
      return true;
    }),
    getSnapshot: () => ({ routeStudyRef: routeRef }),
  };
  let dockRefusesImages = false;
  let settlingNow = false;
  const deps: ArrangeDeps = {
    hanging: () => hanging as never,
    displaySets: () => [{ StudyInstanceUID: 'study-A' }, { StudyInstanceUID: 'study-P' }],
    getStudy: uid => ({ StudyInstanceUID: uid }),
    place: () => place as never,
    dock: () => dock,
    settling: () => settlingNow,
    priorLoaded: () => true,
    browsing: {
      get: () => browsing,
      preview: (m: BrowsingMode) => {
        browsing = m;
        calls.push(`browsing ${m}`);
      },
    },
  };
  return {
    arrange: createArrange(deps),
    calls,
    hp,
    hanging,
    place,
    dock,
    browsing: () => browsing,
    layout: () => layout,
    setSettling: (v: boolean) => (settlingNow = v),
    refuseImages: () => (dockRefusesImages = true),
    switchCase: () => {
      hp.active = 'study-B';
      routeRef = 'ref-B';
    },
  };
}

let setItem: jest.SpyInstance;
const fetchSpy = jest.fn();
beforeEach(() => {
  setItem = jest.spyOn(Storage.prototype, 'setItem');
  (globalThis as { fetch?: unknown }).fetch = fetchSpy;
  fetchSpy.mockClear();
});
afterEach(() => setItem.mockRestore());

const noWrites = () => {
  expect(setItem).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
};

describe('Arrange (milestone 7, N05)', () => {
  it('opens on the hanging in use, both groups listed', () => {
    const w = world();
    expect(w.arrange.open()).toBe(true);
    const v = w.arrange.view();
    expect(v.summary).toBe('Using: CT Chest Compare · Axial Lung (current/prior)');
    expect(v.protocols.map(p => p.label)).toEqual([
      'CT Chest Compare',
      'CT Compare',
      'All-in-one only',
      'Manual (pick series)',
    ]);
    expect(v.prior.map(p => p.label)).toEqual(['With prior', 'Current only']);
    expect(v.stages.map(s => [s.label, s.available])).toEqual([
      ['Axial Lung (current/prior)', true],
      ['Axial Soft Tissue (current/prior)', true],
      ['Axial MIP (current/prior)', false],
    ]);
    expect(v.workspace?.modes.find(m => m.selected)?.value).toBe('both');
    expect(v.workspace?.shares.find(s => s.selected)?.label).toBe('40 %');
    expect(v.workspace?.layoutMenu).toEqual({ modality: 'CT', ownLayout: false });
    expect(v.changed).toEqual({ images: false, workspace: false });
    expect(w.place.capture).toHaveBeenCalledTimes(1);
    noWrites();
  });

  it('previews a protocol, the prior and a layout on the viewer, then Cancel puts back the hanging and the view, writing nothing', async () => {
    const w = world();
    w.arrange.open();
    expect(w.arrange.chooseProtocol(GENERIC.id)).toBe(true);
    expect(w.arrange.chooseStage(1)).toBe(true);
    expect(w.arrange.choosePrior('current')).toBe(true);
    expect(w.arrange.view().changed.images).toBe(true);
    expect(w.hp).toMatchObject({ protocolId: GENERIC.id });
    await w.arrange.cancel();
    expect(w.hp).toMatchObject({ protocolId: CHEST.id, stageIndex: 0 });
    expect(w.browsing()).toBe('append');
    expect(w.calls.slice(-3)).toEqual([
      'browsing append',
      `run ${CHEST.id} 0 (append)`,
      'restore view',
    ]);
    expect(w.arrange.isOpen()).toBe(false);
    noWrites();
  });

  it('previews All-in-one only and Manual with the browsing mode held in memory', async () => {
    const w = world();
    w.arrange.open();
    w.arrange.chooseProtocol(ALL_IN_ONE_CHOICE);
    expect(w.browsing()).toBe('allinone');
    expect(w.hp.protocolId).toBe(ALL_IN_ONE_CHOICE);
    w.arrange.chooseProtocol(MANUAL_CHOICE);
    expect(w.browsing()).toBe('manual');
    expect(w.hp.protocolId).toBe(MANUAL_CHOICE);
    await w.arrange.cancel();
    expect(w.browsing()).toBe('append');
    noWrites();
  });

  it('a layout change alone puts back only the stage, then the view', async () => {
    const w = world();
    w.arrange.open();
    w.arrange.chooseStage(1);
    await w.arrange.cancel();
    expect(w.calls).toEqual([`stage ${CHEST.id} 1`, `stage ${CHEST.id} 0`, 'restore view']);
    noWrites();
  });

  it('a layout the case cannot fill is not shown, and says so', () => {
    const w = world();
    w.arrange.open();
    expect(w.arrange.chooseStage(2)).toBe(false);
    expect(w.arrange.view().note).toMatch(/cannot be shown/);
    expect(w.hp.stageIndex).toBe(0);
  });

  it('previews the workspace layout, and Cancel puts it back without telling anyone', async () => {
    const w = world();
    w.arrange.open();
    expect(w.arrange.chooseShare(0.5)).toBe(true);
    expect(w.arrange.chooseMode('report')).toBe(true);
    expect(w.arrange.view().changed).toEqual({ images: false, workspace: true });
    await w.arrange.cancel();
    expect(w.layout()).toEqual({ mode: 'both', reportRatio: 0.4 });
    expect(w.calls).toEqual(['preview both 0.5', 'preview report 0.5', 'layout back']);
    // The images were not touched: no re-hang, no view restore.
    expect(w.hanging.run).not.toHaveBeenCalled();
    expect(w.place.restore).not.toHaveBeenCalled();
    noWrites();
  });

  it("Use this case keeps the images for the case and applies the layout as the reader's choice", () => {
    const w = world();
    w.arrange.open();
    w.arrange.chooseProtocol(ALL_IN_ONE_CHOICE);
    w.arrange.chooseShare(0.45);
    w.arrange.useThisCase();
    expect(w.hp.protocolId).toBe(ALL_IN_ONE_CHOICE);
    expect(w.browsing()).toBe('allinone');
    expect(w.layout()).toEqual({ mode: 'both', reportRatio: 0.45 });
    expect(w.dock.endLayoutPreview).toHaveBeenLastCalledWith(true);
    expect(w.place.restore).not.toHaveBeenCalled();
    expect(w.arrange.isOpen()).toBe(false);
    expect(w.arrange.counts()).toMatchObject({ opens: 1, uses: 1, cancels: 0 });
    noWrites();
  });

  it('waits while the comparison is being set up', () => {
    const w = world();
    w.arrange.open();
    w.setSettling(true);
    expect(w.arrange.view().settling).toBe(true);
    expect(w.arrange.chooseStage(1)).toBe(false);
    expect(w.arrange.view().note).toMatch(/Still setting up/);
    expect(w.hanging.setProtocol).not.toHaveBeenCalled();
    // The workspace does not wait.
    expect(w.arrange.chooseMode('report')).toBe(true);
  });

  it('says why Images cannot be previewed yet', () => {
    const w = world();
    w.refuseImages();
    w.arrange.open();
    expect(w.arrange.chooseMode('images')).toBe(false);
    expect(w.arrange.view().note).toMatch(/Images waits/);
  });

  it('puts nothing into the next case when the case changes under it', async () => {
    const w = world();
    w.arrange.open();
    w.arrange.chooseStage(1);
    w.arrange.chooseShare(0.5);
    w.switchCase();
    expect(w.arrange.chooseStage(0)).toBe(false);
    expect(w.arrange.isOpen()).toBe(false);
    // The window's layout goes back; the images are the new case's own.
    expect(w.layout()).toEqual({ mode: 'both', reportRatio: 0.4 });
    expect(w.place.restore).not.toHaveBeenCalled();
    await w.arrange.cancel();
    expect(w.arrange.counts()).toMatchObject({ dropped: 1, cancels: 0 });
  });

  it("Save this layout and Restore saved are F56's deliberate actions, not undone by Cancel", async () => {
    const w = world();
    w.arrange.open();
    w.arrange.chooseShare(0.45);
    expect(w.arrange.saveLayout()).toBe(true);
    expect(w.dock.layoutAction).toHaveBeenCalledWith('save');
    await w.arrange.cancel();
    expect(w.layout()).toEqual({ mode: 'both', reportRatio: 0.45 });
    w.arrange.open();
    expect(w.arrange.restoreSaved()).toBe(true);
    expect(w.arrange.setOwnLayout(true)).toBe(true);
    expect(w.dock.layoutAction.mock.calls.map(c => c[0])).toEqual(['save', 'reset', 'own-on']);
  });
});
