import { cache, eventTarget, Enums, StackViewport } from '@cornerstonejs/core';

/**
 * Runtime fix for cornerstone3D's StackViewport color crash
 *   "RangeError: model.size is not a multiple of model.numberOfComponents"
 * thrown from StackViewport.createVTKImageData when a color image's pixel-data
 * length isn't an exact multiple of its component count.
 *
 * Root cause: DICOM pads `OB` pixel data to an EVEN byte length. A color series
 * whose true size (rows·cols·components) is ODD therefore arrives with a trailing
 * pad byte that isn't a whole pixel — e.g. an iSchemaView RAPID map at 751×563:
 * 751·563·3 = 1268439 (odd) → buffer 1268440 → 1268440 % 3 = 1 → vtk throws. The
 * component flags are correct; it's purely the buffer length. (The same class also
 * covers "3D SPIN" / "...iMAR" RGB volumes.) Breaks both the viewport render and
 * the series-panel thumbnails.
 *
 * No cornerstone fork: as each image enters the cache (IMAGE_LOADED, which fires on
 * both render paths) we (a) trim getPixelData to a whole number of components
 * (`fixPixelDataPadding` — the actual fix), and (b) align the color/rgba flags to
 * the data as a harmless backstop. We also wrap createVTKImageData to do the same
 * and retry once for any image cached before the listener attached. Grayscale is
 * left untouched. Version-sensitive only in the wrapper — if the method is renamed
 * in a cornerstone upgrade the wrapper no-ops and the IMAGE_LOADED fix still applies.
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

/**
 * THE fix: DICOM pads `OB` pixel data to an even byte length, so a color image
 * whose true size (rows·cols·components) is ODD arrives with a trailing pad byte —
 * making `length % numberOfComponents !== 0` and crashing vtk. Trim `getPixelData`
 * to an exact multiple of the component count (drops only the stray pad byte(s)).
 * Returns true if it patched the image.
 */
function trimToComponents(arr: any, comps: number): any | null {
  const len = arr?.length;
  if (!len || len % comps === 0) {
    return null;
  }
  const trimmed = Math.floor(len / comps) * comps;
  if (trimmed <= 0) {
    return null;
  }
  return typeof arr.subarray === 'function' ? arr.subarray(0, trimmed) : arr.slice(0, trimmed);
}

function fixPixelDataPadding(image: any): boolean {
  if (!image) {
    return false;
  }
  const comps = Number(image.numberOfComponents) || (image.rgba ? 4 : image.color ? 3 : 0);
  if (comps < 2) {
    return false; // grayscale: length is already a multiple of 1
  }
  let fixed = false;

  // getPixelData (used by some paths / our diagnostics).
  if (typeof image.getPixelData === 'function') {
    try {
      const view = trimToComponents(image.getPixelData(), comps);
      if (view) {
        image.getPixelData = () => view;
        if (typeof image.sizeInBytes === 'number') {
          image.sizeInBytes = view.byteLength ?? view.length;
        }
        fixed = true;
      }
    } catch {
      /* ignore */
    }
  }

  // voxelManager.getScalarData — what cornerstone 2.x's createVTKImageData actually
  // feeds to the vtk scalar array. This is the one that matters for the crash.
  const vm = image.voxelManager;
  if (vm && typeof vm.getScalarData === 'function') {
    try {
      const view = trimToComponents(vm.getScalarData(), comps);
      if (view) {
        vm.getScalarData = () => view;
        fixed = true;
      }
    } catch {
      /* ignore */
    }
  }

  return fixed;
}

// Capped diagnostic dumps (per imageId, global limit) so a persistent mismatch is
// visible without flooding the console.
const diagnosed = new Set<string>();
let diagnosticBudget = 8;
function diagnose(image: any, log: (...a: unknown[]) => void): void {
  const id = image?.imageId;
  if (!id || diagnosed.has(id) || diagnosticBudget <= 0) {
    return;
  }
  diagnosed.add(id);
  diagnosticBudget -= 1;
  const rows = Number(image?.rows ?? image?.height ?? 0);
  const cols = Number(image?.columns ?? image?.width ?? 0);
  const px = rows * cols;
  let len: unknown = '?';
  let ctor = '?';
  try {
    const d = image?.getPixelData?.();
    len = d?.length;
    ctor = d?.constructor?.name;
  } catch {
    /* ignore */
  }
  let vmLen: unknown = 'no-vm';
  try {
    const vm = image?.voxelManager;
    if (vm && typeof vm.getScalarData === 'function') {
      vmLen = vm.getScalarData()?.length;
    }
  } catch {
    vmLen = 'vm-error';
  }
  log('RGB-fix diagnostic', {
    imageId: String(id).slice(0, 80),
    rows: image?.rows,
    columns: image?.columns,
    pxCount: px || '?',
    pixelDataLength: len,
    voxelManagerScalarLength: vmLen,
    lenOverPx: px && typeof len === 'number' ? len / px : '?',
    pixelDataType: ctor,
    numberOfComponents: image?.numberOfComponents,
    color: image?.color,
    rgba: image?.rgba,
  });
}

export function installRgbStackViewportFix(log: (...args: unknown[]) => void = () => {}): void {
  if (installed) {
    return;
  }
  installed = true;

  // (1) Normalize color images as they enter the cache — and dump a diagnostic for
  // the color ones so a persistent mismatch is visible regardless of render path.
  eventTarget.addEventListener(IMAGE_LOADED, (evt: any) => {
    try {
      const image = evt?.detail?.image;
      if (Number(image?.numberOfComponents) > 1 || image?.color || image?.rgba) {
        diagnose(image, log);
      }
      normalizeColorImage(image);
      // Trim the DICOM even-length pad byte so length % components === 0.
      fixPixelDataPadding(image);
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
        const tryFix = (img: any) => {
          if (!img || typeof img.getPixelData !== 'function') {
            return;
          }
          diagnose(img, log);
          // padding trim is the real fix; field normalize is harmless backup.
          if (fixPixelDataPadding(img)) {
            fixed = true;
          }
          if (normalizeColorImage(img)) {
            fixed = true;
          }
        };
        // The image may be passed as an arg, or read internally from the cache.
        for (const a of args) {
          tryFix(a);
        }
        try {
          const id = this?.getCurrentImageId?.();
          tryFix(id && cache.getImage?.(id));
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
