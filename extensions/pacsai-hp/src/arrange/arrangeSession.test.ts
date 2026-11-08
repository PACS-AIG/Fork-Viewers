/**
 * Rev 11 milestone 7 (N05): Arrange previews the images and the workspace on
 * the real services, writes nothing while it does, puts back everything held
 * on Cancel, and keeps the reader's choice on Use this case.
 */
import { createArrange, type ArrangeDeps } from './arrangeSession';
import { ALL_IN_ONE_CHOICE, MANUAL_CHOICE } from './arrangeModel';
import type { BrowsingMode } from '../allinone/browsingMode';
import type { HangingEntry, HangingPreset } from './hangingPresets';
import type { CaseApplied, PresetsState, SaveAnswer } from './presetStore';

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

function world(opts: { presets?: ArrangeDeps['presets'] } = {}) {
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
    presets: opts.presets,
    hanging: () => hanging as never,
    displaySets: () => [
      { StudyInstanceUID: 'study-A', Modality: 'CT' },
      { StudyInstanceUID: 'study-P', Modality: 'CT' },
    ],
    getStudy: uid => ({ StudyInstanceUID: uid }),
    place: () => place as never,
    dock: () => dock,
    settling: () => settlingNow,
    priorLoaded: () => true,
    browsing: {
      get: () => browsing,
      stored: () => 'append',
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
    ]);
    expect(v.hiddenStages).toBe(1);
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

// ---- PR 2 (N06): the study type's save and reset ------------------------------------

const KEY = 'v1|CT|@pacsai/compareCTChest';

/** The reader's presets as Arrange uses them: saves answered here, as the app would. */
function presets() {
  const entries: Record<string, HangingEntry> = {};
  const saves: Array<{ key: string; preset: HangingPreset | null; expected: number }> = [];
  let next: SaveAnswer | null = null;
  let state: PresetsState = 'ready';
  let applied: CaseApplied | null = null;
  const marks = { n: 0 };
  const deps = {
    state: () => state,
    entry: (k: string) => entries[k] ?? null,
    save: jest.fn(async (key: string, preset: HangingPreset | null, expected: number) => {
      saves.push({ key, preset, expected });
      if (next) {
        const a = next;
        next = null;
        if (!a.ok && 'conflict' in a) {
          if (a.conflict) {
            entries[key] = a.conflict;
          }
        }
        return a;
      }
      const e = { revision: (entries[key]?.revision ?? 0) + 1, preset, at: 'now' };
      entries[key] = e;
      return { ok: true as const, entry: e };
    }),
    markCaseChoice: () => {
      marks.n++;
    },
    applied: () => applied,
  };
  return {
    deps,
    entries,
    saves,
    marks,
    setState: (s: PresetsState) => (state = s),
    conflictNext: (current: HangingEntry | null) => (next = { ok: false, conflict: current }),
    failNext: () => (next = { ok: false, failed: true }),
    setApplied: (a: CaseApplied | null) => (applied = a),
  };
}

const saved = (over: Partial<HangingPreset> = {}): HangingPreset => ({
  v: 1,
  label: 'CT Chest',
  protocolId: '@pacsai/compareCTChest',
  protocolRevision: 'abcd1234',
  stageId: 's1',
  stageName: 'Axial Soft Tissue (current/prior)',
  browsing: 'append',
  summary: 'CT Chest Compare · Axial Soft Tissue (current/prior) · prior when available',
  ...over,
});

describe('Save for this study type (milestone 7, PR 2, N06)', () => {
  it("names the case's study type and what Save keeps; nothing saved yet, nothing written", () => {
    const p = presets();
    const w = world({ presets: p.deps });
    w.arrange.open();
    expect(w.arrange.view().preset).toMatchObject({
      type: { key: KEY, label: 'CT Chest', generic: false },
      state: 'ready',
      saved: null,
      inUse: false,
      candidate: 'CT Chest Compare · Axial Lung (current/prior) · prior when available',
      canSave: true,
      canReset: false,
      conflict: null,
    });
    expect(p.saves).toEqual([]);
    noWrites();
  });

  it("one deliberate save: the study type's preset against the revision read, nothing else written", async () => {
    const p = presets();
    const w = world({ presets: p.deps });
    w.arrange.open();
    w.arrange.chooseStage(1);
    expect(await w.arrange.saveForStudyType()).toBe(true);
    expect(p.saves).toEqual([
      {
        key: KEY,
        expected: 0,
        preset: expect.objectContaining({
          protocolId: '@pacsai/compareCTChest',
          stageId: 's1',
          stageName: 'Axial Soft Tissue (current/prior)',
          browsing: 'append',
        }),
      },
    ]);
    const v = w.arrange.view();
    expect(v.preset).toMatchObject({
      inUse: true,
      canSave: false,
      canReset: true,
      status: 'Saved for your CT Chest studies.',
    });
    expect(v.summary).toBe(
      'Using your CT Chest layout: CT Chest Compare · Axial Soft Tissue (current/prior)'
    );
    // The workspace scope is not written; no browser storage; no other request.
    expect(w.dock.layoutAction).not.toHaveBeenCalled();
    noWrites();
    // Saved, so this case keeps it: Cancel puts nothing back.
    await w.arrange.cancel();
    expect(w.hp.stageIndex).toBe(1);
    expect(w.place.restore).not.toHaveBeenCalled();
    expect(w.arrange.counts()).toMatchObject({ saves: 1, resets: 0, conflicts: 0 });
  });

  it('a save another window made since this one read is shown, never overwritten; Replace saves against it', async () => {
    const p = presets();
    p.entries[KEY] = {
      revision: 1,
      preset: saved({ stageId: 's0', stageName: 'Axial Lung (current/prior)' }),
      at: 'x',
    };
    const w = world({ presets: p.deps });
    w.arrange.open();
    w.arrange.chooseStage(1);
    p.conflictNext({ revision: 2, preset: saved({ summary: 'Theirs' }), at: 'y' });
    expect(await w.arrange.saveForStudyType()).toBe(false);
    expect(p.saves.map(x => x.expected)).toEqual([1]);
    expect(w.arrange.view().preset).toMatchObject({
      conflict: { summary: 'Theirs' },
      canSave: false,
      canReset: false,
    });
    expect(await w.arrange.resolveConflict('replace')).toBe(true);
    expect(p.saves.map(x => x.expected)).toEqual([1, 2]);
    expect(w.arrange.view().preset).toMatchObject({
      conflict: null,
      status: 'Saved for your CT Chest studies.',
    });
    expect(w.arrange.counts().conflicts).toBe(1);
  });

  it('Keep theirs leaves what another window saved, and saves nothing', async () => {
    const p = presets();
    const w = world({ presets: p.deps });
    w.arrange.open();
    w.arrange.chooseStage(1);
    p.conflictNext({ revision: 1, preset: saved({ summary: 'Theirs' }), at: 'y' });
    await w.arrange.saveForStudyType();
    expect(await w.arrange.resolveConflict('keep')).toBe(true);
    expect(p.saves).toHaveLength(1);
    expect(w.arrange.view().preset?.status).toBe(
      'Kept the CT Chest layout saved in another window.'
    );
  });

  it("Reset names the study type, stores no preset, and shows the site's layout; Cancel keeps it", async () => {
    const p = presets();
    p.entries[KEY] = { revision: 3, preset: saved({ browsing: 'current' }), at: 'x' };
    const w = world({ presets: p.deps });
    // The case opened with the reader's layout (stage 1), and the prior is now previewed off.
    w.hp.stageIndex = 1;
    w.arrange.open();
    w.arrange.choosePrior('current');
    expect(w.arrange.view().preset).toMatchObject({ canReset: true, saved: { revision: 3 } });
    w.calls.length = 0;
    expect(await w.arrange.resetStudyType()).toBe(true);
    expect(p.saves).toEqual([{ key: KEY, preset: null, expected: 3 }]);
    expect(w.calls).toEqual(['browsing append', 'run @pacsai/compareCTChest - (append)']);
    expect(w.arrange.view().preset).toMatchObject({
      saved: null,
      status: "CT Chest studies: the site's layout again.",
    });
    await w.arrange.cancel();
    expect(w.hp).toMatchObject({ protocolId: '@pacsai/compareCTChest', stageIndex: 0 });
    expect(w.browsing()).toBe('append');
    noWrites();
  });

  it('waits while the comparison settles, or while the presets are being read', async () => {
    const p = presets();
    const w = world({ presets: p.deps });
    w.arrange.open();
    w.setSettling(true);
    expect(w.arrange.view().preset?.canSave).toBe(false);
    expect(await w.arrange.saveForStudyType()).toBe(false);
    expect(w.arrange.view().note).toBe('Still setting up the comparison: try again in a moment.');
    w.setSettling(false);
    p.setState('loading');
    expect(w.arrange.view().preset).toMatchObject({ state: 'loading', canSave: false });
    expect(await w.arrange.saveForStudyType()).toBe(false);
    expect(p.saves).toEqual([]);
  });

  it('a save the app did not take says so, and nothing is kept', async () => {
    const p = presets();
    const w = world({ presets: p.deps });
    w.arrange.open();
    p.failNext();
    expect(await w.arrange.saveForStudyType()).toBe(false);
    expect(w.arrange.view().note).toBe('Could not save: the app did not answer. Try again.');
    expect(w.arrange.view().preset).toMatchObject({ saved: null, inUse: false, status: null });
  });

  it("Use this case after an images change is this case's own choice: no preset overrides it", () => {
    const p = presets();
    const w = world({ presets: p.deps });
    w.arrange.open();
    w.arrange.useThisCase();
    expect(p.marks.n).toBe(0);
    w.arrange.open();
    w.arrange.chooseStage(1);
    w.arrange.useThisCase();
    expect(p.marks.n).toBe(1);
  });

  it("says when the reader's layout needs series this case lacks", () => {
    const p = presets();
    p.setApplied({
      source: 'preset',
      skipped: null,
      layout: 'fallback',
      missingLayout: 'Axial MIP (current/prior)',
    });
    const w = world({ presets: p.deps });
    w.arrange.open();
    expect(w.arrange.view().preset?.missingLayout).toBe('Axial MIP (current/prior)');
  });

  it('no study type, no group: the presets off, or no compare protocol for the case', () => {
    const p = presets();
    p.setState('off');
    const w = world({ presets: p.deps });
    w.arrange.open();
    expect(w.arrange.view().preset).toBeNull();
    const q = presets();
    const v = world({ presets: q.deps });
    v.hanging.protocolEngine.findMatchByStudy = () => [];
    v.arrange.open();
    expect(v.arrange.view().preset).toBeNull();
    const plain = world();
    plain.arrange.open();
    expect(plain.arrange.view().preset).toBeNull();
  });
});
