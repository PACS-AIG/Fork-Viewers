/**
 * RS-38, the refine tool: the CT reading system's refine contract, as the
 * viewer reads and writes it.
 *
 * A reader has SAM2CT redraw a lesion's outline (FINAL_SPEC §2.4; the reading
 * system's D-117). They mark the lesion with a box or a click; the viewer
 * sends a refine request naming the lesion's live revisions; the answer holds
 * SAM2CT's outline; kept, it becomes the lesion's next outline.
 *
 *   GET  /studies/{uid}/refine_targets   the lesions a reader may refine: each
 *        one's observation, its series and grid, the revisions a request
 *        names, and its current outline (in the packed form /segment answers);
 *   POST /segment                        one refine (mode "refine"): 200 with
 *        the result (ok, failed or unavailable), its mask and its id; 409 stale
 *        (with the current revision); 422 refused (the reason); 503 when the
 *        archive did not give the series' pixels;
 *   POST /events  refine_keep            the reader keeps a result by its id.
 *
 * The routes and fields follow the refine plan's proposal to ct-analysis-system
 * (26 Nov 2026); that repository's contract note settles them. A reader of an
 * older minor ignores fields it does not know; an entry this viewer cannot read
 * is left out (counted), never drawn.
 *
 * Pure: no window, React or OHIF here.
 */
import { readGrid, type RsAnatomyGrid } from '../anatomy/anatomyContract';
import type { Vec3 } from '../anatomy/anatomyGeometry';
import { RsRefused, checkDocument, type RsEnvelope, type RsMode } from '../rsContract';

export const REFINE_TARGETS_ARTIFACT = 'refine_targets';

/** The marks this tool draws, as the contract names their prompt types. */
export const TOOL_PROMPT_TYPES = ['box', 'point'] as const;
export type RefinePromptType = (typeof TOOL_PROMPT_TYPES)[number];

/** A refine's budget: one pass, and the server gives up before the proxy does (55 s). */
export const REFINE_BUDGET = Object.freeze({ max_passes: 1, timeout_s: 45 });

/** The largest packed outline read (bytes): far above a lesion's box. */
export const MAX_MASK_BYTES = 32 * 1024 * 1024;

/** (slice, row, column), as a grid's shape orders them. */
export type IndexTriple = [number, number, number];

export interface RefineMask {
  /** Its first voxel and one past its last, (slice, row, column). */
  box: [IndexTriple, IndexTriple];
  /**
   * The voxels inside the box, slice by slice, row by row, column by column,
   * packed eight to a byte (the first voxel in the highest bit): base64.
   */
  bits: string;
  digest: string;
  voxels: number | null;
}

/** Where a lesion with no outline yet lies: a detector's box (two corners) or point, LPS mm. */
export interface RefineGeometry {
  type: 'box' | 'point';
  world: Vec3[];
}

export interface RefineTarget {
  observationId: string;
  findingId: string | null;
  /** The report entry it is, or null for a candidate the report does not name. */
  entryId: string | null;
  kind: 'finding' | 'candidate';
  /** What the reader is told it is: its organ or location, never a model's class. */
  label: string;
  seriesRef: string;
  seriesUID: string;
  frameOfReferenceUID: string;
  grid: RsAnatomyGrid;
  seriesRevision: number;
  observationRevision: number;
  /** Its current outline's revision, or null when it has none yet. */
  maskRevision: number | null;
  mask: RefineMask | null;
  geometry: RefineGeometry | null;
  task: string;
  recipeId: string;
  promptTypes: string[];
}

export interface RefineTargets extends RsEnvelope {
  artifact: 'refine_targets';
  targets: RefineTarget[];
  /** Entries this viewer could not read: left out, never drawn. */
  dropped: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const textOrNull = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : (text(v) ?? undefined);
const revision = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function triple(v: unknown): IndexTriple | null {
  return Array.isArray(v) && v.length === 3 && v.every(n => Number.isInteger(n))
    ? [v[0], v[1], v[2]]
    : null;
}

function point(v: unknown): Vec3 | null {
  return Array.isArray(v) && v.length === 3 && v.every(finite) ? [v[0], v[1], v[2]] : null;
}

/** How many bytes a base64 string decodes to, or -1 when it is not base64. */
export function base64Length(s: string): number {
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    return -1;
  }
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

/** The voxels in a box. */
export const boxVoxels = (box: [IndexTriple, IndexTriple]): number =>
  (box[1][0] - box[0][0]) * (box[1][1] - box[0][1]) * (box[1][2] - box[0][2]);

/**
 * A packed outline on a grid of this shape, or null when there is none, or
 * 'invalid': its box must lie inside the grid and its bits cover the box
 * exactly. A `shape`, when it comes with it (the /segment answer's), must be
 * the grid's.
 */
export function readMask(v: unknown, shape: IndexTriple): RefineMask | null | 'invalid' {
  if (v === null || v === undefined) {
    return null;
  }
  if (!isObject(v)) {
    return 'invalid';
  }
  if (v.shape !== undefined) {
    const s = triple(v.shape);
    if (!s || s[0] !== shape[0] || s[1] !== shape[1] || s[2] !== shape[2]) {
      return 'invalid';
    }
  }
  const b = v.box;
  if (!Array.isArray(b) || b.length !== 2) {
    return 'invalid';
  }
  const lo = triple(b[0]);
  const hi = triple(b[1]);
  if (!lo || !hi) {
    return 'invalid';
  }
  for (let a = 0; a < 3; a++) {
    if (!(lo[a] >= 0 && hi[a] > lo[a] && hi[a] <= shape[a])) {
      return 'invalid';
    }
  }
  const box: [IndexTriple, IndexTriple] = [lo, hi];
  const bytes = Math.ceil(boxVoxels(box) / 8);
  if (typeof v.bits !== 'string' || bytes > MAX_MASK_BYTES || base64Length(v.bits) !== bytes) {
    return 'invalid';
  }
  const digest = text(v.digest);
  if (!digest) {
    return 'invalid';
  }
  return {
    box,
    bits: v.bits,
    digest,
    voxels: revision(v.voxels),
  };
}

function readGeometry(v: unknown): RefineGeometry | null | 'invalid' {
  if (v === null || v === undefined) {
    return null;
  }
  if (!isObject(v) || (v.type !== 'box' && v.type !== 'point') || !Array.isArray(v.world_mm)) {
    return 'invalid';
  }
  const world = v.world_mm.map(point);
  if (world.some(p => p === null) || world.length !== (v.type === 'box' ? 2 : 1)) {
    return 'invalid';
  }
  return { type: v.type, world: world as Vec3[] };
}

/** One entry of the targets document, or null when this viewer cannot read it. */
export function readTarget(v: unknown): RefineTarget | null {
  if (!isObject(v)) {
    return null;
  }
  const observationId = text(v.observationId);
  const seriesRef = text(v.seriesRef);
  const seriesUID = text(v.seriesUID);
  const frameOfReferenceUID = text(v.frameOfReferenceUID);
  const task = text(v.task);
  const recipeId = text(v.recipeId);
  const findingId = textOrNull(v.findingId);
  const entryId = textOrNull(v.entryId);
  const seriesRevision = revision(v.seriesRevision);
  const observationRevision = revision(v.observationRevision);
  const maskRevision = v.maskRevision === null ? null : revision(v.maskRevision);
  const grid = readGrid(v.grid);
  if (
    !observationId ||
    !seriesRef ||
    !seriesUID ||
    !frameOfReferenceUID ||
    !task ||
    !recipeId ||
    findingId === undefined ||
    entryId === undefined ||
    seriesRevision === null ||
    observationRevision === null ||
    (v.maskRevision !== null && maskRevision === null) ||
    (v.kind !== 'finding' && v.kind !== 'candidate') ||
    !grid ||
    grid === 'invalid' ||
    !Array.isArray(v.promptTypes)
  ) {
    return null;
  }
  const mask = readMask(v.mask, grid.shape);
  const geometry = readGeometry(v.geometry);
  if (mask === 'invalid' || geometry === 'invalid' || (!mask && !geometry)) {
    return null;
  }
  // An outline names its revision, and a revision its outline.
  if ((mask === null) !== (maskRevision === null)) {
    return null;
  }
  return {
    observationId,
    findingId,
    entryId,
    kind: v.kind,
    label: text(v.label) ?? 'lesion',
    seriesRef,
    seriesUID,
    frameOfReferenceUID,
    grid,
    seriesRevision,
    observationRevision,
    maskRevision,
    mask,
    geometry,
    task,
    recipeId,
    promptTypes: v.promptTypes.filter((t): t is string => typeof t === 'string'),
  };
}

/** The targets document, checked as every document is (rsContract.checkDocument). */
export function readRefineTargets(doc: unknown, mode: RsMode): RefineTargets {
  const d = checkDocument<RsEnvelope & { targets?: unknown }>(doc, REFINE_TARGETS_ARTIFACT, mode);
  if (!Array.isArray(d.targets)) {
    throw new RsRefused('The CT analysis service sent refine targets without a target list.');
  }
  const targets: RefineTarget[] = [];
  let dropped = 0;
  for (const t of d.targets) {
    const read = readTarget(t);
    if (read) {
      targets.push(read);
    } else {
      dropped++;
    }
  }
  return { ...d, artifact: 'refine_targets', targets, dropped };
}

/** Whether a target's recipe takes this tool's mark. */
export const takesPrompt = (target: RefineTarget, type: RefinePromptType): boolean =>
  target.promptTypes.includes(type);

// ---- the refine request (POST /segment) ------------------------------------------

/** The reader's mark, in LPS mm on one of the target's slices. */
export interface RefinePrompt {
  type: RefinePromptType;
  world: Vec3[];
}

export interface SegmentRequest {
  mode: 'refine';
  seriesRef: string;
  series_revision: number;
  parent_observation_id: string;
  parent_observation_revision: number;
  base_mask_revision: number | null;
  prompt: {
    type: RefinePromptType;
    world_mm: Vec3[];
    frameOfReferenceUID: string;
    polarity?: Array<'positive' | 'negative'>;
  };
  recipe_id: string;
  task: string;
  alternative: false;
  budget: { max_passes: number; timeout_s: number };
  /** Who asked: the app's proxy writes the signed-in reader's id here. */
  reader: { id: string; role: string };
}

/**
 * A reader's refine of this target: the task's own recipe, not an alternate
 * (none can run yet), with the reader's mark; a click is one positive point.
 */
export function buildSegmentRequest(
  target: RefineTarget,
  prompt: RefinePrompt,
  reader: { id: string; role: string }
): SegmentRequest {
  if (prompt.type === 'box' ? prompt.world.length !== 2 : prompt.world.length !== 1) {
    throw new Error(
      `a ${prompt.type} prompt has ${prompt.type === 'box' ? 'two corners' : 'one point'}`
    );
  }
  return {
    mode: 'refine',
    seriesRef: target.seriesRef,
    series_revision: target.seriesRevision,
    parent_observation_id: target.observationId,
    parent_observation_revision: target.observationRevision,
    base_mask_revision: target.maskRevision,
    prompt: {
      type: prompt.type,
      world_mm: prompt.world.map(p => [p[0], p[1], p[2]] as Vec3),
      frameOfReferenceUID: target.frameOfReferenceUID,
      ...(prompt.type === 'point' ? { polarity: ['positive' as const] } : {}),
    },
    recipe_id: target.recipeId,
    task: target.task,
    alternative: false,
    budget: { ...REFINE_BUDGET },
    reader: { id: reader.id, role: reader.role },
  };
}

// ---- its answer ------------------------------------------------------------------

export interface RefineQc {
  slices: number | null;
  components: number | null;
  partialVolume: boolean;
  truncated: boolean;
  passed: boolean | null;
  failures: string[];
}

export type SegmentAnswer =
  | {
      kind: 'result';
      status: 'ok' | 'failed' | 'unavailable';
      reasons: string[];
      /** The attempt's id, which a keep names (null: the server keeps no attempts). */
      resultId: string | null;
      maskRevision: number | null;
      mask: RefineMask | null;
      qc: RefineQc | null;
      runtimeS: number | null;
    }
  | { kind: 'stale'; reason: string; current: Record<string, number> }
  | { kind: 'refused'; reason: string }
  | { kind: 'no_pixels'; reason: string };

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

function readQc(v: unknown): RefineQc | null {
  if (!isObject(v)) {
    return null;
  }
  return {
    slices: revision(v.slices),
    components: revision(v.components),
    partialVolume: v.partial_volume === true,
    truncated: v.truncated_at_crop === true || v.truncated_at_volume_edge === true,
    passed: typeof v.passed === 'boolean' ? v.passed : null,
    failures: strings(v.failures),
  };
}

/**
 * The /segment answer for this HTTP status, read against the target's grid,
 * or null when it is not one the contract gives (the caller says so).
 */
export function readSegmentAnswer(
  status: number,
  body: unknown,
  shape: IndexTriple
): SegmentAnswer | null {
  if (status === 409) {
    const b = isObject(body) ? body : {};
    const current: Record<string, number> = {};
    if (isObject(b.current)) {
      for (const [k, n] of Object.entries(b.current)) {
        if (revision(n) !== null) {
          current[k] = n as number;
        }
      }
    }
    return {
      kind: 'stale',
      reason: text(b.reason) ?? 'the lesion changed since this page read it',
      current,
    };
  }
  if (status === 422) {
    const b = isObject(body) ? body : {};
    return { kind: 'refused', reason: text(b.reason) ?? 'the CT analysis service refused it' };
  }
  if (status === 503) {
    return { kind: 'no_pixels', reason: 'the archive did not give the series’ images' };
  }
  if (status !== 200 || !isObject(body) || !isObject(body.result)) {
    return null;
  }
  const r = body.result;
  if (r.status !== 'ok' && r.status !== 'failed' && r.status !== 'unavailable') {
    return null;
  }
  const mask = readMask(body.mask, shape);
  if (mask === 'invalid') {
    return null;
  }
  const timing = isObject(r.timing) ? r.timing : {};
  const okWithoutOutline = r.status === 'ok' && !mask;
  return {
    kind: 'result',
    status: okWithoutOutline ? 'failed' : r.status,
    reasons: okWithoutOutline ? ['no outline came back'] : strings(r.reasons),
    resultId: text(body.resultId),
    maskRevision: revision(r.mask_revision),
    mask,
    qc: readQc(r.qc),
    runtimeS: finite(timing.runtime_s) ? timing.runtime_s : null,
  };
}
