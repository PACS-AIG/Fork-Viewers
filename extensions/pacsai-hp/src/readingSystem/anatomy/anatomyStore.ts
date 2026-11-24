/**
 * RS-36: the anatomy layers' state, outside React (the pane's Anatomy tab
 * renders it through `subscribe` / `getSnapshot`, and the viewport overlay
 * draws from `renderSetFor`).
 *
 *   - `enter(study)` reads the study's anatomy artifact. A study without one
 *     (404) has no Anatomy tab; a refused or failed read says why there.
 *   - Each series' labelmaps are then read one at a time, the shown tasks
 *     first: the file's sha256 against the document's, the NIfTI header's
 *     shape, voxel type and affine against the series' grid (to 0.001 mm, as
 *     the reading system checks them), and each label's voxel count against
 *     the document's. A labelmap that fails any check is refused with the
 *     reason and draws nothing.
 *   - The layer settings: on or off, opacity, fill or outline (the reader's
 *     own, kept in this browser); each task and each structure shown or
 *     hidden (per study). Body cavities start hidden: they contain the organs.
 *   - Selecting a structure shows it and asks the navigator (the overlay) to
 *     bring its largest slice into a viewport.
 *
 * Nothing here names the study by UID: the harness state uses references.
 */
import { RsRefused } from '../rsContract';
import { RsHttpError } from '../rsClient';
import { isVertebra, labelColor, vertebraColor, type Rgb } from './anatomyColors';
import type { RsAnatomy, RsAnatomyLabelmap, RsAnatomySeries } from './anatomyContract';
import {
  affineDifference,
  applyPoint,
  indexFromLps,
  lpsFromIndex,
  voxelVolumeMm3,
  type GridFit,
  type Mat4,
  type Vec3,
} from './anatomyGeometry';
import { buildLayer, type AnatomyLayerData, type Yielder } from './anatomyLayer';
import { labelsAt, packColor, type RenderLayer } from './anatomyRender';
import { NiftiError, parseNifti, unpackNifti, type Gunzip } from './nifti';

export type AnatomyPhase = 'idle' | 'loading' | 'ready' | 'none' | 'refused' | 'failed';
export type AnatomyStyle = 'fill' | 'outline';

export interface AnatomySettings {
  enabled: boolean;
  /** 0.1 .. 1 */
  opacity: number;
  style: AnatomyStyle;
}

export const DEFAULT_SETTINGS: AnatomySettings = { enabled: true, opacity: 0.35, style: 'fill' };
/** The reading system checks a labelmap's affine to this (mm); so does the viewer. */
export const AFFINE_TOLERANCE_MM = 1e-3;

export interface AnatomyStructure {
  /** `<series>/<task>/<value>` */
  key: string;
  series: number;
  task: string;
  value: number;
  /** The document's display phrase. */
  name: string;
  rawClass: string | null;
  color: Rgb;
  visible: boolean;
  /** The document's voxel count, and its volume (voxels x |det(affine)|). */
  voxels: number;
  volumeMl: number;
  /** Its centroid's height (patient superior, mm), once its labelmap is read. */
  superior: number | null;
  /** Its first and last slice (index), once its labelmap is read. */
  slices: [number, number] | null;
}

export interface AnatomyTask {
  series: number;
  task: string;
  title: string;
  visible: boolean;
  status: 'waiting' | 'loading' | 'ready' | 'refused';
  reason: string | null;
  /** Structure keys: the document's order, then head to feet once read. */
  structures: string[];
}

export interface AnatomySeriesView {
  index: number;
  /** "114 slices, 0.68 × 0.68 × 5 mm" (no UID). */
  description: string;
  withheld: string | null;
  unnamed: number;
  invalid: string | null;
  tasks: AnatomyTask[];
}

export interface AnatomySnapshot {
  phase: AnatomyPhase;
  reason: string | null;
  series: AnatomySeriesView[];
  structures: Record<string, AnatomyStructure>;
  settings: AnatomySettings;
  selected: string | null;
  hovered: string | null;
  /** Things the reader should know (a refused file, a series not drawn). */
  notes: string[];
  /** Bumps whenever what is drawn changes. */
  revision: number;
}

/** What the overlay draws for one series. */
export interface AnatomyRenderSet {
  series: number;
  indexFromLps: Mat4;
  shape: [number, number, number];
  /** Visible layers, bottom first, and each one's task. */
  layers: RenderLayer[];
  tasks: string[];
  fillAlpha: number;
  edgeAlpha: number;
  highlight: { layer: number; value: number } | null;
  revision: number;
}

/** Where a selected structure is: for the navigator. */
export interface AnatomyTarget {
  key: string;
  seriesUID: string;
  /** Its largest slice's in-plane centroid, in the viewer's world (LPS mm). */
  point: Vec3;
}

export interface AnatomyClient {
  anatomy(study: string): Promise<RsAnatomy>;
  anatomyFile(study: string, basename: string): Promise<Uint8Array>;
}

export interface AnatomyStoreDeps {
  client: AnatomyClient;
  /** SHA-256 as lowercase hex, or null where the page has no WebCrypto. */
  digest: ((bytes: Uint8Array) => Promise<string>) | null;
  gunzip: Gunzip | null;
  yieldNow?: Yielder;
  /** The reader's layer settings, kept in this browser. */
  storage?: { get(): string | null; set(value: string): void } | null;
  studyRef: (uid: string) => string;
}

export interface AnatomyStore {
  enter(study: string | null): void;
  leave(): void;
  getSnapshot(): AnatomySnapshot;
  subscribe(listener: () => void): () => void;
  setEnabled(enabled: boolean): void;
  setOpacity(opacity: number): void;
  setStyle(style: AnatomyStyle): void;
  setTaskVisible(series: number, task: string, visible: boolean): void;
  setStructureVisible(key: string, visible: boolean): void;
  /** Select a structure (null clears): shows it and asks the navigator to bring it into view. */
  select(key: string | null): void;
  /** The structure the reader points at in the table (null: none). */
  hover(key: string | null): void;
  /** The overlay's: brings a target into a viewport; answers whether it could. */
  setNavigator(navigate: ((target: AnatomyTarget) => boolean) | null): void;
  /** The series index for a series UID, when it has drawable layers. */
  seriesOf(seriesUID: string): number | null;
  renderSetFor(seriesUID: string): AnatomyRenderSet | null;
  /** The structures under a world point (LPS mm) of a series, topmost first. */
  structuresAt(seriesUID: string, world: Vec3): AnatomyStructure[];
  /** The overlay's verdict on a series' images against its grid. */
  reportFit(seriesUID: string, fit: GridFit): void;
  harnessState(): Record<string, unknown>;
}

const TASK_TITLES: Array<[RegExp, string]> = [
  [/^total$/, 'Organs and structures'],
  [/vertebra/, 'Vertebrae'],
  [/cavit/, 'Body cavities'],
  [/^body$/, 'Body'],
];

export function taskTitle(task: string): string {
  for (const [pattern, title] of TASK_TITLES) {
    if (pattern.test(task)) {
      return title;
    }
  }
  const words = task.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : task;
}

/** A structure's display phrase as the pane and the hover show it (its first letter capital). */
export const displayName = (name: string): string =>
  name ? name[0].toUpperCase() + name.slice(1) : name;

/** Tasks that contain others (the body's cavities) start hidden and sit at the bottom. */
export const isContainerTask = (task: string): boolean => /cavit|^body$/.test(task);

export function readSettings(raw: string | null | undefined): AnatomySettings {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<AnatomySettings>) : null;
    if (!v || typeof v !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_SETTINGS.enabled,
      opacity:
        typeof v.opacity === 'number' && Number.isFinite(v.opacity)
          ? clampOpacity(v.opacity)
          : DEFAULT_SETTINGS.opacity,
      style: v.style === 'outline' || v.style === 'fill' ? v.style : DEFAULT_SETTINGS.style,
    };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

export const clampOpacity = (x: number): number =>
  Math.max(0.1, Math.min(1, Math.round(x * 100) / 100));

/** The alphas a style and opacity draw with. */
export function alphasFor(settings: AnatomySettings): { fill: number; edge: number } {
  return settings.style === 'outline'
    ? { fill: 0, edge: Math.min(1, 0.45 + settings.opacity) }
    : { fill: settings.opacity, edge: Math.min(1, settings.opacity + 0.35) };
}

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 through WebCrypto, or null where the page has none (not a secure context). */
export function webDigest(
  win: { crypto?: Crypto } | undefined
): ((b: Uint8Array) => Promise<string>) | null {
  const subtle = win?.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    return null;
  }
  return async bytes => hex(await subtle.digest('SHA-256', bytes));
}

const formatMm = (n: number): string =>
  Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2).replace(/0$/, '');

function seriesDescription(s: RsAnatomySeries): string {
  if (!s.grid) {
    return 'no grid';
  }
  const a = s.grid.affineRAS;
  const len = (c: number) => Math.hypot(a[0][c], a[1][c], a[2][c]);
  return `${s.grid.shape[0]} slices, ${formatMm(len(0))} × ${formatMm(len(1))} × ${formatMm(len(2))} mm`;
}

interface LoadedLayer {
  data: AnatomyLayerData;
  colors: Uint32Array;
}

const INITIAL: AnatomySnapshot = {
  phase: 'idle',
  reason: null,
  series: [],
  structures: {},
  settings: { ...DEFAULT_SETTINGS },
  selected: null,
  hovered: null,
  notes: [],
  revision: 0,
};

export function createAnatomyStore(deps: AnatomyStoreDeps): AnatomyStore {
  const listeners = new Set<() => void>();
  let state: AnatomySnapshot = { ...INITIAL, settings: readSettings(deps.storage?.get()) };
  let study: string | null = null;
  let doc: RsAnatomy | null = null;
  let generation = 0;
  let navigate: ((target: AnatomyTarget) => boolean) | null = null;
  // `<series>/<task>` -> the loaded layer.
  const loaded = new Map<string, LoadedLayer>();
  const fits = new Map<string, GridFit>();
  const counts = { reads: 0, files: 0, refusedFiles: 0, selections: 0, jumps: 0, jumpMisses: 0 };
  let renderCache: { revision: number; sets: Map<number, AnatomyRenderSet> } = {
    revision: -1,
    sets: new Map(),
  };

  const emit = () => listeners.forEach(l => l());
  const set = (patch: Partial<AnatomySnapshot>, drawn = true) => {
    state = { ...state, ...patch, revision: drawn ? state.revision + 1 : state.revision };
    emit();
  };

  const saveSettings = (settings: AnatomySettings) => {
    try {
      deps.storage?.set(JSON.stringify(settings));
    } catch (_) {
      /* a private window: the settings last as long as the page */
    }
  };

  const keyOf = (series: number, task: string, value: number) => `${series}/${task}/${value}`;
  const taskKey = (series: number, task: string) => `${series}/${task}`;

  function colorsFor(
    series: number,
    lm: RsAnatomyLabelmap,
    structures: Record<string, AnatomyStructure>
  ): Uint32Array {
    const colors = new Uint32Array(lm.datatype === 'uint8' ? 256 : 65536);
    for (const label of lm.labels) {
      const s = structures[keyOf(series, lm.task, label.value)];
      if (s?.visible) {
        colors[label.value] = packColor(s.color);
      }
    }
    return colors;
  }

  function refreshColors(
    series: number,
    task: string,
    structures: Record<string, AnatomyStructure>
  ) {
    const lm = doc?.series[series]?.labelmaps.find(l => l.task === task);
    const layer = loaded.get(taskKey(series, task));
    if (lm && layer) {
      layer.colors = colorsFor(series, lm, structures);
    }
  }

  function updateTask(
    series: number,
    task: string,
    patch: Partial<AnatomyTask>
  ): AnatomySeriesView[] {
    return state.series.map(s =>
      s.index !== series
        ? s
        : { ...s, tasks: s.tasks.map(t => (t.task === task ? { ...t, ...patch } : t)) }
    );
  }

  function addNote(note: string): string[] {
    return state.notes.includes(note) ? state.notes : [...state.notes, note];
  }

  async function loadLabelmap(
    gen: number,
    uid: string,
    sIndex: number,
    s: RsAnatomySeries,
    lm: RsAnatomyLabelmap
  ) {
    const title = taskTitle(lm.task);
    const refuse = (why: string) => {
      counts.refusedFiles++;
      if (gen !== generation) {
        return;
      }
      set({
        series: updateTask(sIndex, lm.task, { status: 'refused', reason: why }),
        notes: addNote(`${title}: ${why}; not drawn.`),
      });
    };
    set({ series: updateTask(sIndex, lm.task, { status: 'loading' }) }, false);
    let bytes: Uint8Array;
    try {
      bytes = await deps.client.anatomyFile(uid, lm.basename);
      counts.files++;
    } catch (e) {
      return refuse(
        e instanceof RsHttpError
          ? `the labelmap could not be read (HTTP ${e.status})`
          : 'the labelmap could not be read'
      );
    }
    if (gen !== generation) {
      return;
    }
    if (deps.digest) {
      let sum: string;
      try {
        sum = await deps.digest(bytes);
      } catch (_) {
        return refuse('its checksum could not be computed');
      }
      if (sum !== lm.sha256) {
        return refuse('the file is not the one the document names (sha256)');
      }
    }
    const grid = s.grid;
    if (!grid) {
      return refuse('its series has no grid');
    }
    let volume;
    try {
      volume = parseNifti(await unpackNifti(bytes, deps.gunzip));
    } catch (e) {
      return refuse(e instanceof NiftiError ? e.message : 'the labelmap is not NIfTI-1');
    }
    const [slices, rows, columns] = grid.shape;
    if (volume.dims[0] !== columns || volume.dims[1] !== rows || volume.dims[2] !== slices) {
      return refuse("its size is not the series' grid");
    }
    if (volume.datatype !== lm.datatype) {
      return refuse(`its voxels are ${volume.datatype}, the document says ${lm.datatype}`);
    }
    if (!volume.sform) {
      return refuse('its header has no sform');
    }
    if (affineDifference(volume.sform, grid.affineRAS) > AFFINE_TOLERANCE_MM) {
      return refuse("its header's affine is not the series' grid");
    }
    let qformNote: string | null = null;
    if (volume.qform && affineDifference(volume.qform, grid.affineRAS) > AFFINE_TOLERANCE_MM) {
      qformNote = `${title}: the header's qform differs from its sform; drawn by the sform, as NIfTI prefers.`;
    }
    const data = await buildLayer(
      volume,
      lm.labels.map(l => l.value),
      deps.yieldNow
    );
    if (gen !== generation) {
      return;
    }
    const wrong = lm.labels.filter(l => (data.stats.get(l.value)?.voxels ?? 0) !== l.voxels);
    if (wrong.length) {
      return refuse(`${wrong.length} of its labels do not hold the voxels the document counts`);
    }
    const toWorld = lpsFromIndex(grid.affineRAS);
    const structures = { ...state.structures };
    for (const label of lm.labels) {
      const key = keyOf(sIndex, lm.task, label.value);
      const st = data.stats.get(label.value);
      if (structures[key] && st) {
        structures[key] = {
          ...structures[key],
          superior: applyPoint(toWorld, st.centroid)[2],
          slices: st.slices,
        };
      }
    }
    const order = lm.labels
      .map(l => keyOf(sIndex, lm.task, l.value))
      .sort((a, b) => {
        const za = structures[a]?.superior ?? -Infinity;
        const zb = structures[b]?.superior ?? -Infinity;
        return zb - za || (structures[a]?.name ?? '').localeCompare(structures[b]?.name ?? '');
      });
    // Neighbouring vertebrae never share a colour: they take theirs in head-to-feet order.
    let rank = 0;
    for (const key of order) {
      const st = structures[key];
      if (st && isVertebra(st)) {
        structures[key] = { ...st, color: vertebraColor(rank++) };
      }
    }
    loaded.set(taskKey(sIndex, lm.task), { data, colors: colorsFor(sIndex, lm, structures) });
    let notes = state.notes;
    if (qformNote && !notes.includes(qformNote)) {
      notes = [...notes, qformNote];
    }
    if (data.stray > 0) {
      const strayNote = `${title}: ${data.stray} voxels hold a value the document does not name; not drawn.`;
      if (!notes.includes(strayNote)) {
        notes = [...notes, strayNote];
      }
    }
    set({
      structures,
      series: updateTask(sIndex, lm.task, { status: 'ready', reason: null, structures: order }),
      notes,
    });
  }

  async function load(uid: string, gen: number) {
    counts.reads++;
    let anatomy: RsAnatomy;
    try {
      anatomy = await deps.client.anatomy(uid);
    } catch (e) {
      if (gen !== generation) {
        return;
      }
      if (e instanceof RsHttpError && e.status === 404) {
        set({ phase: 'none', reason: null });
      } else if (e instanceof RsRefused) {
        set({ phase: 'refused', reason: e.why });
      } else {
        set({
          phase: 'failed',
          reason:
            e instanceof RsHttpError
              ? `The anatomy could not be read (HTTP ${e.status}).`
              : 'The anatomy could not be read.',
        });
      }
      return;
    }
    if (gen !== generation) {
      return;
    }
    doc = anatomy;
    const structures: Record<string, AnatomyStructure> = {};
    const notes: string[] = [];
    const series: AnatomySeriesView[] = anatomy.series.map((s, index) => {
      const vox = s.grid ? voxelVolumeMm3(s.grid.affineRAS) : 0;
      if (s.invalid) {
        notes.push(`A series' anatomy is not drawn: ${s.invalid}.`);
      } else if (!s.labelmaps.length && s.withheld) {
        notes.push(`A series has no anatomy layers: ${s.withheld}.`);
      }
      const ordered = [...s.labelmaps].sort(
        (a, b) => Number(isContainerTask(a.task)) - Number(isContainerTask(b.task))
      );
      const tasks: AnatomyTask[] = s.invalid
        ? []
        : ordered.map(lm => {
            const visible = !isContainerTask(lm.task);
            for (const label of lm.labels) {
              const key = keyOf(index, lm.task, label.value);
              structures[key] = {
                key,
                series: index,
                task: lm.task,
                value: label.value,
                name: label.name,
                rawClass: label.rawClass,
                color: labelColor(label),
                visible: true,
                voxels: label.voxels,
                volumeMl: (label.voxels * vox) / 1000,
                superior: null,
                slices: null,
              };
            }
            return {
              series: index,
              task: lm.task,
              title: taskTitle(lm.task),
              visible,
              status: 'waiting',
              reason: null,
              structures: lm.labels.map(l => keyOf(index, lm.task, l.value)),
            };
          });
      return {
        index,
        description: seriesDescription(s),
        withheld: s.withheld,
        unnamed: s.unnamed,
        invalid: s.invalid,
        tasks,
      };
    });
    const drawable = series.some(s => s.tasks.length > 0);
    set({ phase: drawable ? 'ready' : 'none', reason: null, series, structures, notes });
    if (!drawable) {
      return;
    }
    // Shown tasks first, so the default view appears soonest; one file at a time.
    const queue: Array<[number, RsAnatomyLabelmap]> = [];
    for (const view of series) {
      for (const t of view.tasks) {
        const lm = anatomy.series[view.index].labelmaps.find(l => l.task === t.task);
        if (lm) {
          queue.push([view.index, lm]);
        }
      }
    }
    queue.sort((a, b) => Number(isContainerTask(a[1].task)) - Number(isContainerTask(b[1].task)));
    // (An index loop: this build's regenerator takes no for-of around an await.)
    for (let n = 0; n < queue.length; n++) {
      if (gen !== generation) {
        return;
      }
      const [index, lm] = queue[n];
      await loadLabelmap(gen, uid, index, anatomy.series[index], lm);
    }
  }

  function reset() {
    generation++;
    doc = null;
    loaded.clear();
    fits.clear();
    renderCache = { revision: -1, sets: new Map() };
  }

  function findStructure(key: string | null): AnatomyStructure | null {
    return key ? (state.structures[key] ?? null) : null;
  }

  function seriesIndexOf(seriesUID: string): number | null {
    if (!doc || !seriesUID) {
      return null;
    }
    const index = doc.series.findIndex(s => s.seriesUID === seriesUID);
    if (index < 0) {
      return null;
    }
    const view = state.series[index];
    return view && view.tasks.some(t => t.status === 'ready') ? index : null;
  }

  function buildRenderSet(index: number): AnatomyRenderSet | null {
    const s = doc?.series[index];
    const view = state.series[index];
    if (!s || !s.grid || !view) {
      return null;
    }
    const toIndex = indexFromLps(s.grid.affineRAS);
    if (!toIndex) {
      return null;
    }
    const layers: RenderLayer[] = [];
    const tasks: string[] = [];
    // Bottom first: the cavities under the organs they contain, then the document's order.
    const order = [...view.tasks].sort(
      (a, b) => Number(isContainerTask(b.task)) - Number(isContainerTask(a.task))
    );
    for (const t of order) {
      const layer = loaded.get(taskKey(index, t.task));
      if (!t.visible || t.status !== 'ready' || !layer) {
        continue;
      }
      layers.push({
        data: layer.data.data,
        origin: layer.data.origin,
        size: layer.data.size,
        colors: layer.colors,
      });
      tasks.push(t.task);
    }
    const { fill, edge } = alphasFor(state.settings);
    const strong = findStructure(state.hovered ?? state.selected);
    const hlLayer = strong && strong.series === index ? tasks.indexOf(strong.task) : -1;
    return {
      series: index,
      indexFromLps: toIndex,
      shape: s.grid.shape,
      layers,
      tasks,
      fillAlpha: fill,
      edgeAlpha: edge,
      highlight: hlLayer >= 0 && strong?.visible ? { layer: hlLayer, value: strong.value } : null,
      revision: state.revision,
    };
  }

  const store: AnatomyStore = {
    enter(next) {
      if (!next || (next === study && state.phase !== 'idle' && state.phase !== 'failed')) {
        return;
      }
      reset();
      study = next;
      state = {
        ...INITIAL,
        settings: state.settings,
        phase: 'loading',
        revision: state.revision + 1,
      };
      emit();
      void load(next, generation);
    },
    leave() {
      reset();
      study = null;
      state = { ...INITIAL, settings: state.settings, revision: state.revision + 1 };
      emit();
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled(enabled) {
      if (enabled !== state.settings.enabled) {
        const settings = { ...state.settings, enabled };
        saveSettings(settings);
        set({ settings });
      }
    },
    setOpacity(opacity) {
      const value = clampOpacity(opacity);
      if (value !== state.settings.opacity) {
        const settings = { ...state.settings, opacity: value };
        saveSettings(settings);
        set({ settings });
      }
    },
    setStyle(style) {
      if (style !== state.settings.style && (style === 'fill' || style === 'outline')) {
        const settings = { ...state.settings, style };
        saveSettings(settings);
        set({ settings });
      }
    },
    setTaskVisible(series, task, visible) {
      const t = state.series[series]?.tasks.find(x => x.task === task);
      if (t && t.visible !== visible) {
        set({ series: updateTask(series, task, { visible }) });
      }
    },
    setStructureVisible(key, visible) {
      const s = state.structures[key];
      if (!s || s.visible === visible) {
        return;
      }
      const structures = { ...state.structures, [key]: { ...s, visible } };
      refreshColors(s.series, s.task, structures);
      set({ structures });
    },
    select(key) {
      if (key === null) {
        if (state.selected !== null) {
          set({ selected: null });
        }
        return;
      }
      const s = state.structures[key];
      if (!s) {
        return;
      }
      counts.selections++;
      let structures = state.structures;
      if (!s.visible) {
        structures = { ...structures, [key]: { ...s, visible: true } };
        refreshColors(s.series, s.task, structures);
      }
      const settings = state.settings.enabled
        ? state.settings
        : { ...state.settings, enabled: true };
      if (settings !== state.settings) {
        saveSettings(settings);
      }
      const t = state.series[s.series]?.tasks.find(x => x.task === s.task);
      const series =
        t && !t.visible ? updateTask(s.series, s.task, { visible: true }) : state.series;
      set({ selected: key, structures, settings, series });
      const target = targetOf(s);
      if (target && navigate) {
        counts.jumps++;
        if (!navigate(target)) {
          counts.jumpMisses++;
        }
      }
    },
    hover(key) {
      const next = key && state.structures[key] ? key : null;
      if (next !== state.hovered) {
        set({ hovered: next });
      }
    },
    setNavigator(fn) {
      navigate = typeof fn === 'function' ? fn : null;
    },
    seriesOf: seriesIndexOf,
    renderSetFor(seriesUID) {
      const index = seriesIndexOf(seriesUID);
      if (index === null || !state.settings.enabled) {
        return null;
      }
      const fit = fits.get(seriesUID);
      if (fit && !fit.fits) {
        return null;
      }
      if (renderCache.revision !== state.revision) {
        renderCache = { revision: state.revision, sets: new Map() };
      }
      let rs = renderCache.sets.get(index);
      if (!rs) {
        rs = buildRenderSet(index) ?? undefined;
        if (rs) {
          renderCache.sets.set(index, rs);
        }
      }
      return rs ?? null;
    },
    structuresAt(seriesUID, world) {
      const rs = store.renderSetFor(seriesUID);
      if (!rs || !rs.layers.length) {
        return [];
      }
      const point = applyPoint(rs.indexFromLps, world);
      return labelsAt(rs.layers, point)
        .map(([layer, value]) => state.structures[keyOf(rs.series, rs.tasks[layer], value)])
        .filter((s): s is AnatomyStructure => Boolean(s));
    },
    reportFit(seriesUID, fit) {
      const before = fits.get(seriesUID);
      fits.set(seriesUID, fit);
      if (!fit.fits && (!before || before.fits)) {
        set({
          notes: addNote(
            `Not drawn on one series: ${fit.reason ?? "its images are not on the labelmap's grid"}.`
          ),
        });
      }
    },
    harnessState() {
      const tasks = state.series.flatMap(s => s.tasks);
      const all = Object.values(state.structures);
      const sel = findStructure(state.selected);
      return {
        phase: state.phase,
        study: study ? deps.studyRef(study) : null,
        series: state.series.length,
        labelmaps: {
          ready: tasks.filter(t => t.status === 'ready').length,
          loading: tasks.filter(t => t.status === 'loading' || t.status === 'waiting').length,
          refused: tasks.filter(t => t.status === 'refused').length,
        },
        tasks: tasks.map(t => {
          const layer = loaded.get(taskKey(t.series, t.task));
          return {
            task: t.task,
            visible: t.visible,
            status: t.status,
            structures: t.structures.length,
            box: layer ? { origin: layer.data.origin, size: layer.data.size } : null,
          };
        }),
        structures: all.length,
        visibleStructures: all.filter(s => s.visible).length,
        settings: { ...state.settings },
        selected: sel ? `${sel.task}/${sel.value}` : null,
        selectedSlices: sel?.slices ?? null,
        notes: state.notes.length,
        counts: { ...counts },
      };
    },
  };

  function targetOf(s: AnatomyStructure): AnatomyTarget | null {
    const series = doc?.series[s.series];
    const layer = loaded.get(taskKey(s.series, s.task));
    const st = layer?.data.stats.get(s.value);
    if (!series?.grid || !st) {
      return null;
    }
    return {
      key: s.key,
      seriesUID: series.seriesUID,
      point: applyPoint(lpsFromIndex(series.grid.affineRAS), st.bestPoint),
    };
  }

  return store;
}
