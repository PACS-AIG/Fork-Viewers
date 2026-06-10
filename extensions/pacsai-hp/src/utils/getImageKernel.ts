/**
 * Classifies a series' reconstruction character as 'bone' (sharp / high-frequency
 * kernel) or 'soft' (smooth kernel, the default), from ConvolutionKernel
 * (0018,1210), falling back to SeriesDescription.
 *
 * Reconstruction kernels are vendor-specific:
 *  - Siemens (B/H/J/Hr/Br + number): ~<55 = soft, >=55-60 = bone (e.g. Hc40s = soft,
 *    Hr60/Br69 = bone).
 *  - GE: STANDARD/SOFT = soft; BONE/BONEPLUS/DETAIL/EDGE = bone.
 *  - Philips/Canon: sharp/edge/FC30+ = bone.
 *
 * Returns 'soft' when unknown so soft/brain selectors still match (only an
 * explicit bone signal yields 'bone'). Registered as the `pacsaiKernel` custom
 * hanging-protocol attribute.
 */
export type ImageKernel = 'soft' | 'bone';

const BONE_KEYWORDS = /\b(bone|boneplus|lung|sharp|edge|detail)\b/i;
const SOFT_KEYWORDS = /\b(soft|standard|smooth|brain|stnd)\b/i;
// Kernel sharpness number at/above which we consider it a bone/sharp kernel.
const BONE_NUMBER_THRESHOLD = 55;

function classify(kernel: unknown, description: string): ImageKernel {
  const kernelStr = String(Array.isArray(kernel) ? kernel.join(' ') : (kernel ?? '')).trim();

  if (kernelStr) {
    if (BONE_KEYWORDS.test(kernelStr)) {
      return 'bone';
    }
    if (SOFT_KEYWORDS.test(kernelStr)) {
      return 'soft';
    }
    // Numeric sharpness (e.g. Siemens "Hc40s" -> 40, "Hr60" -> 60).
    const match = kernelStr.match(/\d{2,3}/);
    if (match) {
      return Number(match[0]) >= BONE_NUMBER_THRESHOLD ? 'bone' : 'soft';
    }
  }

  // Fallback: SeriesDescription only when the kernel gave no signal.
  if (BONE_KEYWORDS.test(description)) {
    return 'bone';
  }
  return 'soft';
}

export function getImageKernel(displaySet: any): ImageKernel {
  if (!displaySet) {
    return 'soft';
  }
  const instance = displaySet.instances?.[0] ?? displaySet.images?.[0] ?? displaySet;
  const kernel = instance?.ConvolutionKernel ?? displaySet.ConvolutionKernel;
  const description = String(displaySet.SeriesDescription ?? instance?.SeriesDescription ?? '');
  return classify(kernel, description);
}

export default getImageKernel;
