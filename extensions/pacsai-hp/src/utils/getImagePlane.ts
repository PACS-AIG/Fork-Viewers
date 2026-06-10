/**
 * Computes the acquisition/reformat plane of a display set as
 * 'axial' | 'coronal' | 'sagittal' | undefined.
 *
 * Order of evidence (most reliable first):
 *  1. ImageOrientationPatient (0020,0037) — the slice normal's dominant axis.
 *  2. ImageType (0008,0008) — e.g. DERIVED\PRIMARY\AXIAL\...MPR.
 *  3. SeriesDescription text — ax/cor/sag keywords.
 *
 * Registered as the `pacsaiPlane` custom hanging-protocol attribute so plane
 * selectors work even when the SeriesDescription omits the plane (common for
 * MPR reformats).
 */
export type ImagePlane = 'axial' | 'coronal' | 'sagittal';

function planeFromOrientation(iop: unknown): ImagePlane | undefined {
  if (!Array.isArray(iop) || iop.length < 6) {
    return undefined;
  }
  const v = iop.map(Number);
  if (v.some(n => Number.isNaN(n))) {
    return undefined;
  }
  const [rx, ry, rz, cx, cy, cz] = v;
  // normal = row x col
  const nx = Math.abs(ry * cz - rz * cy);
  const ny = Math.abs(rz * cx - rx * cz);
  const nz = Math.abs(rx * cy - ry * cx);
  const max = Math.max(nx, ny, nz);
  if (max === nz) {
    return 'axial'; // normal along Z
  }
  if (max === ny) {
    return 'coronal'; // normal along Y
  }
  return 'sagittal'; // normal along X
}

function planeFromText(text: string): ImagePlane | undefined {
  if (/sag|sagittal/i.test(text)) {
    return 'sagittal';
  }
  if (/cor|coronal/i.test(text)) {
    return 'coronal';
  }
  if (/\bax|axial|tra|transverse/i.test(text)) {
    return 'axial';
  }
  return undefined;
}

export function getImagePlane(displaySet: any): ImagePlane | undefined {
  if (!displaySet) {
    return undefined;
  }

  const instance = displaySet.instances?.[0] ?? displaySet.images?.[0] ?? displaySet;

  // 1) Orientation vectors (most reliable, description-independent).
  const iop = instance?.ImageOrientationPatient ?? displaySet.ImageOrientationPatient;
  const fromIop = planeFromOrientation(iop);
  if (fromIop) {
    return fromIop;
  }

  // 2) ImageType, e.g. ['DERIVED','PRIMARY','AXIAL','CT_SOM5 MPR'].
  const imageType = instance?.ImageType ?? displaySet.ImageType;
  const imageTypeStr = Array.isArray(imageType) ? imageType.join(' ') : String(imageType ?? '');
  const fromImageType = planeFromText(imageTypeStr);
  if (fromImageType) {
    return fromImageType;
  }

  // 3) SeriesDescription text.
  return planeFromText(String(displaySet.SeriesDescription ?? ''));
}

export default getImagePlane;
