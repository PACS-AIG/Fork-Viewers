/**
 * Shared body-part regions + plane views for the generic CT/MR "session" protocols,
 * which lay out a multi-region same-session set (e.g. CT head + CT cervical) as
 * per-region current-vs-prior stages — region-major, navigated sequentially, no
 * cross-region tiling. `region` values match `getBodyPart` output (so the
 * `pacsaiBodyPartTimepoint` attribute resolves them); ordered cranio-caudally.
 * Regions not present in a given session simply have disabled (skipped) stages.
 */
export const SESSION_REGIONS = [
  { key: 'head', region: 'head', label: 'Head' },
  { key: 'neck', region: 'neck', label: 'Neck' },
  { key: 'csp', region: 'spine-cervical', label: 'C-spine' },
  { key: 'tsp', region: 'spine-thoracic', label: 'T-spine' },
  { key: 'lsp', region: 'spine-lumbar', label: 'L-spine' },
  { key: 'spine', region: 'spine', label: 'Spine' },
  { key: 'chest', region: 'chest', label: 'Chest' },
  { key: 'card', region: 'cardiac', label: 'Cardiac' },
  { key: 'abd', region: 'abdomen', label: 'Abdomen' },
  { key: 'pelv', region: 'pelvis', label: 'Pelvis' },
  { key: 'ext', region: 'extremity', label: 'Extremity' },
];

/** Plane views for the per-region session compare (current beside that region's prior). */
export const SESSION_VIEWS = [
  { key: 'ax', name: 'axial', plane: 'axial' as const },
  { key: 'cor', name: 'coronal', plane: 'coronal' as const },
  { key: 'sag', name: 'sagittal', plane: 'sagittal' as const },
];
