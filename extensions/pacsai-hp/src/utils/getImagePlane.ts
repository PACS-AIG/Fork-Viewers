/**
 * Computes the plane of a display set as 'axial' | 'coronal' | 'sagittal' |
 * undefined.
 *
 * Order of evidence:
 *  1. An explicit plane word in SeriesDescription (AX/COR/SAG/axial/...). This is
 *     the tech's label and is reliable when present — and avoids being fooled by a
 *     stray localizer instance whose orientation differs from the series' intent.
 *  2. ImageOrientationPatient of a representative (middle, non-localizer) instance.
 *     Axial = slice normal dominantly along patient S-I. Coronal vs sagittal,
 *     however, is AMBIGUOUS in patient coordinates for oblique head reformats (head
 *     tilted in the scanner): a coronal reformat can have a larger patient-X normal
 *     component than patient-Y. So coronal/sagittal are disambiguated RELATIVE to
 *     the study's own axial reformat (the head frame), when siblings are provided —
 *     project the normal onto the axial reformat's row (head L-R) vs column (head
 *     A-P). Falls back to patient dominant axis otherwise.
 *  3. ImageType text (e.g. DERIVED\PRIMARY\AXIAL\...).
 *
 * Registered as the `pacsaiPlane` custom hanging-protocol attribute (the extension
 * passes the study's display sets as `siblings`).
 */
export type ImagePlane = 'axial' | 'coronal' | 'sagittal';

// Word-boundary keywords so "coronary" !== coronal, "max" !== axial, etc.
function planeFromText(text: string): ImagePlane | undefined {
  if (/\bsag\b|sagittal/i.test(text)) {
    return 'sagittal';
  }
  if (/\bcor\b|\bcoro\b|coronal/i.test(text)) {
    return 'coronal';
  }
  if (/\bax\b|axial|\btra\b|transverse/i.test(text)) {
    return 'axial';
  }
  return undefined;
}

type Vec3 = [number, number, number];

function parseIop(iop: unknown): { row: Vec3; col: Vec3; normal: Vec3 } | undefined {
  if (!Array.isArray(iop) || iop.length < 6) {
    return undefined;
  }
  const v = iop.map(Number);
  if (v.some(n => Number.isNaN(n))) {
    return undefined;
  }
  const row: Vec3 = [v[0], v[1], v[2]];
  const col: Vec3 = [v[3], v[4], v[5]];
  const normal: Vec3 = [
    row[1] * col[2] - row[2] * col[1],
    row[2] * col[0] - row[0] * col[2],
    row[0] * col[1] - row[1] * col[0],
  ];
  return { row, col, normal };
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Axial when the slice normal is dominantly along patient S-I (Z). */
function isAxialNormal(normal: Vec3): boolean {
  const nx = Math.abs(normal[0]);
  const ny = Math.abs(normal[1]);
  const nz = Math.abs(normal[2]);
  return nz >= nx && nz >= ny;
}

function isLocalizer(instance: any): boolean {
  const it = instance?.ImageType;
  const str = Array.isArray(it) ? it.join(' ') : String(it ?? '');
  return /localizer|scout/i.test(str);
}

/** A representative instance for orientation: middle of the non-localizer images. */
function representativeInstance(displaySet: any): any {
  const instances: any[] = displaySet?.instances ?? displaySet?.images ?? [];
  if (!instances.length) {
    return displaySet?.instances?.[0] ?? displaySet?.images?.[0] ?? displaySet;
  }
  const usable = instances.filter(i => !isLocalizer(i));
  const pool = usable.length ? usable : instances;
  return pool[Math.floor(pool.length / 2)];
}

function iopOf(displaySet: any): unknown {
  const inst = representativeInstance(displaySet);
  return inst?.ImageOrientationPatient ?? displaySet?.ImageOrientationPatient;
}

/**
 * Finds the head frame (L-R, A-P axes) for a coronal/sagittal reformat by locating
 * the study's AXIAL reformat whose normal is (anti)parallel to this series' column
 * axis — both share the head S-I axis. Returns that axial reformat's row (head L-R)
 * and column (head A-P), or undefined if none qualifies.
 */
function findHeadFrame(
  col: Vec3,
  siblings: any[],
  selfUID: string | undefined
): { headLR: Vec3; headAP: Vec3 } | undefined {
  let best: { headLR: Vec3; headAP: Vec3; score: number } | undefined;
  for (const sib of siblings ?? []) {
    if (!sib || sib.displaySetInstanceUID === selfUID) {
      continue;
    }
    const parsed = parseIop(iopOf(sib));
    if (!parsed || !isAxialNormal(parsed.normal)) {
      continue;
    }
    // The axial reformat's normal should be (anti)parallel to this series' column
    // (the shared head S-I axis). Pick the most-parallel one.
    const score = Math.abs(dot(parsed.normal, col));
    if (score > 0.8 && (!best || score > best.score)) {
      best = { headLR: parsed.row, headAP: parsed.col, score };
    }
  }
  return best ? { headLR: best.headLR, headAP: best.headAP } : undefined;
}

export function getImagePlane(displaySet: any, siblings?: any[]): ImagePlane | undefined {
  if (!displaySet) {
    return undefined;
  }

  // 1) Explicit plane label in the description.
  const fromDescription = planeFromText(String(displaySet.SeriesDescription ?? ''));
  if (fromDescription) {
    return fromDescription;
  }

  // 2) Orientation from a representative, non-localizer instance.
  const parsed = parseIop(iopOf(displaySet));
  if (parsed) {
    const { col, normal } = parsed;
    if (isAxialNormal(normal)) {
      return 'axial';
    }
    // Non-axial: disambiguate coronal vs sagittal in the head frame (relative to
    // the study's axial reformat), since patient-axis dominance is unreliable for
    // oblique head reformats.
    const frame = findHeadFrame(col, siblings ?? [], displaySet.displaySetInstanceUID);
    if (frame) {
      const lr = Math.abs(dot(normal, frame.headLR)); // sagittal normal ∥ head L-R
      const ap = Math.abs(dot(normal, frame.headAP)); // coronal normal ∥ head A-P
      return lr >= ap ? 'sagittal' : 'coronal';
    }
    // Fallback: patient dominant axis (works for clean / pure-pitch tilts).
    return Math.abs(normal[0]) >= Math.abs(normal[1]) ? 'sagittal' : 'coronal';
  }

  // 3) ImageType text (last resort).
  const instance = representativeInstance(displaySet);
  const imageType = instance?.ImageType ?? displaySet.ImageType;
  const imageTypeStr = Array.isArray(imageType) ? imageType.join(' ') : String(imageType ?? '');
  return planeFromText(imageTypeStr);
}

export default getImagePlane;
