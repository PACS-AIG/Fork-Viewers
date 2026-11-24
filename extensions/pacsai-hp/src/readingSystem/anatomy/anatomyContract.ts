/**
 * RS-36: the reading system's anatomy artifact (output contract 1.10), as the
 * CT analysis pane reads it.
 *
 * Per series with a TotalSegmentator run, the document gives the series' native
 * grid (its shape and the affine from (column, row, slice) indices to RAS
 * millimetres in the series' frame of reference) and one labelmap per task: a
 * NIfTI-1 file with gzip, and the labels it holds. They are display and
 * navigation layers. The viewer never loads them into OHIF's segmentation
 * state, so they never reach the segmentation panel or a SEG export, and it
 * draws only the labels a document lists (the unnamed proposals are counted,
 * never drawn).
 *
 * Only the fields the pane uses are typed here, and a reader of an older minor
 * ignores fields it does not know. A series whose entry is malformed is kept
 * with the reason and draws nothing: a series never shows part of its set.
 *
 * Pure: no window, React or OHIF here.
 */
import { checkDocument, type RsEnvelope, type RsMode } from '../rsContract';
import { det3, type Mat4 } from './anatomyGeometry';

export const ANATOMY_ARTIFACT = 'anatomy';

/** A labelmap's path under its study (`anatomy/<n>.<task>.labels.nii.gz`); group 1 is its file name. */
export const LABELMAP_FILE = /^anatomy\/([0-9]{1,4}\.[a-z0-9_]{1,64}\.labels\.nii\.gz)$/;
const TASK = /^[a-z0-9_]{1,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** A DICOM UID's characters (never shown, only matched against the viewer's series). */
const UID = /^[0-9.]{1,64}$/;
/** The largest grid side the viewer takes. */
export const MAX_GRID_SIDE = 4096;

export type LabelmapDatatype = 'uint8' | 'uint16';

export interface RsAnatomyLabel {
  /** The voxel value that holds it in its labelmap. */
  value: number;
  /**
   * The document's display phrase, or, where it gives none (null for some
   * concepts on dev: the vertebrae, the cavities, the hips), one made here
   * from its concept or class (phraseOf).
   */
  name: string;
  /** Whether the document gave the display phrase. */
  phraseGiven: boolean;
  concept: string | null;
  /** TotalSegmentator's own class name. */
  rawClass: string | null;
  voxels: number;
}

/**
 * A readable phrase for a concept or class id, made at run time: `hip_left`
 * -> "left hip", `vertebrae_L1` -> "L1 vertebra", `abdominal_cavity` ->
 * "abdominal cavity". Empty for an id with no letters.
 */
export function phraseOf(id: string | null | undefined): string {
  if (typeof id !== 'string') {
    return '';
  }
  const level = /(?:^|_)vertebra(?:e)?_?([ctls]\d{1,2})$/i.exec(id.trim());
  if (level) {
    return `${level[1].toUpperCase()} vertebra`;
  }
  const words = id
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!words.some(w => /[a-z]/.test(w))) {
    return '';
  }
  const sides = words.filter(w => w === 'left' || w === 'right');
  return [...sides, ...words.filter(w => w !== 'left' && w !== 'right')].join(' ');
}

export interface RsAnatomyLabelmap {
  task: string;
  /** As the document names it: `anatomy/<n>.<task>.labels.nii.gz`. */
  file: string;
  /** The file's name under `anatomy/`, for the route. */
  basename: string;
  sha256: string;
  datatype: LabelmapDatatype;
  labels: RsAnatomyLabel[];
}

export interface RsAnatomyGrid {
  /** (slices, rows, columns) */
  shape: [number, number, number];
  /** Row-major 4 x 4, from (column, row, slice) indices to RAS mm. */
  affineRAS: Mat4;
}

export interface RsAnatomySeries {
  seriesKey: string;
  seriesUID: string;
  frameOfReferenceUID: string | null;
  grid: RsAnatomyGrid | null;
  labelmaps: RsAnatomyLabelmap[];
  /** Why the series has no labelmaps, as the document says. */
  withheld: string | null;
  /** How many unnamed proposals were left undrawn. */
  unnamed: number;
  /** Why the viewer cannot draw this series' entry (malformed), or null. */
  invalid: string | null;
}

export interface RsAnatomy extends RsEnvelope {
  series: RsAnatomySeries[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** A 4 x 4 of finite numbers whose last row is (0, 0, 0, 1) and whose 3 x 3 part is invertible. */
export function readAffine(v: unknown): Mat4 | null {
  if (!Array.isArray(v) || v.length !== 4) {
    return null;
  }
  const rows: number[][] = [];
  for (const row of v) {
    if (!Array.isArray(row) || row.length !== 4) {
      return null;
    }
    if (!row.every(x => typeof x === 'number' && Number.isFinite(x))) {
      return null;
    }
    rows.push(row.map(Number));
  }
  const last = rows[3];
  if (
    Math.abs(last[0]) > 1e-9 ||
    Math.abs(last[1]) > 1e-9 ||
    Math.abs(last[2]) > 1e-9 ||
    Math.abs(last[3] - 1) > 1e-9
  ) {
    return null;
  }
  if (!(Math.abs(det3(rows)) > 1e-9)) {
    return null;
  }
  return rows;
}

function readGrid(v: unknown): RsAnatomyGrid | null | 'invalid' {
  if (v === null || v === undefined) {
    return null;
  }
  if (!isObject(v)) {
    return 'invalid';
  }
  const shape = v.shape;
  if (
    !Array.isArray(shape) ||
    shape.length !== 3 ||
    !shape.every(n => Number.isInteger(n) && n > 0 && n <= MAX_GRID_SIDE)
  ) {
    return 'invalid';
  }
  const affine = readAffine(v.affineRAS);
  if (!affine) {
    return 'invalid';
  }
  return { shape: [shape[0], shape[1], shape[2]], affineRAS: affine };
}

function readLabels(v: unknown, datatype: LabelmapDatatype): RsAnatomyLabel[] | string {
  if (!Array.isArray(v)) {
    return 'its labels are not a list';
  }
  const most = datatype === 'uint8' ? 255 : 65535;
  const seen = new Set<number>();
  const labels: RsAnatomyLabel[] = [];
  for (const raw of v) {
    if (!isObject(raw)) {
      return 'a label is not an object';
    }
    const value = raw.value;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > most) {
      return `a label's value is not 1 to ${most}`;
    }
    if (seen.has(value)) {
      return 'two labels share a value';
    }
    seen.add(value);
    const concept = typeof raw.concept === 'string' ? raw.concept : null;
    const rawClass = typeof raw.rawClass === 'string' ? raw.rawClass : null;
    const given = typeof raw.name === 'string' ? raw.name.trim().slice(0, 200) : '';
    const name = given || phraseOf(concept) || phraseOf(rawClass) || `label ${value}`;
    if (!isCount(raw.voxels)) {
      return "a label's voxel count is not a count";
    }
    labels.push({
      value,
      name,
      phraseGiven: Boolean(given),
      concept,
      rawClass,
      voxels: raw.voxels,
    });
  }
  return labels;
}

function readLabelmap(v: unknown): RsAnatomyLabelmap | string {
  if (!isObject(v)) {
    return 'a labelmap is not an object';
  }
  const task = typeof v.task === 'string' ? v.task : '';
  if (!TASK.test(task)) {
    return 'a labelmap names no task';
  }
  const file = typeof v.file === 'string' ? v.file : '';
  const m = LABELMAP_FILE.exec(file);
  if (!m) {
    return `the ${task} labelmap's file is not anatomy/<n>.<task>.labels.nii.gz`;
  }
  const sha256 = typeof v.sha256 === 'string' ? v.sha256.toLowerCase() : '';
  if (!SHA256.test(sha256)) {
    return `the ${task} labelmap has no sha256`;
  }
  const datatype = v.datatype;
  if (datatype !== 'uint8' && datatype !== 'uint16') {
    return `the ${task} labelmap's datatype is not uint8 or uint16`;
  }
  const labels = readLabels(v.labels, datatype);
  if (typeof labels === 'string') {
    return `the ${task} labelmap: ${labels}`;
  }
  return { task, file, basename: m[1], sha256, datatype, labels };
}

/** How many unnamed proposals: a count, or the length of a list, or the sum of a map's counts. */
function readUnnamed(v: unknown): number {
  if (isCount(v)) {
    return v;
  }
  if (Array.isArray(v)) {
    return v.length;
  }
  if (isObject(v)) {
    return Object.values(v).reduce<number>((n, x) => n + (isCount(x) ? x : 0), 0);
  }
  return 0;
}

function readSeries(v: unknown): RsAnatomySeries | null {
  if (!isObject(v)) {
    return null;
  }
  const seriesUID = typeof v.seriesUID === 'string' ? v.seriesUID.trim() : '';
  const base: RsAnatomySeries = {
    seriesKey: typeof v.seriesKey === 'string' ? v.seriesKey : '',
    seriesUID,
    frameOfReferenceUID:
      typeof v.frameOfReferenceUID === 'string' && UID.test(v.frameOfReferenceUID)
        ? v.frameOfReferenceUID
        : null,
    grid: null,
    labelmaps: [],
    withheld:
      typeof v.labelmapsWithheld === 'string' && v.labelmapsWithheld.trim()
        ? v.labelmapsWithheld.trim()
        : null,
    unnamed: readUnnamed(v.unnamed),
    invalid: null,
  };
  if (!UID.test(seriesUID)) {
    return { ...base, invalid: 'it names no series' };
  }
  const grid = readGrid(v.grid);
  if (grid === 'invalid') {
    return { ...base, invalid: 'its grid is not a shape and an invertible affine' };
  }
  base.grid = grid;
  const raw = v.labelmaps;
  if (raw === undefined || raw === null) {
    return base;
  }
  if (!Array.isArray(raw)) {
    return { ...base, invalid: 'its labelmaps are not a list' };
  }
  const labelmaps: RsAnatomyLabelmap[] = [];
  const tasks = new Set<string>();
  for (const item of raw) {
    const lm = readLabelmap(item);
    if (typeof lm === 'string') {
      return { ...base, invalid: lm };
    }
    if (tasks.has(lm.task)) {
      return { ...base, invalid: `two labelmaps are both ${lm.task}` };
    }
    tasks.add(lm.task);
    labelmaps.push(lm);
  }
  if (labelmaps.length && !grid) {
    return { ...base, invalid: 'it has labelmaps but no grid' };
  }
  return { ...base, labelmaps };
}

/**
 * The anatomy document, checked against the contract's rules for a consumer
 * (this major, this viewer's mode, the artifact) and read into the pane's
 * shape. Throws RsRefused when the document itself is refused.
 */
export function readAnatomy(doc: unknown, mode: RsMode): RsAnatomy {
  const env = checkDocument<RsEnvelope & { series?: unknown }>(doc, ANATOMY_ARTIFACT, mode);
  const list = Array.isArray(env.series) ? env.series : [];
  const series: RsAnatomySeries[] = [];
  for (const item of list) {
    const s = readSeries(item);
    if (s) {
      series.push(s);
    }
  }
  return {
    contractVersion: env.contractVersion,
    artifact: env.artifact,
    snapshotId: env.snapshotId ?? null,
    studyUID: env.studyUID ?? null,
    bundleHash: env.bundleHash,
    mode: env.mode,
    series,
  };
}
