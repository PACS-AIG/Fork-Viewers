import React, { useEffect, useState, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';
import PropTypes from 'prop-types';
import { DragAndDropProvider, ImageViewerProvider } from '@ohif/ui';
import { useSearchParams } from '@hooks';
import { useAppConfig } from '@state';
import ViewportGrid from '@components/ViewportGrid';
import Compose from './Compose';
import { history } from '../../utils/history';
import loadModules from '../../pluginImports';
import { setupRouteInit } from './setupRouteInit';
import { updateAuthServiceAndCleanUrl } from './updateAuthServiceAndCleanUrl';

export default function ModeRoute({
  mode,
  dataSourceName,
  extensionManager,
  servicesManager,
  commandsManager,
  hotkeysManager,
}: withAppTypes) {
  const [appConfig] = useAppConfig();

  // Parse route params/querystring
  const location = useLocation();

  // The react router DOM placeholder map (see https://reactrouter.com/en/main/hooks/use-params).
  const params = useParams();
  // The URL's query search parameters where the keys casing is maintained
  const query = useSearchParams();

  mode?.onModeInit?.({
    servicesManager,
    extensionManager,
    commandsManager,
    appConfig,
    query,
  });

  // The URL's query search parameters where the keys are all lower case.
  const lowerCaseSearchParams = useSearchParams({ lowerCaseKeys: true });

  const [studyInstanceUIDs, setStudyInstanceUIDs] = useState(null);

  const [refresh, setRefresh] = useState(false);
  const [ExtensionDependenciesLoaded, setExtensionDependenciesLoaded] = useState(false);

  const layoutTemplateData = useRef(false);
  const locationRef = useRef(null);
  const isMounted = useRef(false);

  // Expose the react router dom navigation.
  history.navigate = useNavigate();

  if (location !== locationRef.current) {
    layoutTemplateData.current = null;
    locationRef.current = location;
  }

  const { panelService, userAuthenticationService } = servicesManager.services;

  const { extensions, sopClassHandlers, hotkeys: hotkeyObj, hangingProtocol } = mode;

  const runTimeHangingProtocolId = lowerCaseSearchParams.get('hangingprotocolid');
  const runTimeStageId = lowerCaseSearchParams.get('stageid');
  const token = lowerCaseSearchParams.get('token');

  if (token) {
    updateAuthServiceAndCleanUrl(token, location, userAuthenticationService);
  }

  // Preserve the old array interface for hotkeys
  const hotkeys = Array.isArray(hotkeyObj) ? hotkeyObj : hotkeyObj?.hotkeys;
  const hotkeyName = hotkeyObj?.name || 'hotkey-definitions';

  // An undefined dataSourceName implies that the active data source that is already set in the ExtensionManager should be used.
  if (dataSourceName !== undefined) {
    extensionManager.setActiveDataSource(dataSourceName);
  }

  const activeDataSource = extensionManager.getActiveDataSource();
  const dataSource = activeDataSource ? activeDataSource[0] : null;

  // Only handling one route per mode for now
  const route = mode.routes[0];

  useEffect(() => {
    const loadExtensions = async () => {
      const loadedExtensions = await loadModules(Object.keys(extensions));
      for (const extension of loadedExtensions) {
        const { id: extensionId } = extension;
        if (extensionManager.registeredExtensionIds.indexOf(extensionId) === -1) {
          await extensionManager.registerExtension(extension);
        }
      }

      if (isMounted.current) {
        setExtensionDependenciesLoaded(true);
      }
    };

    loadExtensions();
  }, []);

  useEffect(() => {
    // Preventing state update for unmounted component
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ExtensionDependenciesLoaded) {
      return;
    }

    // Todo: this should not be here, data source should not care about params
    const initializeDataSource = async (params, query) => {
      await dataSource.initialize({
        params,
        query,
      });
      setStudyInstanceUIDs(dataSource.getStudyInstanceUIDs({ params, query }));
    };

    initializeDataSource(params, query);
    return () => {
      layoutTemplateData.current = null;
    };
  }, [location, ExtensionDependenciesLoaded]);

  useEffect(() => {
    if (!ExtensionDependenciesLoaded || !studyInstanceUIDs?.length) {
      return;
    }

    const retrieveLayoutData = async () => {
      const layoutData = await route.layoutTemplate({
        location,
        servicesManager,
        studyInstanceUIDs,
      });

      if (isMounted.current) {
        const { leftPanels = [], rightPanels = [], ...layoutProps } = layoutData.props;

        panelService.reset();
        panelService.addPanels(panelService.PanelPosition.Left, leftPanels);
        panelService.addPanels(panelService.PanelPosition.Right, rightPanels);

        // layoutProps contains all props but leftPanels and rightPanels
        layoutData.props = layoutProps;

        layoutTemplateData.current = layoutData;
        setRefresh(!refresh);
      }
    };
    if (Array.isArray(studyInstanceUIDs) && studyInstanceUIDs[0]) {
      retrieveLayoutData();
    }
    return () => {
      layoutTemplateData.current = null;
    };
  }, [studyInstanceUIDs, ExtensionDependenciesLoaded]);

  useEffect(() => {
    if (!hotkeys || !ExtensionDependenciesLoaded || !studyInstanceUIDs?.length) {
      return;
    }

    hotkeysManager.setDefaultHotKeys(hotkeys);

    const userPreferredHotkeys = JSON.parse(localStorage.getItem(hotkeyName));

    if (userPreferredHotkeys?.length) {
      hotkeysManager.setHotkeys(userPreferredHotkeys, hotkeyName);
    } else {
      hotkeysManager.setHotkeys(hotkeys, hotkeyName);
    }

    return () => {
      hotkeysManager.destroy();
    };
  }, [ExtensionDependenciesLoaded, hotkeys, studyInstanceUIDs]);

  useEffect(() => {
    if (!layoutTemplateData.current || !ExtensionDependenciesLoaded || !studyInstanceUIDs?.length) {
      return;
    }

    // pacsai (Rev 11 milestone 6 part 2): the setup and its cleanup live in
    // setupRouteInit.ts, scoped to this run, so a case switch that re-runs this
    // effect while the previous case is still loading cannot leave that case's
    // subscription, hang or priors load running inside the next one.
    return setupRouteInit({
      mode,
      route,
      servicesManager,
      extensionManager,
      commandsManager,
      hotkeysManager,
      appConfig,
      dataSource,
      studyInstanceUIDs,
      query,
      sopClassHandlers,
      hangingProtocol,
      runTimeHangingProtocolId,
      runTimeStageId,
    });
  }, [
    mode,
    dataSourceName,
    location,
    ExtensionDependenciesLoaded,
    route,
    servicesManager,
    extensionManager,
    hotkeysManager,
    studyInstanceUIDs,
    refresh,
  ]);

  if (!studyInstanceUIDs || !layoutTemplateData.current || !ExtensionDependenciesLoaded) {
    return null;
  }

  const ViewportGridWithDataSource = props => {
    return ViewportGrid({ ...props, dataSource });
  };

  const CombinedExtensionsContextProvider = createCombinedContextProvider(
    extensionManager,
    servicesManager,
    commandsManager
  );

  const getLayoutComponent = props => {
    const layoutTemplateModuleEntry = extensionManager.getModuleEntry(
      layoutTemplateData.current.id
    );
    const LayoutComponent = layoutTemplateModuleEntry.component;

    return <LayoutComponent {...props} />;
  };

  const LayoutComponent = getLayoutComponent({
    ...layoutTemplateData.current.props,
    ViewportGridComp: ViewportGridWithDataSource,
  });

  return (
    <ImageViewerProvider StudyInstanceUIDs={studyInstanceUIDs}>
      {CombinedExtensionsContextProvider ? (
        <CombinedExtensionsContextProvider>
          <DragAndDropProvider>{LayoutComponent}</DragAndDropProvider>
        </CombinedExtensionsContextProvider>
      ) : (
        <DragAndDropProvider>{LayoutComponent}</DragAndDropProvider>
      )}
    </ImageViewerProvider>
  );
}

/**
 * Creates a combined context provider using the context modules from the extension manager.
 * @param {object} extensionManager - The extension manager instance.
 * @param {object} servicesManager - The services manager instance.
 * @param {object} commandsManager - The commands manager instance.
 * @returns {React.Component} - A React component that provides combined contexts to its children.
 */
function createCombinedContextProvider(extensionManager, servicesManager, commandsManager) {
  const extensionsContextModules = extensionManager.getModulesByType(
    extensionManager.constructor.MODULE_TYPES.CONTEXT
  );

  if (!extensionsContextModules?.length) {
    return;
  }

  const contextModuleProviders = extensionsContextModules.flatMap(({ module }) => {
    return module.map(aContextModule => {
      return aContextModule.provider;
    });
  });

  return ({ children }) => {
    return Compose({ components: contextModuleProviders, children });
  };
}

ModeRoute.propTypes = {
  mode: PropTypes.object.isRequired,
  dataSourceName: PropTypes.string,
  extensionManager: PropTypes.object,
  servicesManager: PropTypes.object,
  hotkeysManager: PropTypes.object,
  commandsManager: PropTypes.object,
};
