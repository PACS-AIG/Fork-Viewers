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
function normalizeColorImage(image: any): boolean {
  if (!image || typeof image.getPixelData !== 'function') {
    return false;
  }
  const rows = Number(image.rows ?? image.height);
  const cols = Number(image.columns ?? image.width);
  const px = rows * cols;
  if (!px || !Number.isFinite(px)) {
    return false;
  }
  let data: { length?: number } | undefined;
  try {
    data = image.getPixelData();
  } catch {
    return false;
  }
  const len = data?.length;
  if (!len || len % px !== 0) {
    return false;
  }
  const comps = len / px;
  // Only color (3 = RGB, 4 = RGBA) needs aligning; leave grayscale alone.
  if (comps !== 3 && comps !== 4) {
    return false;
  }
  const rgba = comps === 4;
  let changed = false;
  if (image.numberOfComponents !== comps) {
    image.numberOfComponents = comps;
    changed = true;
  }
  if (image.color !== true) {
    image.color = true;
    changed = true;
  }
  if (image.rgba !== rgba) {
    image.rgba = rgba;
    changed = true;
  }
  return changed;
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
          if (a && typeof a.getPixelData === 'function' && normalizeColorImage(a)) {
            fixed = true;
          }
        }
        try {
          const id = this?.getCurrentImageId?.();
          const cached = id && cache.getImage?.(id);
          if (cached && normalizeColorImage(cached)) {
            fixed = true;
          }
        } catch {
          /* ignore */
        }
        if (fixed) {
          log('normalized RGB image components after vtk size mismatch; retrying');
          return original.apply(this, args);
        }
        throw e;
      }
    };
    patched.__pacsaiRgbPatched = true;
    proto.createVTKImageData = patched;
  }
}

export default installRgbStackViewportFix;
