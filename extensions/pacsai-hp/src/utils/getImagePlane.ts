/**
 * Computes the plane of a display set as 'axial' | 'coronal' | 'sagittal' |
 * undefined.
 *
 * Order of evidence:
 *  1. An explicit plane word in SeriesDescription (AX/COR/SAG/axial/...). This is
 *     the tech's label and is reliable when present — and avoids being fooled by a
 *     stray localizer instance whose orientation differs from the series' intent.
 *  2. ImageOrientationPatient of a representative (middle, non-localizer) instance
 *     — used for reformats whose description omits the plane (e.g. "REFORMATS").
 *  3. ImageType text (e.g. DERIVED\PRIMARY\AXIAL\...).
 *
 * Registered as the `pacsaiPlane` custom hanging-protocol attribute.
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

function planeFromOrientation(iop: unknown): ImagePlane | undefined {
  if (!Array.isArray(iop) || iop.length < 6) {
    return undefined;
  }
  const v = iop.map(Number);
  if (v.some(n => Number.isNaN(n))) {
    return undefined;
  }
  const [rx, ry, rz, cx, cy, cz] = v;
  const nx = Math.abs(ry * cz - rz * cy);
  const ny = Math.abs(rz * cx - rx * cz);
  const nz = Math.abs(rx * cy - ry * cx);
  const max = Math.max(nx, ny, nz);
  if (max === nz) {
    return 'axial';
  }
  if (max === ny) {
    return 'coronal';
  }
  return 'sagittal';
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

export function getImagePlane(displaySet: any): ImagePlane | undefined {
  if (!displaySet) {
    return undefined;
  }

  // 1) Explicit plane label in the description.
  const fromDescription = planeFromText(String(displaySet.SeriesDescription ?? ''));
  if (fromDescription) {
    return fromDescription;
  }

  // 2) Orientation from a representative, non-localizer instance.
  const instance = representativeInstance(displaySet);
  const iop = instance?.ImageOrientationPatient ?? displaySet.ImageOrientationPatient;
  const fromOrientation = planeFromOrientation(iop);
  if (fromOrientation) {
    return fromOrientation;
  }

  // 3) ImageType text (last resort).
  const imageType = instance?.ImageType ?? displaySet.ImageType;
  const imageTypeStr = Array.isArray(imageType) ? imageType.join(' ') : String(imageType ?? '');
  return planeFromText(imageTypeStr);
}

export default getImagePlane;
