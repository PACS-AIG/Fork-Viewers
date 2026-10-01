import { utils } from '@ohif/core';
import { defaultRouteInit } from './defaultRouteInit';

const { getSplitParam } = utils;

/**
 * pacsai (Rev 11 milestone 6 part 2, the in-page case switch): one mode entry's
 * route init and its cleanup, scoped to the run. Moved out of Mode.tsx's effect
 * so it can be tested without React.
 *
 * An in-document case switch (the embed bridge's switchStudy: replaceState plus
 * a popstate) re-runs Mode.tsx's effect while the previous case's route init
 * can still be awaiting its metadata. Upstream kept the INSTANCES_ADDED
 * unsubscribe only once defaultRouteInit resolved, so a cleanup before that
 * leaked the subscription; and the superseded chain still applied its hanging
 * protocol (its own study as the active one), started its remaining series and
 * ran onSetupRouteComplete (the priors load) inside the next case. So:
 *  - the unsubscribe is handed to the run as it is made, and cleanup always
 *    calls it;
 *  - a run whose cleanup ran is superseded: it stops at its next step;
 *  - display sets are made only for the run's case set (RouteRun below).
 */

/** One mode entry, from its effect's start to its cleanup. */
export interface RouteRun {
  /** False once the run's cleanup ran: a superseded run stops at its next step. */
  isCurrent(): boolean;
  /** True for a study this run may make display sets for. */
  inCaseSet(StudyInstanceUID: string | undefined): boolean;
  /** Collect an unsubscribe now; one added after the run ended is called at once. */
  addUnsubscribe(unsubscribe: () => void): void;
}

type Retrieve = (...args: unknown[]) => unknown;

/** The active data source, as far as a run touches it. */
type RunDataSource = { retrieve?: { series?: { metadata?: Retrieve } } };

/** The mode's lifecycle hooks and its route, as far as the route init calls them. */
type RouteMode = {
  onModeEnter?: (props: Record<string, unknown>) => void;
  onModeExit?: (props: Record<string, unknown>) => void;
  onSetupRouteComplete?: (props: Record<string, unknown>) => void;
};
type ModeRouteDefinition = {
  init?: (
    props: Record<string, unknown>,
    hangingProtocolId: unknown,
    stageIndex: number
  ) => unknown;
};

// A run's wrapper → the data source's own retrieve, so a wrapper never wraps a
// wrapper (two runs overlapping, StrictMode's mount, unmount, mount).
const originals = new WeakMap<Retrieve, Retrieve>();

/**
 * Begin a run. Its case set is the route's studyInstanceUIDs plus every
 * StudyInstanceUID passed to the active data source's retrieve.series.metadata
 * while the run is current: a wrapper installed on the shared instance (every
 * caller gets it from extensionManager.getActiveDataSource()) records them. That
 * covers the route's own retrieves, the priors loader's priors and siblings, a
 * selectPrior pick (qualifying or not), rail expansion and study loads. What it
 * leaves out is a superseded run's study the current run never asked for.
 *
 * That holds while a stale job never calls retrieve after its case has moved
 * on: loadRelevantPriors and selectPrior check their pin after every await,
 * with no await between that check and a request (pacsai-hp priors/pinCase.ts).
 */
export function beginRouteRun({
  dataSource,
  studyInstanceUIDs,
}: {
  dataSource: RunDataSource;
  studyInstanceUIDs: string[];
}): RouteRun & { end(): void } {
  let current = true;
  const caseSet = new Set<string>((studyInstanceUIDs ?? []).filter(Boolean));
  const unsubscribes: Array<() => void> = [];

  const series = dataSource?.retrieve?.series;
  let wrapper: Retrieve | undefined;
  if (series && typeof series.metadata === 'function') {
    const installed = series.metadata;
    const original = originals.get(installed) ?? installed;
    wrapper = function (this: unknown, ...args: unknown[]) {
      const StudyInstanceUID = (args[0] as { StudyInstanceUID?: string } | undefined)
        ?.StudyInstanceUID;
      if (StudyInstanceUID) {
        caseSet.add(StudyInstanceUID);
      }
      return original.apply(this, args);
    };
    originals.set(wrapper, original);
    series.metadata = wrapper;
  }

  return {
    isCurrent: () => current,
    inCaseSet: StudyInstanceUID => !!StudyInstanceUID && caseSet.has(StudyInstanceUID),
    addUnsubscribe: unsubscribe => {
      if (current) {
        unsubscribes.push(unsubscribe);
      } else {
        unsubscribe();
      }
    },
    end: () => {
      current = false;
      // Only this run's wrapper: one a later run installed stays.
      if (wrapper && series.metadata === wrapper) {
        series.metadata = originals.get(wrapper);
      }
      unsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
    },
  };
}

/**
 * Mode.tsx's route-init effect body: set the mode up for the route's studies
 * and return the effect's cleanup. Everything but the run is upstream's, in its
 * order; the mode's onModeEnter also gets the route's studyInstanceUIDs (the
 * longitudinal mode begins the attempt trace's generation with them, not with
 * window.location, which can already name the next case).
 */
export function setupRouteInit({
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
}: withAppTypes<{
  mode: RouteMode;
  route: ModeRouteDefinition;
  dataSource: RunDataSource;
  studyInstanceUIDs: string[];
  query: URLSearchParams;
  sopClassHandlers: string[];
  hangingProtocol: string | string[];
  runTimeHangingProtocolId: string | null;
  runTimeStageId: string | null;
}>): () => void {
  const { displaySetService, hangingProtocolService } = servicesManager.services;
  const run = beginRouteRun({ dataSource, studyInstanceUIDs });

  const init = async () => {
    // TODO: For some reason this is running before the Providers
    // are calling setServiceImplementation
    // TODO -> iterate through services.

    // Extension

    // Add SOPClassHandlers to a new SOPClassManager.
    displaySetService.init(extensionManager, sopClassHandlers);

    extensionManager.onModeEnter({
      servicesManager,
      extensionManager,
      commandsManager,
      appConfig,
    });

    // use the URL hangingProtocolId if it exists, otherwise use the one
    // defined in the mode configuration
    const hangingProtocolIdToUse = hangingProtocolService.getProtocolById(runTimeHangingProtocolId)
      ? runTimeHangingProtocolId
      : hangingProtocol;

    // Determine the index of the stageId if the hangingProtocolIdToUse is defined
    const stageIndex = Array.isArray(hangingProtocolIdToUse)
      ? -1
      : hangingProtocolService.getStageIndex(hangingProtocolIdToUse, {
          stageId: runTimeStageId || undefined,
        });
    // Ensure that the stage index is never negative
    // If stageIndex is negative (e.g., if stage wasn't found), use 0 as the default
    const stageIndexToUse = Math.max(0, stageIndex);

    // Sets the active hanging protocols - if hangingProtocol is undefined,
    // resets to default.  Done before the onModeEnter to allow the onModeEnter
    // to perform custom hanging protocol actions
    hangingProtocolService.setActiveProtocolIds(hangingProtocolIdToUse);

    mode?.onModeEnter({
      servicesManager,
      extensionManager,
      commandsManager,
      appConfig,
      studyInstanceUIDs,
    });

    /**
     * The next line should get all the query parameters provided by the URL
     * - except the StudyInstanceUIDs - and create an object called filters
     * used to filtering the study as the user wants otherwise it will return
     * a empty object.
     *
     * Example:
     * const filters = {
     *   seriesInstanceUID: 1.2.276.0.7230010.3.1.3.1791068887.5412.1620253993.114611
     * }
     */
    const filters =
      Array.from(query.keys()).reduce((acc: Record<string, string>, val: string) => {
        const lowerVal = val.toLowerCase();
        // Not sure why the case matters here - it doesn't in the URL
        if (lowerVal === 'seriesinstanceuids' || lowerVal === 'seriesinstanceuid') {
          const seriesUIDs = getSplitParam(lowerVal, query);
          return {
            ...acc,
            seriesInstanceUID: seriesUIDs,
          };
        }
        return { ...acc, [val]: getSplitParam(lowerVal, query) };
      }, {}) ?? {};

    if (route.init) {
      // Upstream never used what route.init returns; neither does this.
      await route.init(
        {
          servicesManager,
          extensionManager,
          hotkeysManager,
          studyInstanceUIDs,
          dataSource,
          filters,
        },
        hangingProtocolIdToUse,
        stageIndexToUse
      );
      if (!run.isCurrent()) {
        return;
      }
    }

    await defaultRouteInit(
      {
        servicesManager,
        studyInstanceUIDs,
        dataSource,
        filters,
        appConfig,
        run,
      },
      hangingProtocolIdToUse,
      stageIndexToUse
    );
    if (!run.isCurrent()) {
      return;
    }

    // Some code may need to run after hanging protocol initialization
    // (eg: workflowStepsService initialization on 4D mode)
    mode?.onSetupRouteComplete?.({
      servicesManager,
      extensionManager,
      commandsManager,
    });
  };

  init();

  return () => {
    // The mode.onModeExit must be done first to allow it to store
    // information, and must be in a try/catch to ensure subscriptions
    // are unsubscribed.
    try {
      mode?.onModeExit?.({
        servicesManager,
        extensionManager,
        appConfig,
      });
    } catch (e) {
      console.warn('mode exit failure', e);
    }
    // The unsubscriptions must occur before the extension onModeExit
    // in order to prevent exceptions during cleanup caused by spurious events.
    // pacsai: always, and at once; this also ends the run.
    run.end();
    // The extension manager must be called after the mode, this is
    // expected to cleanup the state to a standard setup.
    extensionManager.onModeExit();
  };
}

export default setupRouteInit;
