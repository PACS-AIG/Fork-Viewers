import hpCompareCT from './protocols/hpCompareCT';
import hpCompareMR from './protocols/hpCompareMR';
import hpCompareCR from './protocols/hpCompareCR';
import { hpCompareCTSpine, hpCompareMRSpine } from './protocols/hpCompareSpine';
import hpCompareCTChest from './protocols/hpCompareCTChest';
import hpCompareCTHead from './protocols/hpCompareCTHead';
import hpCompareCTNeck from './protocols/hpCompareCTNeck';
import hpCompareCTA from './protocols/hpCompareCTA';
import hpCompareCTAChest from './protocols/hpCompareCTAChest';
import hpCompareCTPerfusion from './protocols/hpCompareCTPerfusion';
import hpCompareMRBrain from './protocols/hpCompareMRBrain';
import hpCompareMRAbdomen from './protocols/hpCompareMRAbdomen';

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
  // CTA (head/neck) out-weights compareCTHead/compareCTNeck for angio studies (all match "head"/"neck").
  hpCompareCTA,
  // Chest CTA (PE): requires angio + chest, so it out-weights both compareCTChest and head/neck CTA.
  hpCompareCTAChest,
  // CT perfusion (stroke): RAPID color maps; matches "perfusion"/"ctp", out-weights generic CT.
  hpCompareCTPerfusion,
  hpCompareMRBrain,
  // MR abdomen / MRCP: sequence-based (T2 / T1 Dixon / DWI / MRCP), out-weights generic MR.
  hpCompareMRAbdomen,
];

function getHangingProtocolModule() {
  return protocols.map(protocol => ({ name: protocol.id, protocol }));
}

export default getHangingProtocolModule;
