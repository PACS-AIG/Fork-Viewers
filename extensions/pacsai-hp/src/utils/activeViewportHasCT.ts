/**
 * True when the ACTIVE viewport is displaying at least one CT displaySet.
 *
 * Shared by the CT-only affordances: the `setCtWindowLevel` hotkey command and
 * the `evaluate.pacsai.ctOnly` toolbar evaluator (HU probe). CT is the only
 * modality whose pixels are calibrated to Hounsfield units, so HU-flavored
 * tools/presets must not act elsewhere. The all-in-one composite carries its
 * first source's Modality, so CT composites pass.
 */
export default function activeViewportHasCT(servicesManager: any): boolean {
  const { viewportGridService, displaySetService } = servicesManager?.services ?? {};
  if (!viewportGridService || !displaySetService) {
    return false;
  }
  const activeViewportId = viewportGridService.getActiveViewportId?.();
  if (!activeViewportId) {
    return false;
  }
  const uids: string[] = viewportGridService.getDisplaySetsUIDsForViewport?.(activeViewportId) ?? [];
  return uids.some(uid => displaySetService.getDisplaySetByUID(uid)?.Modality === 'CT');
}
