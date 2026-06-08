import hpCompareCT from './protocols/hpCompareCT';
import hpCompareMR from './protocols/hpCompareMR';
import hpCompareCR from './protocols/hpCompareCR';
import { hpCompareCTSpine, hpCompareMRSpine } from './protocols/hpCompareSpine';
import hpCompareCTChest from './protocols/hpCompareCTChest';
import hpCompareCTHead from './protocols/hpCompareCTHead';
import hpCompareMRBrain from './protocols/hpCompareMRBrain';

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
  hpCompareMRBrain,
];

function getHangingProtocolModule() {
  return protocols.map(protocol => ({ name: protocol.id, protocol }));
}

export default getHangingProtocolModule;
