import { Types } from '@ohif/core';
import loadRelevantPriors from './priors/loadRelevantPriors';

const getCommandsModule = ({
  servicesManager,
  extensionManager,
}: Types.Extensions.ExtensionParams): Types.Extensions.CommandsModule => {
  const actions = {
    /**
     * Finds, loads, and hangs the most relevant prior study/studies for the
     * active comparison protocol. No-op for non-comparison protocols.
     */
    loadRelevantPriors: () => loadRelevantPriors({ servicesManager, extensionManager }),
  };

  const definitions = {
    loadRelevantPriors: actions.loadRelevantPriors,
  };

  return {
    actions,
    definitions,
    defaultContext: 'DEFAULT',
  };
};

export default getCommandsModule;
