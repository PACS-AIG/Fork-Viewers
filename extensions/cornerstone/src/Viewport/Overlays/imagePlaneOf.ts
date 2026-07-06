import { metaData } from '@cornerstonejs/core';

/**
 * Image-plane helpers shared by the PACS AI viewport chrome (scroll minimap, scout
 * navigator). Duplicated from pacsai-hp's plane math (cornerstone ext must not
 * depend on pacsai-hp — wrong dependency direction). Keep the math in sync.
 */

/** Coerce a vec3-like (array or Float32Array) to a clean [x,y,z], or undefined. */
export function vec3(x: any): number[] | undefined {
  if (!x || typeof x.length !== 'number' || x.length < 3) {
    return undefined;
  }
  const a = [Number(x[0]), Number(x[1]), Number(x[2])];
  return a.some(n => Number.isNaN(n)) ? undefined : a;
}

/** Row/column direction cosines of an image, from imagePlaneModule (or raw IOP). */
export function rowColOf(imageId: string): { row: number[]; col: number[] } | undefined {
  const m = metaData.get('imagePlaneModule', imageId) as any;
  if (!m) {
    return undefined;
  }
  let row = vec3(m.rowCosines);
  let col = vec3(m.columnCosines);
  if (!row || !col) {
    const iop = m.imageOrientationPatient;
    if (iop && iop.length >= 6) {
      row = vec3([iop[0], iop[1], iop[2]]);
      col = vec3([iop[3], iop[4], iop[5]]);
    }
  }
  return row && col ? { row, col } : undefined;
}

/**
 * Image plane from orientation: dominant slice-normal axis (normal ∥ S-I = axial,
 * ∥ L-R = sagittal, ∥ A-P = coronal).
 */
export function planeOfImageId(imageId: string): string | undefined {
  const rc = rowColOf(imageId);
  if (!rc) {
    return undefined;
  }
  const { row, col } = rc;
  const nx = Math.abs(row[1] * col[2] - row[2] * col[1]);
  const ny = Math.abs(row[2] * col[0] - row[0] * col[2]);
  const nz = Math.abs(row[0] * col[1] - row[1] * col[0]);
  if (nz >= nx && nz >= ny) {
    return 'axial';
  }
  return nx >= ny ? 'sagittal' : 'coronal';
}
