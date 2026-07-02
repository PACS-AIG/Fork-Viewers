/**
 * Self-healing binder for the pacsai scroll syncs (compare 2-ups, multi-WL panes,
 * all-in-one compare).
 *
 * Stage viewport `syncGroups` (types `pacsaiscroll` / `pacsaiallinonescroll`) are
 * applied in OHIFCornerstoneViewport's ELEMENT_ENABLED handler
 * (addViewportToSyncGroup). Two cs3d Synchronizer quirks make that binding fragile
 * across the prior-discovery / composite re-hangs:
 *
 *  1. NEVER-BOUND (race): when the grid keeps a pane's element across a stage
 *     transition (same viewportId), ELEMENT_ENABLED does not re-fire, so the new
 *     stage's syncGroups are never applied to that pane.
 *
 *  2. BOUND-BUT-DEAD (stale element): cs3d attaches the scroll event listener to the
 *     viewport's ELEMENT at add time (`addSource` → element.addEventListener), and its
 *     membership guard makes `addSource` a NO-OP when the viewport is already listed —
 *     WITHOUT re-attaching the listener. If a pane's element is recreated while its
 *     membership lingers (the ELEMENT_DISABLED auto-remove can miss when the viewport
 *     is already gone from the rendering engine at disable time), the listener dies
 *     with the old element and NOTHING can heal it: OHIF's ELEMENT_ENABLED
 *     re-application no-ops on the membership guard, and a naive "skip if bound"
 *     rebinder is fooled the same way. Deterministically dead sync for that hang.
 *     (removeSource also can't detach the real listener — it was added as a fresh
 *     `_onEvent.bind(this)` but removed as `_eventHandler` — so remove+re-add can
 *     leave a duplicate listener on the SAME element. Harmless here: the pacsai sync
 *     callbacks are idempotent, and we only churn a binding when its element changed
 *     or it was missing.)
 *
 *  3. STALE viewportInfo (memo-blocked): OHIFCornerstoneViewport's React memo
 *     comparator (`areEqual`) checks orientation / toolGroupId / viewportType /
 *     displaySet imageIds but IGNORES syncGroups. A stage transition that keeps a
 *     pane's viewportId AND displaySet (e.g. CT head: multi-WL 3-up pane 0 → axial
 *     compare pane 0, both the current-axial series) is memo-equal, so the pane never
 *     re-renders, setViewportData never runs, and cornerstoneViewportService's
 *     viewportInfo keeps the PREVIOUS stage's viewportOptions. The pane stays bound to
 *     the old stage's sync group while its partner pane binds the new one — two
 *     different groups, deterministically dead sync (live-confirmed via the state
 *     dump: pane 'default' want/bound `-multiwl-0` while the prior pane had
 *     `-scroll-ax-0`). Therefore the want-truth below comes from the GRID state's
 *     viewportOptions (the re-hang always updates those), NOT from viewportInfo.
 *
 * Fix: after the layout settles, re-assert every pacsai binding against the grid
 * state's syncGroups, tracking WHICH element each (syncGroup, viewport) binding was
 * attached to. A binding is healthy only if it exists AND was made against the pane's
 * current element; otherwise remove-then-re-add (remove splices the membership so add
 * really re-attaches the listener to the current element). Bindings whose group id is
 * not wanted by the current grid state (previous stage's ghosts — incl. the stale
 * viewportInfo binding of quirk 3) are removed. Debounced, and a cheap no-op for
 * layouts with no pacsai sync groups.
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

  // Element each (syncGroupId, viewportId) binding was last attached to. cs3d wires
  // the event listener to the element at add time, so "still a member" does NOT mean
  // "still listening" — only a binding made against the pane's CURRENT element is.
  const attachedElements = new Map<string, HTMLElement>();
  const bindingKey = (syncId: string, viewportId: string) => `${syncId}|${viewportId}`;

  const reassert = () => {
    const { viewports } = viewportGridService.getState() ?? {};
    if (!viewports?.size) {
      return;
    }

    const summary: Array<Record<string, unknown>> = [];

    viewports.forEach((gridViewport: any, viewportId: string) => {
      try {
        const info = cornerstoneViewportService.getViewportInfo(viewportId);
        if (!info) {
          return;
        }
        // Want-truth = the GRID's viewportOptions (always updated by a re-hang), NOT
        // viewportInfo.getSyncGroups() — viewportInfo can be memo-stale (quirk 3).
        const wanted = (gridViewport?.viewportOptions?.syncGroups ?? []).filter((g: any) =>
          PACSAI_SCROLL_SYNC_TYPES.includes(g?.type)
        );
        const renderingEngineId = info.getRenderingEngineId?.();

        const pacsaiSynchronizers = PACSAI_SCROLL_SYNC_TYPES.flatMap(
          t => syncGroupService.getSynchronizersOfType?.(t) ?? []
        ).filter(Boolean);
        const boundIds = pacsaiSynchronizers
          .filter(
            (s: any) =>
              s.hasSourceViewport?.(renderingEngineId, viewportId) ||
              s.hasTargetViewport?.(renderingEngineId, viewportId)
          )
          .map((s: any) => s.id);

        if (!wanted.length && !boundIds.length) {
          return; // no pacsai-synced pane — nothing to do
        }

        const element = cornerstoneViewportService.getCornerstoneViewport?.(viewportId)
          ?.element as HTMLElement | undefined;
        const wantedIds = new Set(wanted.map((g: any) => g.id ?? g.type));
        const healed: string[] = [];
        const unbound: string[] = [];

        // Drop bindings left over from a previous stage — ghost cross-stage syncs.
        boundIds
          .filter(id => !wantedIds.has(id))
          .forEach(id => {
            syncGroupService.removeViewportFromSyncGroup(viewportId, renderingEngineId, id);
            attachedElements.delete(bindingKey(id, viewportId));
            unbound.push(id);
          });

        wanted.forEach((group: any) => {
          const id = group.id ?? group.type;
          if (!element) {
            return; // pane not enabled yet — ELEMENT_ENABLED will bind it on mount
          }
          const key = bindingKey(id, viewportId);
          if (boundIds.includes(id) && attachedElements.get(key) === element) {
            return; // bound against the current element — healthy, leave it
          }
          // Missing, or bound against a previous/unknown element (listener dead or
          // unverifiable). Remove first: cs3d addSource no-ops on an existing member
          // WITHOUT re-attaching the element listener — membership must be spliced
          // for the add to really re-wire.
          syncGroupService.removeViewportFromSyncGroup(viewportId, renderingEngineId, id);
          syncGroupService.addViewportToSyncGroup(viewportId, renderingEngineId, group);
          attachedElements.set(key, element);
          healed.push(id);
        });

        if (DEBUG) {
          summary.push({
            viewportId,
            want: [...wantedIds],
            bound: boundIds,
            healed,
            unbound,
            hasElement: !!element,
          });
        }
      } catch (e) {
        if (DEBUG) {
          console.warn('[pacsai-hp] scroll-sync rebind skipped', viewportId, e);
        }
      }
    });

    if (DEBUG && summary.length) {
      console.log('[pacsai-hp] scroll-sync state', summary);
    }
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
