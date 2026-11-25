import { act, fireEvent } from '@testing-library/react';
import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import type { RsController, RsSnapshot } from '../rsController';
import { createRsHost } from '../rsHost';
import { makeEvidence, makeInbox, makeReport, makeVersions } from '../testDocs';
import type { SceneLook, SurfaceScene } from './anatomy3dScene';
import {
  CONTAINER_OPACITY,
  OTHERS_OPACITY,
  anatomy3dHarness,
  setSceneFactory,
  surfaceStatusLine,
  type SceneFactory,
} from './Anatomy3DView';
import { readAnatomy } from './anatomyContract';
import { createAnatomyStore, type AnatomyClient, type AnatomyTask } from './anatomyStore';
import { overlayRect, surfacesOffered } from './AnatomyTab';
import {
  AFFINE,
  CAVITIES,
  GRID,
  ORGANS,
  STUDY,
  VERTEBRAE,
  makeAnatomyDoc,
  makeNifti,
  makeSurfaces,
} from './anatomyTestData';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function fakeController() {
  let state: RsSnapshot = {
    phase: 'ready',
    reason: null,
    docs: {
      report: makeReport(),
      versions: makeVersions(),
      inbox: makeInbox(),
      evidence: makeEvidence(),
    },
    selection: null,
    copilotOpen: false,
    tab: 'draft',
    collapsed: false,
    busy: false,
    notice: null,
    canRetry: false,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<RsSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach(l => l());
  };
  const c = {
    getSnapshot: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setTab: jest.fn((tab: RsSnapshot['tab']) => set({ tab })),
    offerTab: jest.fn((tab: RsSnapshot['tab']) => set({ tab })),
    setCollapsed: jest.fn((collapsed: boolean) => set({ collapsed })),
    toggleCopilot: jest.fn(() => true),
    closeCopilot: jest.fn(),
    select: jest.fn(),
    moveSelection: jest.fn(),
    dismissNotice: jest.fn(),
    harnessState: () => ({}),
  };
  return c as unknown as RsController & typeof c;
}

/** The study's anatomy, with surfaces for the organs and the body cavities unless `plain`. */
function store(plain = false) {
  const base: Record<string, number[]> = {
    trunk_cavities: CAVITIES,
    total: ORGANS,
    vertebrae_pp: VERTEBRAE,
  };
  const surfaces: Record<string, ReturnType<typeof makeSurfaces>> = plain
    ? {}
    : {
        total: makeSurfaces('total', [
          { value: 1, centre: [-4, -4, 16] },
          { value: 2, centre: [4, 4, 19], size: 2 },
        ]),
        trunk_cavities: makeSurfaces('trunk_cavities', [
          { value: 1, centre: [0, 0, 20], size: 10 },
        ]),
      };
  const files: Record<string, Uint8Array> = {};
  const raw = makeAnatomyDoc();
  for (const lm of raw.series[0].labelmaps as Array<{
    task: string;
    sha256: string;
    labels: Array<{ value: number; surface?: unknown }>;
    surfaces?: unknown;
    surfacesWithheld?: string;
  }>) {
    const f = new Uint8Array(
      gzipSync(makeNifti({ dims: [GRID.nx, GRID.ny, GRID.nz], data: base[lm.task], sform: AFFINE }))
    );
    files[`0.${lm.task}.labels.nii.gz`] = f;
    lm.sha256 = sha(f);
    const fx = surfaces[lm.task];
    if (fx) {
      const gz = new Uint8Array(gzipSync(fx.bytes));
      files[`0.${lm.task}.surfaces.bin.gz`] = gz;
      lm.surfaces = fx.describe(sha(gz));
      lm.labels.forEach(l => (l.surface = fx.index[l.value]));
    } else if (!plain) {
      lm.surfacesWithheld = 'no surface below 8 voxels';
    }
  }
  return createAnatomyStore({
    client: {
      anatomy: (async () => readAnatomy(raw, 'clinical')) as AnatomyClient['anatomy'],
      anatomyFile: async (_s: string, b: string) => files[b],
    },
    digest: async b => sha(b),
    gunzip: async b => new Uint8Array(gunzipSync(b)),
    studyRef: () => 'ref',
  });
}

/** The pane in a report column on the window's right (the dock's place), 400 px wide below a 48 px header. */
function mount(controller: RsController, anatomy: ReturnType<typeof createAnatomyStore>) {
  const column = document.createElement('section');
  document.body.append(column);
  column.getBoundingClientRect = () =>
    ({
      height: 720,
      width: 400,
      top: 48,
      left: 624,
      right: 1024,
      bottom: 768,
      x: 624,
      y: 48,
      toJSON() {},
    }) as DOMRect;
  let host: ReturnType<typeof createRsHost> | null = null;
  act(() => {
    host = createRsHost({ win: window, column, controller, anatomy, setInset: () => {} });
  });
  return { column, destroy: () => act(() => host?.destroy()) };
}

/** Stand-in scenes: what each was given, and whether it was let go. */
function fakeScenes(webgl = true) {
  const made: Array<{
    container: HTMLElement;
    meshes: Map<string, number>;
    looks: Map<string, SceneLook>;
    resets: number;
    disposed: boolean;
  }> = [];
  const factory: SceneFactory = async container => {
    if (!webgl) {
      return null;
    }
    const rec = {
      container,
      meshes: new Map<string, number>(),
      looks: new Map<string, SceneLook>(),
      resets: 0,
      disposed: false,
    };
    made.push(rec);
    const scene: SurfaceScene = {
      addMeshes: ms =>
        ms.forEach(m => rec.meshes.has(m.key) || rec.meshes.set(m.key, m.triangles.length / 3)),
      setLooks: ls => ls.forEach(l => rec.looks.set(l.key, l)),
      resetView: () => rec.resets++,
      resize: () => {},
      dispose: () => (rec.disposed = true),
      stats: () => {
        const shown = [...rec.looks.values()].filter(l => l.visible && rec.meshes.has(l.key));
        return {
          actors: rec.meshes.size,
          visibleActors: shown.length,
          triangles: [...rec.meshes.values()].reduce((n, t) => n + t, 0),
          visibleTriangles: shown.reduce((n, l) => n + (rec.meshes.get(l.key) ?? 0), 0),
        };
      },
    };
    return scene;
  };
  return { made, factory };
}

const look = (rec: { looks: Map<string, SceneLook> }, key: string) => {
  const l = rec.looks.get(key);
  return l ? [l.visible, l.opacity] : null;
};

afterEach(() => {
  setSceneFactory(null);
  document.body.innerHTML = '';
});

describe("the Anatomy tab's 3D view (RS-36, contract 1.17)", () => {
  it('offers 3D only for a series with surfaces; draws them in the tab as the tab colours and switches them', async () => {
    const { made, factory } = fakeScenes();
    setSceneFactory(factory);
    const plain = store(true);
    const a = mount(fakeController(), plain);
    await act(async () => {
      plain.enter(STUDY);
      await flush();
    });
    expect(a.column.querySelector('[data-rs-anatomy]')).not.toBeNull();
    expect(a.column.querySelector('[data-rs-anatomy-3d-open]')).toBeNull();
    a.destroy();

    const s = store();
    const { column, destroy } = mount(fakeController(), s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    const open = column.querySelector('[data-rs-anatomy-3d-open="0"]') as HTMLButtonElement;
    expect(open.textContent).toBe('3D');
    expect(open.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      fireEvent.click(open);
      await flush();
    });
    expect(open.getAttribute('aria-pressed')).toBe('true');
    expect(column.querySelector('[data-rs-anatomy-3d="inline"]')).not.toBeNull();
    expect(made).toHaveLength(1);
    const scene = made[0];
    expect(column.contains(scene.container)).toBe(true);
    expect([...scene.meshes.entries()].sort()).toEqual([
      ['0/total/1', 4],
      ['0/total/2', 4],
      ['0/trunk_cavities/1', 4],
    ]);
    // The tab's colours; the body cavities hidden as their task is.
    const snap = s.getSnapshot();
    expect(scene.looks.get('0/total/1')?.color).toEqual(snap.structures['0/total/1'].color);
    expect(look(scene, '0/total/1')).toEqual([true, 1]);
    expect(look(scene, '0/total/2')).toEqual([true, 1]);
    expect(look(scene, '0/trunk_cavities/1')).toEqual([false, CONTAINER_OPACITY]);
    const status = () => column.querySelector('[data-rs-anatomy-3d-status]')?.textContent;
    expect(status()).toBe(
      '3 structures, 12 triangles · Vertebrae: no surfaces (no surface below 8 voxels)'
    );
    expect(anatomy3dHarness()).toMatchObject({
      open: true,
      enlarged: false,
      webgl: true,
      actors: 3,
      visibleActors: 2,
      triangles: 12,
      visibleTriangles: 8,
    });

    // The tab's switches, a structure's and a task's.
    act(() => {
      fireEvent.click(
        column.querySelector('[data-rs-structure="total/1"] input[type="checkbox"]')!
      );
    });
    expect(look(scene, '0/total/1')).toEqual([false, 1]);
    act(() => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-task-toggle="trunk_cavities"]')!);
    });
    // Shown, a body cavity is see-through: it wraps the organs.
    expect(look(scene, '0/trunk_cavities/1')).toEqual([true, CONTAINER_OPACITY]);
    // The structure pointed at in the table stays solid, the others fade; a hidden one is never lit.
    act(() => {
      fireEvent.mouseEnter(column.querySelector('[data-rs-structure="total/2"]')!);
    });
    expect(look(scene, '0/total/2')).toEqual([true, 1]);
    expect(look(scene, '0/trunk_cavities/1')).toEqual([true, OTHERS_OPACITY]);
    act(() => {
      fireEvent.mouseLeave(column.querySelector('[data-rs-structure="total/2"]')!);
      fireEvent.mouseEnter(column.querySelector('[data-rs-structure="total/1"]')!);
    });
    expect(look(scene, '0/total/2')).toEqual([true, 1]);
    expect(look(scene, '0/trunk_cavities/1')).toEqual([true, CONTAINER_OPACITY]);
    // The cavity itself in the spotlight is solid.
    act(() => {
      fireEvent.mouseLeave(column.querySelector('[data-rs-structure="total/1"]')!);
    });
    act(() => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-task="trunk_cavities"] .prs-fold')!);
    });
    act(() => {
      fireEvent.mouseEnter(column.querySelector('[data-rs-structure="trunk_cavities/1"]')!);
    });
    expect(look(scene, '0/trunk_cavities/1')).toEqual([true, 1]);
    expect(look(scene, '0/total/2')).toEqual([true, OTHERS_OPACITY]);

    act(() => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-3d-reset]')!);
    });
    expect(scene.resets).toBe(1);
    // The 3D button again closes it and lets the scene go.
    act(() => {
      fireEvent.click(open);
    });
    expect(column.querySelector('[data-rs-anatomy-3d]')).toBeNull();
    expect(scene.disposed).toBe(true);
    expect(anatomy3dHarness()).toBeNull();
    destroy();
  });

  it("lets the picked-out structure go in 3D from the tab's Show all, enlarged too", async () => {
    const { made, factory } = fakeScenes();
    setSceneFactory(factory);
    const s = store();
    const { column, destroy } = mount(fakeController(), s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-3d-open="0"]')!);
      await flush();
    });
    const showAll = () =>
      column.querySelector('[data-rs-anatomy-show-all]') as HTMLButtonElement | null;
    const name = (k: string) =>
      column.querySelector(`[data-rs-structure="${k}"] .prs-structure`) as HTMLButtonElement;
    // The spleen's name clicked: picked out in 3D, the others faded; Show all brings them back.
    act(() => {
      fireEvent.click(name('total/2'));
    });
    expect(look(made[0], '0/total/1')).toEqual([true, OTHERS_OPACITY]);
    act(() => {
      fireEvent.click(showAll()!);
    });
    expect(s.getSnapshot().selected).toBeNull();
    expect(look(made[0], '0/total/1')).toEqual([true, 1]);
    expect(look(made[0], '0/total/2')).toEqual([true, 1]);
    // Enlarged, the view sits beside the pane: the tab's Show all reaches it, and it stays open.
    act(() => {
      fireEvent.click(name('total/2'));
    });
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-3d-enlarge]')!);
      await flush();
    });
    const big = made[1];
    expect(look(big, '0/total/1')).toEqual([true, OTHERS_OPACITY]);
    act(() => {
      fireEvent.click(showAll()!);
    });
    expect(look(big, '0/total/1')).toEqual([true, 1]);
    expect(document.querySelector('[data-rs-anatomy-3d-overlay]')).not.toBeNull();
    destroy();
  });

  it("enlarges over the images beside the report column, keeps the tab's switches at hand, and goes back with Esc", async () => {
    const { made, factory } = fakeScenes();
    setSceneFactory(factory);
    const s = store();
    const { column, destroy } = mount(fakeController(), s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-3d-open="0"]')!);
      await flush();
    });
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-3d-enlarge]')!);
      await flush();
    });
    const overlay = document.querySelector('[data-rs-anatomy-3d-overlay]') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(column.contains(overlay)).toBe(false);
    // Left of the column, as tall as it (jsdom's window is 1024 x 768).
    expect([
      overlay.style.left,
      overlay.style.top,
      overlay.style.width,
      overlay.style.height,
    ]).toEqual(['8px', '56px', '608px', '704px']);
    expect(overlay.querySelector('[data-rs-anatomy-3d="enlarged"]')).not.toBeNull();
    expect(column.querySelector('[data-rs-anatomy-3d-away]')).not.toBeNull();
    expect(column.querySelector('[data-rs-anatomy-3d="inline"]')).toBeNull();
    expect(made).toHaveLength(2);
    expect(made[0].disposed).toBe(true);
    const big = made[1];
    expect(overlay.contains(big.container)).toBe(true);
    expect(big.meshes.size).toBe(3);
    expect(document.activeElement?.textContent).toBe('Back to the pane');
    expect(anatomy3dHarness()).toMatchObject({ enlarged: true, actors: 3 });
    // The tab's switches reach it.
    act(() => {
      fireEvent.click(
        column.querySelector('[data-rs-structure="total/2"] input[type="checkbox"]')!
      );
    });
    expect(look(big, '0/total/2')).toEqual([false, 1]);
    // Esc in it goes back to the pane, and goes no further (OHIF's Esc, the spotlight's).
    const seen: string[] = [];
    const listen = (e: KeyboardEvent) => seen.push(e.key);
    document.addEventListener('keydown', listen);
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      await flush();
    });
    document.removeEventListener('keydown', listen);
    expect(seen).toEqual([]);
    expect(document.querySelector('[data-rs-anatomy-3d-overlay]')).toBeNull();
    expect(big.disposed).toBe(true);
    expect(column.querySelector('[data-rs-anatomy-3d="inline"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute('data-rs-anatomy-3d-enlarge')).toBe('');
    expect(made).toHaveLength(3);
    // Enlarged again, its × closes it altogether.
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-3d-enlarge]')!);
      await flush();
    });
    act(() => {
      fireEvent.click(
        document.querySelector('[data-rs-anatomy-3d-overlay] [data-rs-anatomy-3d-close]')!
      );
    });
    expect(document.querySelector('[data-rs-anatomy-3d-overlay]')).toBeNull();
    expect(column.querySelector('[data-rs-anatomy-3d]')).toBeNull();
    expect(column.querySelector('[data-rs-anatomy-3d-away]')).toBeNull();
    expect(made.every(m => m.disposed)).toBe(true);
    destroy();
  });

  it('says so when the page draws no WebGL', async () => {
    const { factory } = fakeScenes(false);
    setSceneFactory(factory);
    const s = store();
    const { column, destroy } = mount(fakeController(), s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-3d-open="0"]')!);
      await flush();
    });
    expect(column.querySelector('[data-rs-anatomy-3d-status]')?.textContent).toBe(
      'The 3D view needs WebGL, which this browser does not give.'
    );
    expect((column.querySelector('[data-rs-anatomy-3d-reset]') as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(anatomy3dHarness()).toMatchObject({ open: true, webgl: false });
    destroy();
  });

  it('says so when the 3D view could not be loaded, never blaming WebGL', async () => {
    setSceneFactory(async () => {
      throw new Error('Loading chunk 3103 failed.');
    });
    const s = store();
    const { column, destroy } = mount(fakeController(), s);
    await act(async () => {
      s.enter(STUDY);
      await flush();
    });
    await act(async () => {
      fireEvent.click(column.querySelector('[data-rs-anatomy-3d-open="0"]')!);
      await flush();
    });
    expect(column.querySelector('[data-rs-anatomy-3d-status]')?.textContent).toBe(
      'The 3D view could not be loaded: reload the page to try again.'
    );
    expect(anatomy3dHarness()).toMatchObject({ open: true, webgl: false, failed: true });
    destroy();
  });

  it('says what is being read, what was not drawn and why, and why none were made', () => {
    const task = (title: string, surfaces: Partial<AnatomyTask['surfaces']>): AnatomyTask => ({
      series: 0,
      task: title.toLowerCase(),
      title,
      visible: true,
      status: 'ready',
      reason: null,
      structures: [],
      surfaces: { status: 'none', reason: null, structures: 0, triangles: 0, ...surfaces },
    });
    expect(surfaceStatusLine([])).toBe('This series has no surfaces.');
    expect(
      surfaceStatusLine([
        task('Organs', { status: 'ready', structures: 20, triangles: 412345 }),
        task('Cavities', { status: 'loading' }),
      ])
    ).toBe('Reading the surfaces: 1 of 2 files');
    expect(
      surfaceStatusLine([
        task('Organs', { status: 'ready', structures: 20, triangles: 412345 }),
        task('Vertebrae', {
          status: 'refused',
          reason: 'the file is not the one the document names (sha256)',
        }),
        task('Cavities', { status: 'withheld', reason: 'containers get no surfaces' }),
        task('Body', { status: 'invalid', reason: 'its surfaces are not for display' }),
      ])
    ).toBe(
      '20 structures, 412,345 triangles · Vertebrae: not drawn, the file is not the one the document names (sha256) · Cavities: no surfaces (containers get no surfaces) · Body: not drawn, its surfaces are not for display'
    );
    expect(
      surfacesOffered({ tasks: [task('Organs', { status: 'withheld', reason: 'x' })] } as never)
    ).toBe(false);
    expect(
      surfacesOffered({ tasks: [task('Organs', { status: 'invalid', reason: 'x' })] } as never)
    ).toBe(true);
  });

  it('puts the enlarged view on the wider side of the report column, or over the whole window without room', () => {
    const win = { innerWidth: 1600, innerHeight: 900 };
    // The dock on the right.
    expect(overlayRect({ left: 1200, right: 1600, top: 60, bottom: 900 }, win)).toEqual({
      left: 8,
      top: 68,
      width: 1184,
      height: 824,
    });
    // On the left.
    expect(overlayRect({ left: 0, right: 400, top: 60, bottom: 900 }, win)).toEqual({
      left: 408,
      top: 68,
      width: 1184,
      height: 824,
    });
    // Too little room beside it, or too short.
    const whole = { left: 8, top: 8, width: 1584, height: 884 };
    expect(overlayRect({ left: 300, right: 1350, top: 60, bottom: 900 }, win)).toEqual(whole);
    expect(overlayRect({ left: 1200, right: 1600, top: 760, bottom: 900 }, win)).toEqual(whole);
  });
});
