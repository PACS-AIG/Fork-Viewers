/**
 * Color class of a display set: 'rgb' for color series (PhotometricInterpretation
 * RGB / PALETTE / YBR_*, or SamplesPerPixel > 1) else 'mono'.
 *
 * Used as the `pacsaiColor` custom hanging-protocol attribute so diagnostic
 * selectors can exclude color series — the iSchemaView/RAPID summary renders,
 * perfusion parameter maps, 3D-spin volumes, etc. These are derived overlays, not
 * diagnostic source/MIP series, and they are also the ones that trip cornerstone's
 * "size is not a multiple of numberOfComponents" thumbnail/viewport crash.
 *
 * Returns 'mono' whenever color can't be positively determined (missing metadata),
 * so a required `pacsaiColor === 'mono'` selector rule only ever drops a CONFIRMED
 * color series — never a grayscale one on absent tags.
 */
export type ImageColor = 'rgb' | 'mono';

export function getImageColor(displaySet: any): ImageColor {
  if (!displaySet) {
    return 'mono';
  }
  const instance = displaySet.instances?.[0] ?? displaySet.images?.[0] ?? displaySet;

  const spp = instance?.SamplesPerPixel ?? displaySet.SamplesPerPixel;
  if (typeof spp === 'number' && spp > 1) {
    return 'rgb';
  }

  const pi = String(
    instance?.PhotometricInterpretation ?? displaySet.PhotometricInterpretation ?? ''
  )
    .trim()
    .toUpperCase();
  if (pi.startsWith('RGB') || pi.startsWith('PALETTE') || pi.startsWith('YBR')) {
    return 'rgb';
  }

  return 'mono';
}

export default getImageColor;
