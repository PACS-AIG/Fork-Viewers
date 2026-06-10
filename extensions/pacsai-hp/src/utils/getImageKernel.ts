/**
 * Classifies a series' reconstruction character as 'lung', 'bone' (sharp /
 * high-frequency kernels) or 'soft' (smooth kernel, the default), from
 * ConvolutionKernel (0018,1210), falling back to SeriesDescription.
 *
 * Lung and bone kernels are both *sharp*; they're told apart by a "lung" hint
 * (common in chest recons), otherwise a sharp kernel is treated as 'bone'.
 *
 * Reconstruction kernels are vendor-specific:
 *  - Siemens (B/H/J/Hr/Br/Bl + number): ~<55 = soft, >=55 = sharp (e.g. Hc40s/Br36
 *    = soft, Hr60/Br69 = bone, Bl57/Bl64 = lung).
 *  - GE: STANDARD/SOFT = soft; BONE/BONEPLUS/DETAIL/EDGE = bone; LUNG = lung.
 *  - Philips/Canon: sharp/edge = bone; lung kernels = lung.
 *
 * Returns 'soft' when unknown so soft selectors still match (only an explicit
 * sharp signal yields lung/bone). Registered as the `pacsaiKernel` custom
 * hanging-protocol attribute.
 */
export type ImageKernel = 'soft' | 'lung' | 'bone';

const LUNG_KEYWORDS = /\blung\b/i;
const BONE_KEYWORDS = /\b(bone|boneplus|sharp|edge|detail)\b/i;
const SOFT_KEYWORDS = /\b(soft|standard|smooth|brain|stnd|sft)\b/i;
// Kernel sharpness number at/above which we consider it a sharp (lung/bone) kernel.
const SHARP_NUMBER_THRESHOLD = 55;

function classify(kernel: unknown, description: string): ImageKernel {
  const kernelStr = String(Array.isArray(kernel) ? kernel.join(' ') : (kernel ?? '')).trim();
  const haystack = `${kernelStr} ${description}`;

  // Lung is distinguished by an explicit hint (kernel name or description).
  if (LUNG_KEYWORDS.test(haystack)) {
    return 'lung';
  }

  if (kernelStr) {
    if (BONE_KEYWORDS.test(kernelStr)) {
      return 'bone';
    }
    if (SOFT_KEYWORDS.test(kernelStr)) {
      return 'soft';
    }
    // Numeric sharpness (e.g. Siemens "Br36" -> 36 soft, "Hr60"/"Bl60" -> sharp).
    const match = kernelStr.match(/\d{2,3}/);
    if (match) {
      return Number(match[0]) >= SHARP_NUMBER_THRESHOLD ? 'bone' : 'soft';
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
