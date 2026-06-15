import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT angiography of the aorta / abdomen / pelvis comparison.
 *
 * A body CTA ("CT ANGIO CHEST/ABDOMEN/PELVIS", "CTA ABDOMEN AORTA", "CTA AORTA")
 * is a contrast-enhanced arterial-phase study read for aneurysm / dissection /
 * stenosis / endoleak along the thoraco-abdominal aorta and its branches. The read
 * is: the thin arterial axial (cross-sectional lumen / mural thrombus), the coronal
 * and SAGITTAL reformats (the aorta runs cranio-caudal, so the sagittal/oblique-
 * sagittal long axis is primary for the arch + dissection flap), a sharp-kernel
 * arterial axial (stents / calcified plaque), the non-contrast axial (intramural
 * haematoma / baseline calcium), and a thick-slab MIP.
 *
 * It is distinct from:
 *   - compareCTAChest (PE): that hangs a lung pane and a PE/soft axial and is keyed
 *     to a pure chest study; body CTA has no lung read and is now carved out of it
 *     (compareCTAChest excludes abdomen/pelvis/aorta).
 *   - compareCTARunoff (extremity): peripheral runoff to the feet; excluded here via
 *     runoff/extremity/iliofemoral tokens so a runoff still routes there.
 *   - compareCTA (head/neck): already excludes abdomen/pelvis/aorta.
 *
 * CRITICAL naming quirk (Siemens body CTA): the arterial recons are named
 * "CTA ARTERIAL PHASE … ax AXIAL MIP" / "… cor COR MIP" / "… sag SAG MIP" — i.e.
 * "MIP" appears in the description of the *source* recons, not just derived MIPs.
 * So selectors here key POSITIVELY on an 'arterial'/'cta' token (never an
 * excludeKeywords:['mip'], which would nuke every diagnostic series — the bug that
 * made compareCTAChest leave coronal/sagittal empty). The 'arterial'/'cta' token
 * also drops the bolus-tracking ("MONITORING"/"PRE-MONITORING") and "NON CON" series
 * from the arterial selectors, so they no longer steal the primary axial pane.
 */

// Arterial-phase / CTA recon tokens. Present in every diagnostic series name and
// absent from the bolus-tracking and non-contrast series.
const ARTERIAL = ['arterial', 'cta'];

export const hpCompareCTAAbdPelvis = buildCompareProtocol({
  id: '@pacsai/compareCTAAbdPelvis',
  name: 'CTA Aorta / Abdomen / Pelvis Compare',
  description:
    'Current vs prior CT angiography aorta/abdomen/pelvis — arterial axial, coronal/sagittal, bone axial, non-contrast, MIP',
  modalities: ['CT'],
  // Require an aorta/abdomen/pelvis token AND an angio token. Catches a combined
  // chest/abd/pelvis or thoracic-aorta CTA too (read as an aortic study, not PE).
  bodyPartKeywords: [
    'abdomen',
    'abdominal',
    'pelvis',
    'aorta',
    'aortic',
    'iliac',
    'visceral',
    'mesenteric',
  ],
  requireKeywordGroups: [['angio', 'cta']],
  // Keep peripheral runoff on compareCTARunoff (it shares aorta/iliac tokens but is a
  // different, station-by-station read to the feet).
  bodyPartExcludeKeywords: [
    'runoff',
    'iliofemoral',
    'extremity',
    'lower extremity',
    'lower limb',
    'femoral',
    'popliteal',
    'peripheral',
    'leg',
  ],
  matchWeight: 150,
  // Drop derived color (3D-spin / VR renders) from the diagnostic stages; also avoids
  // the RGB thumbnail crash auto-hanging them.
  excludeColorSeries: true,
  selectors: [
    // Thin arterial axial source (primary). Exclude the thick-slab axial MIP ('10.0…'
    // slice marker) so the source recon — not the thick MIP — fills the axial pane.
    // Siemens-tuned; if a study has ONLY a thick arterial axial it still surfaces via
    // the `mipax` selector / safety stage.
    { key: 'axart', plane: 'axial', preferKernel: 'soft', keywords: ARTERIAL, excludeKeywords: ['10.0'] },
    // Coronal + sagittal arterial reformats (aorta long axis). NOT mip-excluded.
    { key: 'cor', plane: 'coronal', keywords: ARTERIAL },
    { key: 'sag', plane: 'sagittal', keywords: ARTERIAL },
    // Sharp-kernel arterial axial — stents / calcified plaque.
    { key: 'axbone', plane: 'axial', kernel: 'bone', keywords: ARTERIAL, excludeKeywords: ['10.0'] },
    // Non-contrast axial — intramural haematoma / baseline calcium.
    { key: 'noncon', plane: 'axial', keywords: ['non con', 'non-con', 'noncon'] },
    // Thick-slab arterial axial MIP (the '10.0…' thick recon).
    { key: 'mipax', plane: 'axial', keywordGroups: [ARTERIAL, ['10.0']] },
  ],
  // Current vs prior (per view) — lead when a prior exists.
  stages: [
    { name: 'Axial arterial (current/prior)', selector: 'axart', voi: WINDOW.cta },
    { name: 'Coronal (current/prior)', selector: 'cor', voi: WINDOW.cta },
    { name: 'Sagittal (current/prior)', selector: 'sag', voi: WINDOW.cta },
    { name: 'Axial bone/stent (current/prior)', selector: 'axbone', voi: WINDOW.cta },
    { name: 'Non-contrast axial (current/prior)', selector: 'noncon', voi: WINDOW.softTissue },
    { name: 'Axial MIP (current/prior)', selector: 'mipax', voi: WINDOW.cta },
  ],
  // No prior: pageable task groups. Arterial ax/cor/sag 3-up leads; then arterial vs
  // non-contrast axial; then the thick MIP and the bone/stent axial.
  currentStages: [
    { name: 'Arterial (ax/cor/sag)', selectors: ['axart', 'cor', 'sag'], voi: WINDOW.cta },
    { name: 'Arterial + non-contrast axial', selectors: ['axart', 'noncon'] },
    { name: 'Axial MIP', selectors: ['mipax'], voi: WINDOW.cta },
    { name: 'Axial bone/stent', selectors: ['axbone'], voi: WINDOW.cta },
  ],
  currentView: ['axart', 'cor', 'sag'],
});

export default hpCompareCTAAbdPelvis;
