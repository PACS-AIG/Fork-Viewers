import { cache, eventTarget, Enums, StackViewport } from '@cornerstonejs/core';

/**
 * Runtime fix for cornerstone3D's StackViewport RGB crash
 *   "RangeError: model.size is not a multiple of model.numberOfComponents"
 * thrown from StackViewport.createVTKImageData when an image's pixel-data length
 * doesn't divide by the component count cornerstone assigns to the vtk scalar
 * array. It hits color series whose decoded data is RGB (3) vs RGBA (4) out of
 * sync with the image's `color`/`rgba`/`numberOfComponents` flags — e.g. the
 * iSchemaView RAPID perfusion/angio maps, "3D SPIN", and "...iMAR" volumes — and
 * breaks both the viewport render and the series-panel thumbnails.
 *
 * No cornerstone fork: we (1) normalize a color image's component metadata to match
 * its actual pixel-data length the moment it enters the cache, so the value vtk
 * receives always divides evenly; and (2) wrap createVTKImageData so any image that
 * slipped through (cached before the listener attached) is normalized and retried
 * once before the error can propagate. Grayscale images are left untouched.
 *
 * Cornerstone-version-sensitive only in part (2) — if the prototype method is ever
 * renamed, that guard simply no-ops and the (1) cache normalization still applies.
 */

const { IMAGE_LOADED } = Enums.Events;

let installed = false;

/**
 * Align a COLOR image's component flags with its real pixel-data length so
 * `length % numberOfComponents === 0`. Returns true if anything changed. Skips
 * grayscale (comps === 1) and anything whose length doesn't cleanly divide by the
 * pixel count (can't safely infer components).
 */
function imageShape(image: any): { len: number; px: number; comps: number } | null {
  if (!image || typeof image.getPixelData !== 'function') {
    return null;
  }
  const rows = Number(image.rows ?? image.height ?? 0);
  const cols = Number(image.columns ?? image.width ?? 0);
  const px = rows * cols;
  if (!px || !Number.isFinite(px)) {
    return null;
  }
  let data: { length?: number } | undefined;
  try {
    data = image.getPixelData();
  } catch {
    return null;
  }
  const len = Number(data?.length ?? 0);
  if (!len || len % px !== 0) {
    return null;
  }
  return { len, px, comps: len / px };
}

/**
 * Align an image's component flags with its ACTUAL pixel-data length so vtk's
 * `length % numberOfComponents === 0` holds — in BOTH directions (data is RGB/RGBA
 * but flags say grayscale, or data is single-channel but flags say color). Returns
 * true if anything changed.
 */
function normalizeColorImage(image: any): boolean {
  const shape = imageShape(image);
  if (!shape) {
    return false;
  }
  const { comps } = shape;
  if (comps !== 1 && comps !== 3 && comps !== 4) {
    return false;
  }
  const color = comps >= 3;
  const rgba = comps === 4;
  let changed = false;
  if (image.numberOfComponents !== comps) {
    image.numberOfComponents = comps;
    changed = true;
  }
  if (image.color !== color) {
    image.color = color;
    changed = true;
  }
  if (image.rgba !== rgba) {
    image.rgba = rgba;
    changed = true;
  }
  return changed;
}

// One diagnostic dump per imageId so a persistent mismatch is visible without spam.
const diagnosed = new Set<string>();
function diagnose(image: any, log: (...a: unknown[]) => void): void {
  const id = image?.imageId;
  if (!id || diagnosed.has(id)) {
    return;
  }
  diagnosed.add(id);
  let len: unknown = '?';
  let ctor = '?';
  try {
    const d = image?.getPixelData?.();
    len = d?.length;
    ctor = d?.constructor?.name;
  } catch {
    /* ignore */
  }
  log('RGB-fix diagnostic', {
    imageId: id,
    rows: image?.rows,
    columns: image?.columns,
    width: image?.width,
    height: image?.height,
    pixelDataLength: len,
    pixelDataType: ctor,
    numberOfComponents: image?.numberOfComponents,
    color: image?.color,
    rgba: image?.rgba,
    photometricInterpretation: image?.photometricInterpretation,
  });
}

export function installRgbStackViewportFix(log: (...args: unknown[]) => void = () => {}): void {
  if (installed) {
    return;
  }
  installed = true;

  // (1) Normalize color images as they enter the cache.
  eventTarget.addEventListener(IMAGE_LOADED, (evt: any) => {
    try {
      normalizeColorImage(evt?.detail?.image);
    } catch {
      /* never let the fix itself throw into the event pipeline */
    }
  });

  // (2) Retry guard around the throwing method.
  const proto: any = (StackViewport as any)?.prototype;
  const original = proto?.createVTKImageData;
  if (typeof original === 'function' && !original.__pacsaiRgbPatched) {
    const patched = function (this: any, ...args: any[]) {
      try {
        return original.apply(this, args);
      } catch (e: any) {
        const isSizeMismatch =
          e instanceof RangeError && /multiple of/i.test(String(e?.message ?? ''));
        if (!isSizeMismatch) {
          throw e;
        }
        let fixed = false;
        // The image may be passed as an arg, or read internally from the cache.
        for (const a of args) {
          if (a && typeof a.getPixelData === 'function') {
            diagnose(a, log);
            if (normalizeColorImage(a)) {
              fixed = true;
            }
          }
        }
        try {
          const id = this?.getCurrentImageId?.();
          const cached = id && cache.getImage?.(id);
          if (cached) {
            diagnose(cached, log);
            if (normalizeColorImage(cached)) {
              fixed = true;
            }
          }
        } catch {
          /* ignore */
        }
        if (fixed) {
          log('normalized RGB image components after vtk size mismatch; retrying');
          return original.apply(this, args);
        }
        log('could not normalize RGB image; rethrowing', String(e?.message ?? e));
        throw e;
      }
    };
    patched.__pacsaiRgbPatched = true;
    proto.createVTKImageData = patched;
  }
}

export default installRgbStackViewportFix;
