import { Types } from '@ohif/core';
import { PanelMeasurementTableTracking, PanelStudyBrowserTracking } from './panels';
import i18n from 'i18next';
import React from 'react';

// TODO:
// - No loading UI exists yet
// - cancel promises when component is destroyed
// - show errors in UI for thumbnails if promise fails

function getPanelModule({ commandsManager, extensionManager, servicesManager }): Types.Panel[] {
  return [
    {
      name: 'seriesList',
      iconName: 'tab-studies',
      iconLabel: 'Studies',
      label: i18n.t('SidePanel:Studies'),
      component: props => (
        <PanelStudyBrowserTracking
          {...props}
          commandsManager={commandsManager}
          extensionManager={extensionManager}
          servicesManager={servicesManager}
        />
      ),
    },
    {
      // pacsai (Rev 11 milestone 6, approach C, phase 1 PR 4): radcopilot's series
      // rail, the same study browser drawn as one narrow column.
      name: 'seriesRail',
      iconName: 'tab-studies',
      iconLabel: 'Series',
      label: 'Series',
      component: props => (
        <PanelStudyBrowserTracking
          {...props}
          presentation="rail"
          commandsManager={commandsManager}
          extensionManager={extensionManager}
          servicesManager={servicesManager}
        />
      ),
    },
    {
      name: 'trackedMeasurements',
      iconName: 'tab-linear',
      iconLabel: 'Measure',
      label: i18n.t('SidePanel:Measurements'),
      component: props => (
        <PanelMeasurementTableTracking
          {...props}
          commandsManager={commandsManager}
          extensionManager={extensionManager}
          servicesManager={servicesManager}
        />
      ),
    },
  ];
}

export default getPanelModule;
