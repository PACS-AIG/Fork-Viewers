import React from 'react';
import PanelStudyInfo from './panels/PanelStudyInfo';

/**
 * Panel module: the Study Info drawer (patient / study / series / current
 * image / documents / advanced). Registered into the longitudinal mode's
 * right panels as `@ohif/extension-pacsai-hp.panelModule.studyInfo`.
 */
export default function getPanelModule({ commandsManager, servicesManager }: withAppTypes) {
  return [
    {
      name: 'studyInfo',
      iconName: 'tab-patient-info',
      iconLabel: 'Study Info',
      label: 'Study Info',
      component: () => (
        <PanelStudyInfo
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
  ];
}
