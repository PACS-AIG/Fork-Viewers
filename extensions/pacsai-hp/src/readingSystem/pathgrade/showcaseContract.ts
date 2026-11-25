/**
 * RS-36: PathGrade's research showcase (output contract 1.16, D-343), as the
 * CT analysis pane reads it.
 *
 * PathGrade cannot appear on the patient being read: no characterizer is
 * qualified, and PG-05 keeps a research-only one off the live panel. So the
 * showcase is PathGrade's work on public kidney tumours (C4KC-KiTS, permitted
 * for display), never on this patient. It belongs to no study (snapshotId and
 * studyUID null), and its use is research, always. The pane shows it in a tab
 * of its own: never a finding, never in the report or the editor.
 *
 * The API words every string (numbers come formatted, in a fact's `display`
 * and in the table cells), so the pane renders them as given. Every picture a
 * figure shows is listed in `images` with the sha256 of its bytes, which the
 * pane checks before it shows the picture.
 *
 * Read strictly where the pane relies on it: the envelope, use research, the
 * cohort with its credit and permitted use, each item of a known kind whole,
 * every figure's pictures listed. An item of a kind this viewer does not know
 * (a later minor's) is left out and counted, never guessed at. A string
 * shaped like a DICOM UID refuses the document, without quoting it (invariant
 * 21: the showcase carries none).
 *
 * Pure: no window, React or OHIF here.
 */
import { checkDocument, RsRefused, type RsEnvelope, type RsMode } from '../rsContract';

export const SHOWCASE_ARTIFACT = 'pathgrade_showcase';
/** A picture's name, as the contract allows it (the API and the app's proxy serve no other). */
export const SHOWCASE_IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\.png$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SHOWCASE_ID = /^pgs:[0-9a-f]{32}$/;
const SECTION_ID = /^[a-z][a-z0-9_]{0,47}$/;
/** Shaped like a DICOM UID: five or more numbers joined by dots (the API's own guard). */
const UID_SHAPED = /\d+(?:\.\d+){4,}/;
/** The cohort's permitted use that allows showing its pictures. */
export const PERMITTED_USE = 'retrieval_and_display';

export interface ShowcaseCohort {
  dataset: string;
  release: string;
  title: string;
  licence: string;
  credit: string;
  doi: string;
  permittedUse: string;
}

export interface ShowcaseImage {
  name: string;
  sha256: string;
  width: number;
  height: number;
  alt: string;
}

export interface ShowcasePanel {
  image: string;
  caption: string;
}

export interface ShowcaseFact {
  label: string;
  display: string;
}

export type ShowcaseItem =
  | { kind: 'figure'; panels: ShowcasePanel[]; caption: string }
  | { kind: 'facts'; facts: ShowcaseFact[] }
  | { kind: 'table'; caption: string; columns: string[]; rows: string[][] }
  | { kind: 'text'; text: string };

export interface ShowcaseSection {
  id: string;
  title: string;
  items: ShowcaseItem[];
  /** Items of a kind this viewer does not know (a later minor's), left out. */
  unknownItems: number;
}

export interface ShowcaseSource {
  kind: string;
  name: string;
  sha256: string | null;
}

export interface RsShowcase extends RsEnvelope {
  artifact: typeof SHOWCASE_ARTIFACT;
  id: string;
  use: 'research';
  task: string;
  title: string;
  notice: string;
  cohort: ShowcaseCohort;
  sources: ShowcaseSource[];
  sections: ShowcaseSection[];
  images: ShowcaseImage[];
}

/** The line that credits the cohort's pictures, from its own fields. */
export const creditLine = (c: ShowcaseCohort): string =>
  `Images: ${c.credit}, ${c.title}, DOI ${c.doi}, ${c.licence}`;

/** The figure pictures in the order the sections show them, each once. */
export function picturesShown(s: Pick<RsShowcase, 'sections'>): string[] {
  const out: string[] = [];
  for (const section of s.sections) {
    for (const item of section.items) {
      if (item.kind === 'figure') {
        item.panels.forEach(p => {
          if (!out.includes(p.image)) {
            out.push(p.image);
          }
        });
      }
    }
  }
  return out;
}

const refuse = (why: string): never => {
  throw new RsRefused(`The PathGrade showcase cannot be shown: ${why}.`);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Every string in a document, keys included. */
function anyString(v: unknown, test: (s: string) => boolean): boolean {
  if (typeof v === 'string') {
    return test(v);
  }
  if (Array.isArray(v)) {
    return v.some(x => anyString(x, test));
  }
  if (isObject(v)) {
    return Object.entries(v).some(([k, x]) => test(k) || anyString(x, test));
  }
  return false;
}

function text(v: unknown, what: string): string {
  return typeof v === 'string' && v.trim() ? v : refuse(`its ${what} is missing`);
}

const optionalText = (v: unknown, what: string): string =>
  v === undefined || v === null
    ? ''
    : typeof v === 'string'
      ? v
      : refuse(`its ${what} is not text`);

function readCohort(v: unknown): ShowcaseCohort {
  if (!isObject(v)) {
    return refuse('it names no cohort');
  }
  const c: ShowcaseCohort = {
    dataset: text(v.dataset, "cohort's dataset"),
    release: text(v.release, "cohort's release"),
    title: text(v.title, "cohort's title"),
    licence: text(v.licence, "cohort's licence"),
    credit: text(v.credit, "cohort's credit"),
    doi: text(v.doi, "cohort's DOI"),
    permittedUse: text(v.permittedUse, "cohort's permitted use"),
  };
  if (c.permittedUse !== PERMITTED_USE) {
    refuse('its cohort is not permitted for display');
  }
  return c;
}

function readImages(v: unknown): ShowcaseImage[] {
  const list = v === undefined ? [] : Array.isArray(v) ? v : refuse('its pictures are not a list');
  const out: ShowcaseImage[] = [];
  for (const x of list) {
    if (!isObject(x)) {
      return refuse('a picture is malformed');
    }
    const name = typeof x.name === 'string' && SHOWCASE_IMAGE_NAME.test(x.name) ? x.name : null;
    const sha256 = typeof x.sha256 === 'string' && SHA256.test(x.sha256) ? x.sha256 : null;
    const size = (n: unknown) =>
      typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 4096 ? n : null;
    const width = size(x.width);
    const height = size(x.height);
    const alt = typeof x.alt === 'string' && x.alt.trim() ? x.alt : null;
    if (!name || !sha256 || !width || !height || !alt) {
      return refuse('a picture is malformed');
    }
    if (out.some(i => i.name === name)) {
      return refuse('a picture is listed twice');
    }
    out.push({ name, sha256, width, height, alt });
  }
  return out;
}

function readItem(v: unknown, images: ShowcaseImage[]): ShowcaseItem | 'unknown' {
  if (!isObject(v) || typeof v.kind !== 'string') {
    return refuse('an item has no kind');
  }
  switch (v.kind) {
    case 'figure': {
      const panels =
        Array.isArray(v.panels) && v.panels.length ? v.panels : refuse('a figure has no pictures');
      return {
        kind: 'figure',
        caption: optionalText(v.caption, "figure's caption"),
        panels: panels.map(p => {
          const image = isObject(p) && typeof p.image === 'string' ? p.image : '';
          if (!SHOWCASE_IMAGE_NAME.test(image)) {
            return refuse('a figure names a picture outside the contract');
          }
          if (!images.some(i => i.name === image)) {
            return refuse('a figure shows a picture it does not list');
          }
          return {
            image,
            caption: optionalText((p as Record<string, unknown>).caption, "picture's caption"),
          };
        }),
      };
    }
    case 'facts': {
      const facts =
        Array.isArray(v.facts) && v.facts.length ? v.facts : refuse('a list of facts is empty');
      return {
        kind: 'facts',
        facts: facts.map(f => ({
          label: text(isObject(f) ? f.label : null, "fact's label"),
          display: text(isObject(f) ? f.display : null, "fact's value"),
        })),
      };
    }
    case 'table': {
      const columns =
        Array.isArray(v.columns) && v.columns.length && v.columns.every(c => typeof c === 'string')
          ? (v.columns as string[])
          : refuse('a table has no columns');
      const rows =
        v.rows === undefined ? [] : Array.isArray(v.rows) ? v.rows : refuse('a table has no rows');
      return {
        kind: 'table',
        caption: optionalText(v.caption, "table's caption"),
        columns,
        rows: rows.map(r =>
          Array.isArray(r) && r.length === columns.length && r.every(c => typeof c === 'string')
            ? (r as string[])
            : refuse('a table row does not have one cell per column')
        ),
      };
    }
    case 'text':
      return { kind: 'text', text: text(v.text, 'text') };
    default:
      return 'unknown';
  }
}

function readSections(v: unknown, images: ShowcaseImage[]): ShowcaseSection[] {
  const list = Array.isArray(v) && v.length ? v : refuse('it has no sections');
  return list.map(s => {
    if (!isObject(s) || typeof s.id !== 'string' || !SECTION_ID.test(s.id)) {
      return refuse('a section is malformed');
    }
    const items = Array.isArray(s.items) && s.items.length ? s.items : refuse('a section is empty');
    const read = items.map(i => readItem(i, images));
    return {
      id: s.id,
      title: text(s.title, "section's title"),
      items: read.filter((i): i is ShowcaseItem => i !== 'unknown'),
      unknownItems: read.filter(i => i === 'unknown').length,
    };
  });
}

function readSources(v: unknown): ShowcaseSource[] {
  const list = Array.isArray(v) ? v : [];
  return list
    .filter(isObject)
    .filter(s => typeof s.kind === 'string' && typeof s.name === 'string' && s.kind && s.name)
    .map(s => ({
      kind: s.kind as string,
      name: s.name as string,
      sha256: typeof s.sha256 === 'string' && SHA256.test(s.sha256) ? s.sha256 : null,
    }));
}

/** The showcase document, checked as the pane relies on it. Throws RsRefused. */
export function readShowcase(doc: unknown, mode: RsMode): RsShowcase {
  const env = checkDocument<RsEnvelope & Record<string, unknown>>(doc, SHOWCASE_ARTIFACT, mode);
  if (anyString(doc, s => UID_SHAPED.test(s))) {
    refuse('it holds a string shaped like a DICOM UID');
  }
  if (env.snapshotId !== null || env.studyUID !== null) {
    refuse('it names a study, and a showcase belongs to none');
  }
  if (env.use !== 'research') {
    refuse('its use is not research');
  }
  if (typeof env.id !== 'string' || !SHOWCASE_ID.test(env.id)) {
    refuse('its id is malformed');
  }
  const images = readImages(env.images);
  return {
    contractVersion: env.contractVersion,
    artifact: SHOWCASE_ARTIFACT,
    snapshotId: null,
    studyUID: null,
    bundleHash: env.bundleHash,
    mode: env.mode,
    id: env.id as string,
    use: 'research',
    task: text(env.task, 'task'),
    title: text(env.title, 'title'),
    notice: text(env.notice, 'notice'),
    cohort: readCohort(env.cohort),
    sources: readSources(env.sources),
    sections: readSections(env.sections, images),
    images,
  };
}
