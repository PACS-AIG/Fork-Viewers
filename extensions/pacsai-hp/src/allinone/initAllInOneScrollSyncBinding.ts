/**
 * Self-healing binder for the all-in-one compare scroll sync.
 *
 * The sync between the current|prior all-in-one panes is declared via the stage's
 * viewport `syncGroups` (type `pacsaiallinonescroll`), which OHIF applies in
 * OHIFCornerstoneViewport's ELEMENT_ENABLED handler (addViewportToSyncGroup). That
 * binding is RACY for this stage: the all-in-one composites are built late (they
 * stream in, then loadRelevantPriors / the auto-refresh re-hang), so the 2-up is
 * often reached by TRANSITIONING from a 1-up / no-sync stage. When the grid keeps a
 * viewport's element across that transition (same viewportId), ELEMENT_ENABLED does
 * NOT re-fire, so the stage's syncGroups are never applied to that pane — leaving one
 * (or both) panes unbound and the sync silently dead. Timing-dependent => intermittent
 * ("scrolling stopped at random, not cache").
 *
 * Fix: after the layout settles, re-assert the binding — for every visible viewport
 * that carries a `pacsaiallinonescroll` syncGroup but is NOT currently in that
 * synchronizer, add it. Idempotent (skips already-bound viewports), debounced, and a
 * cheap no-op for every non-all-in-one layout (no viewport has the group). Does NOT
 * touch `pacsaiscroll` or any other sync, so the verified-live compare syncs are
 * unaffected.
 */

// Matches ALL_IN_ONE_SCROLL_SYNC_TYPE in index.tsx and the syncGroups `type` emitted by
// hpAllInOne / buildCompareProtocol's allInOneViewport. Kept literal to avoid importing
// from index.tsx (which imports this module — would be circular).
const ALL_IN_ONE_SCROLL_SYNC_TYPE = 'pacsaiallinonescroll';

// Coalesce the burst of grid events fired during a single hang/stage change, and run
// AFTER the enable/disable churn (incl. the teardown removals) has settled so the
// re-asserted binding isn't clobbered by a late removeViewportFromSyncGroup.
const SETTLE_DEBOUNCE_MS = 350;

const DEBUG = true; // flip off with DEBUG_SYNC once the sync is confirmed reliable

function initAllInOneScrollSyncBinding({
  servicesManager,
}: {
  servicesManager: AppTypes.ServicesManager;
}): void {
  const { viewportGridService, cornerstoneViewportService, syncGroupService } =
    servicesManager.services;

  if (!viewportGridService || !cornerstoneViewportService || !syncGroupService) {
    return;
  }

  const reassert = () => {
    const { viewports } = viewportGridService.getState() ?? {};
    if (!viewports?.size) {
      return;
    }

    viewports.forEach((_viewport: any, viewportId: string) => {
      try {
        const info = cornerstoneViewportService.getViewportInfo(viewportId);
        const groups = (info?.getSyncGroups?.() ?? []).filter(
          (g: any) => g?.type === ALL_IN_ONE_SCROLL_SYNC_TYPE
        );
        if (!groups.length) {
          return; // not an all-in-one compare pane — nothing to do
        }

        const renderingEngineId = info.getRenderingEngineId?.();
        const bound = syncGroupService.getSynchronizersForViewport?.(viewportId) ?? [];

        groups.forEach((group: any) => {
          const id = group.id ?? group.type;
          if (bound.some((s: any) => s?.id === id)) {
            return; // already bound — leave it
          }
          syncGroupService.addViewportToSyncGroup(viewportId, renderingEngineId, group);
          if (DEBUG) {
            console.log('[pacsai-hp] allinone-sync rebound', { viewportId, id });
          }
        });
      } catch (e) {
        if (DEBUG) {
          console.warn('[pacsai-hp] allinone-sync rebind skipped', viewportId, e);
        }
      }
    });
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(reassert, SETTLE_DEBOUNCE_MS);
  };

  const { EVENTS } = viewportGridService;
  [
    EVENTS.VIEWPORTS_READY,
    EVENTS.LAYOUT_CHANGED,
    EVENTS.GRID_STATE_CHANGED,
    EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
  ].forEach(evt => evt && viewportGridService.subscribe(evt, schedule));
}

export default initAllInOneScrollSyncBinding;
