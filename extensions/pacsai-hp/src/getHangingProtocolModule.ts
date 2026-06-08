import hpCompareCT from './protocols/hpCompareCT';
import hpCompareMR from './protocols/hpCompareMR';
import hpCompareCR from './protocols/hpCompareCR';

function getHangingProtocolModule() {
  return [
    { name: hpCompareCT.id, protocol: hpCompareCT },
    { name: hpCompareMR.id, protocol: hpCompareMR },
    { name: hpCompareCR.id, protocol: hpCompareCR },
  ];
}

export default getHangingProtocolModule;
