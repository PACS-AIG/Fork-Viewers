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

/** Classification plus provenance, so the overlay can flag a name-vs-kernel conflict. */
export type KernelInfo = {
  /** Final classification used for matching (description label can elevate to bone). */
  kernel: ImageKernel;
  /** What the ConvolutionKernel tag alone indicated (before any description elevation). */
  fromKernel?: ImageKernel;
  /** Raw ConvolutionKernel tag value, for display in the conflict tooltip. */
  convKernel?: string;
  /**
   * True when the SeriesDescription said BONE but the ConvolutionKernel tag indicated
   * a SOFT kernel — i.e. a "Cor BONE 2MM" reformat reconstructed with a soft kernel
   * (e.g. Siemens H31s). We classify it bone per the label, but flag the discrepancy.
   */
  labelConflict: boolean;
};

const LUNG_KEYWORDS = /\blung\b/i;
const BONE_KEYWORDS = /\b(bone|boneplus|sharp|edge|detail)\b/i;
const SOFT_KEYWORDS = /\b(soft|standard|smooth|brain|stnd|sft)\b/i;
// Kernel sharpness number at/above which we consider it a sharp (lung/bone) kernel.
const SHARP_NUMBER_THRESHOLD = 55;
// A Siemens-style kernel code embedded in free text: 1-3 letters immediately
// followed by 2-3 digits and an optional trailing letter (e.g. Br60, Bl64f, Hr40s,
// Tr20). Anchored to a letter prefix so it never matches a slice-thickness token
// ("2.00") or an instance count.
const KERNEL_CODE = /\b[A-Za-z]{1,3}(\d{2,3})[a-z]?\b/g;

// Highest kernel-code sharpness number found in the description, or undefined. Used
// only as a fallback when the ConvolutionKernel tag is absent — MPR / curved
// reformats frequently drop the tag but keep the code in the description (e.g.
// "...CURVED COR 2.00 Br60"). Takes the max so a leading vertebral-level token
// ("T12 ... Br60") doesn't mask the real kernel code.
function descriptionKernelNumber(description: string): number | undefined {
  let max: number | undefined;
  for (const m of description.matchAll(KERNEL_CODE)) {
    const n = Number(m[1]);
    if (max === undefined || n > max) {
      max = n;
    }
  }
  return max;
}

function classify(kernel: unknown, description: string): KernelInfo {
  const kernelStr = String(Array.isArray(kernel) ? kernel.join(' ') : (kernel ?? '')).trim();
  const convKernel = kernelStr || undefined;
  const haystack = `${kernelStr} ${description}`;

  // Lung is distinguished by an explicit hint (kernel name or description).
  if (LUNG_KEYWORDS.test(haystack)) {
    return { kernel: 'lung', fromKernel: 'lung', convKernel, labelConflict: false };
  }

  // Signal from the ConvolutionKernel tag, if present.
  let fromKernel: ImageKernel | undefined;
  if (kernelStr) {
    if (BONE_KEYWORDS.test(kernelStr)) {
      fromKernel = 'bone';
    } else if (SOFT_KEYWORDS.test(kernelStr)) {
      fromKernel = 'soft';
    } else {
      // Numeric sharpness (e.g. Siemens "Br36" -> 36 soft, "Hr60"/"Bl60" -> sharp).
      const match = kernelStr.match(/\d{2,3}/);
      if (match) {
        fromKernel = Number(match[0]) >= SHARP_NUMBER_THRESHOLD ? 'bone' : 'soft';
      }
    }
  }

  // A genuinely SHARP kernel tag is authoritative — keep it.
  if (fromKernel === 'bone') {
    return { kernel: 'bone', fromKernel, convKernel, labelConflict: false };
  }
  // Otherwise an explicit BONE in the SeriesDescription is the tech's label and
  // wins: a "Cor BONE 2MM" reformat often inherits a SOFT source-kernel tag (so the
  // numeric/kernel signal reads soft, e.g. Siemens H31s) yet is intended/displayed
  // as bone. Mirrors getImagePlane trusting the description's plane word. We keep the
  // bone classification but flag the conflict (overlay shows a warning marker) when
  // the kernel tag actually indicated soft, so the reader knows.
  //
  // ALSO: when the ConvolutionKernel tag is ABSENT (fromKernel undefined — common on
  // MPR / curved-coronal reformats), read a sharp kernel code straight from the
  // description (e.g. "...CURVED COR 2.00 Br60" -> 60 >= threshold) so the reformat is
  // classified bone like its source instead of silently defaulting to soft. Only when
  // there's no tag signal, so a present tag stays authoritative.
  const sharpCodeInDesc =
    fromKernel === undefined &&
    (descriptionKernelNumber(description) ?? 0) >= SHARP_NUMBER_THRESHOLD;
  if (BONE_KEYWORDS.test(description) || sharpCodeInDesc) {
    return { kernel: 'bone', fromKernel, convKernel, labelConflict: fromKernel === 'soft' };
  }
  // Else use the kernel tag's soft signal, defaulting to soft when unknown.
  return { kernel: fromKernel ?? 'soft', fromKernel, convKernel, labelConflict: false };
}

export function getImageKernelInfo(displaySet: any): KernelInfo {
  if (!displaySet) {
    return { kernel: 'soft', labelConflict: false };
  }
  const instance = displaySet.instances?.[0] ?? displaySet.images?.[0] ?? displaySet;
  const kernel = instance?.ConvolutionKernel ?? displaySet.ConvolutionKernel;
  const description = String(displaySet.SeriesDescription ?? instance?.SeriesDescription ?? '');
  return classify(kernel, description);
}

export function getImageKernel(displaySet: any): ImageKernel {
  return getImageKernelInfo(displaySet).kernel;
}

export default getImageKernel;
