import syncAllInOneDisplaySets from './buildAllInOneDisplaySet';
import { rehangForMode } from './rehang';
import { getBrowsingMode } from './browsingMode';

/**
 * Keep the all-in-one composites in sync with late-streaming series.
 *
 * The prior/sibling load path already refreshes composites via loadRelevantPriors'
 * re-hang poll; this covers the SINGLE-STUDY path (which builds the composite once,
 * with no poll) and any series that arrive after that settles.
 *
 * Debounced DISPLAY_SETS_ADDED listener: rebuild composites for every loaded study
 * (idempotent — an existing composite grows to its new source count), and re-hang the
 * active browsing mode ONLY when a composite is newly CREATED (so a previously
 * 'disabled' all-in-one stage becomes navigable). A composite that merely GREW needs
 * no re-hang — its stage is already enabled and re-matches the larger stack on
 * navigation — so the common case causes no disruptive re-hang. Our own composite
 * additions are ignored (the builder's source-count guard also prevents any loop).
 *
 * Registered once from the extension's preRegistration; the displaySetService is a
 * singleton, so the single subscription stays valid across mode enter/exit.
 */
export function initAllInOneAutoRefresh({
  servicesManager,
  extensionManager,
}: withAppTypes): () => void {
  const { displaySetService } = servicesManager?.services ?? {};
  if (!displaySetService?.subscribe || !displaySetService?.EVENTS?.DISPLAY_SETS_ADDED) {
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const onAdded = (event: { displaySetsAdded?: any[] } = {}) => {
    const added = event?.displaySetsAdded;
    // Skip our own composite additions (avoids an extra pass; the builder's
    // source-count guard would no-op them anyway, so there is no rebuild loop).
    if (added?.length && added.every(ds => ds?.isAllInOne)) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const { created } = syncAllInOneDisplaySets({ servicesManager, extensionManager });
        // Re-hang only when a composite first appears AND the mode actually hangs the
        // all-in-one (append/allinone). In 'manual' the active protocol has no
        // all-in-one stage, so a re-hang would gain nothing and only reset the
        // reader's hand-arranged layout.
        if (created > 0 && getBrowsingMode() !== 'manual') {
          rehangForMode(servicesManager);
        }
      } catch (error) {
        console.warn('[pacsai-hp] all-in-one auto-refresh failed', error);
      }
    }, 500);
  };

  const { unsubscribe } = displaySetService.subscribe(
    displaySetService.EVENTS.DISPLAY_SETS_ADDED,
    onAdded
  );

  return () => {
    clearTimeout(timer);
    unsubscribe?.();
  };
}

export default initAllInOneAutoRefresh;
