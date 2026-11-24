/**
 * RS-36: the other series a labelmap may be drawn on, resampled.
 *
 * A labelmap belongs to one series (its grid's), and is drawn there once that
 * series' images are checked against its grid. The viewer often shows the same
 * acquisition again as other series: the scanner's coronal and sagittal
 * reformats, a second reconstruction kernel. Those image the same body at the
 * same moment, so the labelmap may be drawn on them too, resampled through the
 * patient's coordinates (each pixel takes its nearest voxel, so along the
 * labelmap's slice axis the outlines step by its slice spacing). A series is
 * taken only when:
 *   - it shares the labelmap series' frame of reference (the same patient
 *     coordinates, so a position means the same place in both);
 *   - it is of the same modality, and none of its images is a localizer or a
 *     projection (a MIP, a volume rendering), where a plane's labels mean
 *     nothing;
 *   - its acquisition times overlap the labelmap series' (to 2 s: a reformat
 *     carries the time of its first source image, which may be written to the
 *     whole second, or come from a reconstruction a little longer than the
 *     labelmap series').
 * Another phase of the same examination (arterial and venous, say) shares the
 * frame of reference but not the moment: the organs move with each breath
 * hold, so it is never taken.
 *
 * Pure: the overlay hands over each series' instances (OHIF's naturalized
 * DICOM attributes).
 */

/** How far apart two series' acquisition times may lie and still overlap, in seconds. */
export const ACQUISITION_MARGIN_S = 2;

export interface SeriesFacts {
  images: number;
  /** The one frame of reference of all its images (null: missing or mixed). */
  frameOfReferenceUID: string | null;
  /** The one modality of all its images (null: missing or mixed). */
  modality: string | null;
  /** Whether any image is a localizer or a projection. */
  projection: boolean;
  /** Its images' first and last acquisition time, in seconds of the day. */
  timeOfDay: [number, number] | null;
  /** The same in seconds since 1970, when every timed image has a date. */
  dated: [number, number] | null;
}

export type RelatedVerdict = { related: true; reason: null } | { related: false; reason: string };

type Instance = Record<string, unknown>;

/** A single-valued attribute as text (a naturalized value may come as a one-item array). */
function text(v: unknown): string | null {
  if (Array.isArray(v)) {
    return v.length ? text(v[0]) : null;
  }
  if (typeof v === 'string') {
    return v.trim() || null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(v);
  }
  return null;
}

/** A DICOM TM (HHMMSS.FFFFFF, or the old HH:MM:SS) as seconds of the day. */
export function timeSeconds(tm: unknown): number | null {
  let t = text(tm);
  if (t && typeof tm === 'number') {
    // A time written as a number lost its leading zeros.
    const [whole, frac] = t.split('.');
    t = whole.padStart(6, '0') + (frac ? `.${frac}` : '');
  }
  const m = t ? /^(\d{2})(?::?(\d{2})(?::?(\d{2})(\.\d+)?)?)?$/.exec(t) : null;
  if (!m) {
    return null;
  }
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) + (m[4] ? Number(m[4]) : 0) : 0;
  return h < 24 && min < 60 && s < 61 ? h * 3600 + min * 60 + s : null;
}

/** A DICOM DA (YYYYMMDD, or the old YYYY.MM.DD) as its first second since 1970. */
export function dateSeconds(da: unknown): number | null {
  const d = text(da);
  const m = d ? /^(\d{4})\.?(\d{2})\.?(\d{2})$/.exec(d) : null;
  if (!m) {
    return null;
  }
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
    ? Date.UTC(Number(m[1]), month - 1, day) / 1000
    : null;
}

/**
 * When an image was acquired: AcquisitionDateTime when it holds a time, else
 * AcquisitionDate and AcquisitionTime. Its offset from UTC is left out (two
 * series of one examination share it).
 */
export function acquisitionOf(inst: Instance): { time: number; date: number | null } | null {
  const dt = text(inst.AcquisitionDateTime);
  const m = dt ? /^(\d{8})(\d{2}[\d.]*)/.exec(dt) : null;
  if (m) {
    const time = timeSeconds(m[2]);
    if (time !== null) {
      return { time, date: dateSeconds(m[1]) };
    }
  }
  const time = timeSeconds(inst.AcquisitionTime);
  return time === null ? null : { time, date: dateSeconds(inst.AcquisitionDate) };
}

const PROJECTION_WORDS = new Set(['LOCALIZER', 'MIP', 'MINIP', 'VRT', 'PROJECTION']);

/** Whether an image's ImageType names a localizer or a projection. */
export function isProjection(imageType: unknown): boolean {
  const values = (Array.isArray(imageType) ? imageType : [imageType])
    .flatMap(v => (typeof v === 'string' ? v.split('\\') : []))
    .map(v => v.trim().toUpperCase());
  return values.some(
    v => v.includes('VOLUME REND') || v.split(/[\s_]+/).some(w => PROJECTION_WORDS.has(w))
  );
}

/** What decides whether two series are one acquisition, from their instances. */
export function seriesFacts(instances: ReadonlyArray<Instance | null | undefined>): SeriesFacts {
  let images = 0;
  let forUID: string | null | undefined;
  let modality: string | null | undefined;
  let projection = false;
  const times: number[] = [];
  const dated: number[] = [];
  let everyDated = true;
  for (const inst of instances) {
    if (!inst || typeof inst !== 'object') {
      continue;
    }
    images++;
    const f = text(inst.FrameOfReferenceUID);
    forUID = forUID === undefined ? f : forUID === f ? forUID : null;
    const mo = text(inst.Modality);
    modality = modality === undefined ? mo : modality === mo ? modality : null;
    projection = projection || isProjection(inst.ImageType);
    const at = acquisitionOf(inst);
    if (at) {
      times.push(at.time);
      if (at.date === null) {
        everyDated = false;
      } else {
        dated.push(at.date + at.time);
      }
    }
  }
  const range = (xs: number[]): [number, number] | null =>
    xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
  return {
    images,
    frameOfReferenceUID: forUID ?? null,
    modality: modality ?? null,
    projection,
    timeOfDay: range(times),
    dated: everyDated ? range(dated) : null,
  };
}

const no = (reason: string): RelatedVerdict => ({ related: false, reason });

/** Whether `other` may carry the labelmap of `native` (its own series), and if not, why. */
export function relatedVerdict(native: SeriesFacts, other: SeriesFacts): RelatedVerdict {
  if (!native.frameOfReferenceUID || other.frameOfReferenceUID !== native.frameOfReferenceUID) {
    return no('another frame of reference');
  }
  if (!native.modality || other.modality !== native.modality) {
    return no('another modality');
  }
  if (other.projection) {
    return no('a localizer or projection');
  }
  const pair =
    native.dated && other.dated
      ? [native.dated, other.dated]
      : native.timeOfDay && other.timeOfDay
        ? [native.timeOfDay, other.timeOfDay]
        : null;
  if (!pair) {
    return no('no acquisition time');
  }
  const [[a0, a1], [b0, b1]] = pair;
  if (b0 > a1 + ACQUISITION_MARGIN_S || b1 < a0 - ACQUISITION_MARGIN_S) {
    return no('acquired at another time');
  }
  return { related: true, reason: null };
}
