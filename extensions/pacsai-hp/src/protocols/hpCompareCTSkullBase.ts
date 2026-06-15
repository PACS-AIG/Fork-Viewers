import buildCompareProtocol, { WINDOW } from './buildCompareProtocol';

/**
 * CT skull base / temporal bone / orbit / facial-bone comparison.
 *
 * Exams like "CT FOSSA/SELLA/IAC/ORBIT", "CT TEMPORAL BONES", "CT ORBITS", "CT
 * SINUS / FACIAL BONES" are thin-section studies reconstructed in BOTH a sharp
 * BONE kernel (Hr60 — for the petrous bone / IAC / orbital walls / ossicles) AND
 * a smooth SOFT kernel (Hr40 — for the globe, optic nerve, orbital fat, sella and
 * soft-tissue enhancement), each in axial + coronal + sagittal. The generic
 * compareCT only hangs one arbitrary recon per plane by score (mixing kernels and
 * hiding the second reconstruction), so these need a dedicated protocol.
 *
 * Like the spine CT protocol we group kernel-then-plane: BONE ax/cor/sag, then
 * SOFT ax/cor/sag, each at its own window (bone WW2000/WC500, soft WW400/WC40).
 * A metal-artifact (iMAR) soft axial, when present, is just an alternate ranked
 * match of the soft-axial selector.
 *
 * With a prior, the per-view current|prior stages lead (Axial bone → Coronal bone
 * → Axial soft → Coronal soft → Sagittal bone → Sagittal soft); any view the
 * study lacks degrades (disabled). With no prior, two current-only 3-ups tile each
 * kernel's planes together — bone trio leads, soft trio next.
 *
 * Claims only NON-angio skull-base/facial CT: bodyPartExcludeKeywords drops
 * angio/CTA so a "CT ANGIO …" still routes to compareCTA, and the keyword set is
 * specific enough that a plain CT HEAD/BRAIN stays on compareCTHead.
 */
export const hpCompareCTSkullBase = buildCompareProtocol({
  id: '@pacsai/compareCTSkullBase',
  name: 'CT Skull Base / Orbit / Temporal Bone Compare',
  description:
    'Current vs prior CT skull base / temporal bone / orbit — bone & soft kernel in axial/coronal/sagittal',
  modalities: ['CT'],
  // Skull-base / temporal-bone / orbit / facial-bone / sinus exams. Specific enough
  // not to grab a plain CT HEAD/BRAIN (compareCTHead) or CT NECK (compareCTNeck).
  bodyPartKeywords: [
    'fossa',
    'sella',
    'iac',
    'internal auditory',
    'orbit',
    'temporal bone',
    'petrous',
    'facial',
    'face',
    'maxillofacial',
    'mandible',
    'tmj',
    'sinus',
    'skull base',
    'pituitary',
    'nasal',
  ],
  // Keep angio out — a "CT ANGIO ORBITS" should route to compareCTA, not here.
  bodyPartExcludeKeywords: ['angio', 'cta'],
  // No-prior degrade fallback (below the kernel group stages): bone ax/cor/sag.
  currentView: ['ax-bone', 'cor-bone', 'sag-bone'],
  selectors: [
    // Sharp BONE kernel — petrous bone / IAC / orbital walls / ossicles / sinuses.
    { key: 'ax-bone', plane: 'axial', kernel: 'bone' },
    { key: 'cor-bone', plane: 'coronal', kernel: 'bone' },
    { key: 'sag-bone', plane: 'sagittal', kernel: 'bone' },
    // Smooth SOFT kernel — globe / optic nerve / orbital fat / sella / enhancement.
    { key: 'ax-soft', plane: 'axial', kernel: 'soft' },
    { key: 'cor-soft', plane: 'coronal', kernel: 'soft' },
    { key: 'sag-soft', plane: 'sagittal', kernel: 'soft' },
  ],
  stages: [
    { name: 'Axial bone (current/prior)', selector: 'ax-bone', voi: WINDOW.bone },
    { name: 'Coronal bone (current/prior)', selector: 'cor-bone', voi: WINDOW.bone },
    { name: 'Axial soft (current/prior)', selector: 'ax-soft', voi: WINDOW.softTissue },
    { name: 'Coronal soft (current/prior)', selector: 'cor-soft', voi: WINDOW.softTissue },
    { name: 'Sagittal bone (current/prior)', selector: 'sag-bone', voi: WINDOW.bone },
    { name: 'Sagittal soft (current/prior)', selector: 'sag-soft', voi: WINDOW.softTissue },
  ],
  // No prior: two kernel-grouped 3-ups. Bone trio leads (petrous/IAC/orbital-wall
  // detail), soft trio next (globe/nerve/sella/enhancement). Each auto-eligible
  // only when all three planes of that kernel exist; otherwise degrades.
  currentStages: [
    { name: 'Bone (ax/cor/sag)', selectors: ['ax-bone', 'cor-bone', 'sag-bone'] },
    { name: 'Soft tissue (ax/cor/sag)', selectors: ['ax-soft', 'cor-soft', 'sag-soft'] },
  ],
});

export default hpCompareCTSkullBase;
