import { useEffect, useState, memo } from 'react';

const ActiveViewportBehavior = memo(
  ({ servicesManager, viewportId }: withAppTypes<{ viewportId: string }>) => {
    const { displaySetService, cineService, viewportGridService, customizationService } =
      servicesManager.services;

    const [activeViewportId, setActiveViewportId] = useState(viewportId);
    // Re-run the cine check when the grid content changes too — hanging a new
    // displaySet into the ALREADY-ACTIVE viewport doesn't change the active id, so
    // without this a dynamic (4D) or US/XA series swapped into the active pane
    // never auto-enabled the cine player (PACS AI fix).
    const [gridTick, setGridTick] = useState(0);

    useEffect(() => {
      const subscription = viewportGridService.subscribe(
        viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
        ({ viewportId }) => setActiveViewportId(viewportId)
      );
      const gridSubscription = viewportGridService.subscribe(
        viewportGridService.EVENTS.GRID_STATE_CHANGED,
        () => setGridTick(tick => tick + 1)
      );

      return () => {
        subscription.unsubscribe();
        gridSubscription.unsubscribe();
      };
    }, [viewportId, viewportGridService]);

    useEffect(() => {
      if (cineService.isViewportCineClosed(activeViewportId)) {
        return;
      }

      const displaySetInstanceUIDs =
        viewportGridService.getDisplaySetsUIDsForViewport(activeViewportId);

      if (!displaySetInstanceUIDs) {
        return;
      }

      const displaySets = displaySetInstanceUIDs.map(uid =>
        displaySetService.getDisplaySetByUID(uid)
      );

      if (!displaySets.length) {
        return;
      }

      const modalities = displaySets.map(displaySet => displaySet?.Modality);
      const isDynamicVolume = displaySets.some(displaySet => displaySet?.isDynamicVolume);

      const sourceModalities = customizationService.getCustomization('autoCineModalities');

      const requiresCine = modalities.some(modality => sourceModalities.includes(modality));

      if ((requiresCine || isDynamicVolume) && !cineService.getState().isCineEnabled) {
        cineService.setIsCineEnabled(true);
      }
    }, [
      activeViewportId,
      gridTick,
      cineService,
      viewportGridService,
      displaySetService,
      customizationService,
    ]);

    return null;
  },
  arePropsEqual
);

ActiveViewportBehavior.displayName = 'ActiveViewportBehavior';

function arePropsEqual(prevProps, nextProps) {
  return (
    prevProps.viewportId === nextProps.viewportId &&
    prevProps.servicesManager === nextProps.servicesManager
  );
}

export default ActiveViewportBehavior;
