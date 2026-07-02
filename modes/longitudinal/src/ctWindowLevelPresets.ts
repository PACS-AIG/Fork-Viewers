/**
 * PACS-AI CT window/level presets, shown in the per-viewport window-level
 * action menu (top-right viewport corner) for CT viewports, replacing OHIF's
 * five stock CT entries. Values are radiologist-supplied starting points
 * (ww/wc in HU) — tune here per site.
 *
 * Keys 1–9 map to the first entries via the app-config hotkeys (parent repo
 * config.js), which invoke the `setWindowLevel` command with the same values;
 * keep the two lists in sync when editing.
 */
const ctWindowLevelPresets = [
  { id: 'ct-soft-tissue', description: 'Soft Tissue', window: '400', level: '40' },
  { id: 'ct-lung', description: 'Lung', window: '1500', level: '-600' },
  { id: 'ct-bone', description: 'Bone', window: '2000', level: '400' },
  { id: 'ct-brain', description: 'Brain', window: '80', level: '40' },
  { id: 'ct-subdural', description: 'Subdural', window: '215', level: '75' },
  { id: 'ct-cta', description: 'CTA / Angio', window: '700', level: '200' },
  { id: 'ct-pe', description: 'PE (chest CTA)', window: '700', level: '100' },
  { id: 'ct-liver', description: 'Liver', window: '150', level: '60' },
  { id: 'ct-stroke', description: 'Stroke / Post-fossa', window: '40', level: '40' },
  { id: 'ct-mediastinum', description: 'Mediastinum', window: '350', level: '40' },
  { id: 'ct-spine-soft', description: 'Spine Soft Tissue', window: '300', level: '50' },
  { id: 'ct-temporal-bone', description: 'Temporal Bone', window: '4000', level: '700' },
];

export default ctWindowLevelPresets;
