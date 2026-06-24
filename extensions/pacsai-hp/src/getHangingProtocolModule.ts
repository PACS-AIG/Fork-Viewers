import hpCompareCT from './protocols/hpCompareCT';
import hpCompareMR from './protocols/hpCompareMR';
import hpCompareCR from './protocols/hpCompareCR';
import { hpCompareCTSpine, hpCompareMRSpine } from './protocols/hpCompareSpine';
import hpCompareCTChest from './protocols/hpCompareCTChest';
import hpCompareCTHead from './protocols/hpCompareCTHead';
import hpCompareCTNeck from './protocols/hpCompareCTNeck';
import hpCompareCTSkullBase from './protocols/hpCompareCTSkullBase';
import hpCompareCTA from './protocols/hpCompareCTA';
import hpCompareCTAChest from './protocols/hpCompareCTAChest';
import hpCompareCTARunoff from './protocols/hpCompareCTARunoff';
import hpCompareCTAAbdPelvis from './protocols/hpCompareCTAAbdPelvis';
import hpCompareCTPerfusion from './protocols/hpCompareCTPerfusion';
import hpCompareMRBrain from './protocols/hpCompareMRBrain';
import hpCompareMRAbdomen from './protocols/hpCompareMRAbdomen';
import hpAllInOne from './protocols/hpAllInOne';

const protocols = [
  // Generic per-modality (lower weight, fallbacks for their modality)
  hpCompareCT,
  hpCompareMR,
  hpCompareCR,
  // Exam-specific (higher weight; win when the exam matches)
  hpCompareCTSpine,
  hpCompareMRSpine,
  hpCompareCTChest,
  hpCompareCTHead,
  hpCompareCTNeck,
  // Skull base / temporal bone / orbit / facial bones / sinus: bone+soft kernel in
  // ax/cor/sag. Matches fossa/sella/iac/orbit/temporal/facial/sinus, out-weights generic CT.
  hpCompareCTSkullBase,
  // CTA (head/neck) out-weights compareCTHead/compareCTNeck for angio studies (all match "head"/"neck").
  hpCompareCTA,
  // Chest CTA (PE): requires angio + chest, so it out-weights both compareCTChest and head/neck CTA.
  hpCompareCTAChest,
  // Extremity / peripheral runoff CTA: requires angio + extremity/runoff, out-weights head/neck CTA.
  hpCompareCTARunoff,
  // Aorta / abdomen / pelvis (body) CTA: requires angio + aorta/abdomen/pelvis (runoff excluded);
  // carved out of compareCTAChest so a chest/abd/pelvis or thoracic-aorta CTA reads as aortic, not PE.
  hpCompareCTAAbdPelvis,
  // CT perfusion (stroke): RAPID color maps; matches "perfusion"/"ctp", out-weights generic CT.
  hpCompareCTPerfusion,
  hpCompareMRBrain,
  // MR abdomen / MRCP: sequence-based (T2 / T1 Dixon / DWI / MRCP), out-weights generic MR.
  hpCompareMRAbdomen,
  // All-in-one only (browsing Mode 2): never auto-matched (empty rules); forced by
  // the browsing-mode toolbar control. Hangs just the all-in-one composite stack(s).
  hpAllInOne,
];

function getHangingProtocolModule() {
  return protocols.map(protocol => ({ name: protocol.id, protocol }));
}

export default getHangingProtocolModule;
