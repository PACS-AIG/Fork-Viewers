/**
 * Self-healing binder for the pacsai scroll syncs (compare 2-ups, multi-WL panes,
 * all-in-one compare).
 *
 * Stage viewport `syncGroups` (types `pacsaiscroll` / `pacsaiallinonescroll`) are
 * applied in OHIFCornerstoneViewport's ELEMENT_ENABLED handler
 * (addViewportToSyncGroup). That binding is RACY for any stage reached via a re-hang:
 * the study first hangs a current-only / no-sync stage (priors not yet discovered,
 * composites not yet built), then loadRelevantPriors / the auto-refresh re-hangs into
 * the synced stage. When the grid keeps a viewport's element across that transition
 * (same viewportId), ELEMENT_ENABLED does NOT re-fire, so the stage's syncGroups are
 * never applied to that pane — leaving one (or both) panes unbound and the sync
 * silently dead. Timing-dependent => intermittent ("current/prior scroll sync dead on
 * some loads"). Originally diagnosed + fixed for the all-in-one sync only; the compare
 * stages' `pacsaiscroll` groups hit the identical race.
 *
 * Fix: after the layout settles, re-assert the binding — for every visible viewport
 * that carries a pacsai scroll syncGroup but is NOT currently in that synchronizer,
 * add it. getViewportInfo().getSyncGroups() always reflects the CURRENT hang, so this
 * never resurrects a previous stage's groups. Idempotent (skips already-bound
 * viewports), debounced, and a cheap no-op for layouts with no pacsai sync groups.
 */

// Matches SCROLL_SYNC_TYPE / ALL_IN_ONE_SCROLL_SYNC_TYPE in index.tsx and the
// syncGroups `type` emitted by buildCompareProtocol / hpAllInOne. Kept literal to
// avoid importing from index.tsx (which imports this module — would be circular).
const PACSAI_SCROLL_SYNC_TYPES = ['pacsaiscroll', 'pacsaiallinonescroll'];

// Coalesce the burst of grid events fired during a single hang/stage change, and run
// AFTER the enable/disable churn (incl. the teardown removals) has settled so the
// re-asserted binding isn't clobbered by a late removeViewportFromSyncGroup.
const SETTLE_DEBOUNCE_MS = 350;

const DEBUG = true; // flip off with DEBUG_SYNC once the sync is confirmed reliable

function initScrollSyncBinding({
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
        const groups = (info?.getSyncGroups?.() ?? []).filter((g: any) =>
          PACSAI_SCROLL_SYNC_TYPES.includes(g?.type)
        );
        if (!groups.length) {
          return; // no pacsai-synced pane — nothing to do
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
            console.log('[pacsai-hp] scroll-sync rebound', { viewportId, id, type: group.type });
          }
        });
      } catch (e) {
        if (DEBUG) {
          console.warn('[pacsai-hp] scroll-sync rebind skipped', viewportId, e);
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

export default initScrollSyncBinding;
