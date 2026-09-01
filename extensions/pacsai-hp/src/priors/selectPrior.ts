import { requestDisplaySetCreationForStudy } from '@ohif/extension-default';

import {
  getPriorUIDs,
  getSiblingUIDs,
  setComparisonRoles,
} from './roleRegistry';
import syncAllInOneDisplaySets from '../allinone/buildAllInOneDisplaySet';
import rehangForMode from '../allinone/rehang';

/**
 * Manually override which prior the comparison hangs against — the on-image
 * prior switcher (click the date on a prior pane, pick another study).
 *
 * `loadRelevantPriors` auto-picks ONE prior per region by policy; this replaces
 * that choice at the rad's request and re-hangs, so every stage of the protocol
 * (including the all-in-one composite pane, whose selector keys on the same
 * `prior` role) now compares against the chosen study.
 *
 * Deliberately NOT a re-query: the candidate list was already discovered by the
 * patient-level QIDO at study open and published to the role registry, so this
 * only has to (1) ensure the chosen study's display sets exist, (2) re-point the
 * `prior` role, (3) re-hang the loaded studies under the active browsing mode.
 *
 * The previously hung prior is left LOADED — it simply loses its hanging role
 * (so no selector matches it) and stays one click away in the rail and in this
 * switcher, which makes flipping back and forth between two priors instant.
 */

const DEBUG = true;
const log = (...args: unknown[]) => DEBUG && console.log('[pacsai-hp]', ...args);

// A switch involves an await + a poll; ignore clicks that arrive mid-flight
// rather than racing two re-hangs against each other.
let switching = false;

export async function selectPrior({
  servicesManager,
  extensionManager,
  studyInstanceUID,
  replaceUID,
}: {
  servicesManager: any;
  extensionManager: any;
  /** The prior to hang. */
  studyInstanceUID?: string;
  /** The prior it replaces — the clicked pane's study. Omit when only one prior is hung. */
  replaceUID?: string;
}): Promise<void> {
  const { displaySetService, uiNotificationService } = servicesManager?.services ?? {};
  if (!studyInstanceUID || !displaySetService || !extensionManager || switching) {
    return;
  }

  const currentPriors = getPriorUIDs();
  if (currentPriors.includes(studyInstanceUID)) {
    log('selectPrior: already hung, ignoring', studyInstanceUID);
    return;
  }

  // Swap in place when we know which pane asked (a whole-spine hang has one prior
  // per region and must keep the others); otherwise this becomes the only prior.
  const nextPriors =
    replaceUID && currentPriors.includes(replaceUID)
      ? currentPriors.map(uid => (uid === replaceUID ? studyInstanceUID : uid))
      : [studyInstanceUID];

  const [dataSource] = extensionManager.getActiveDataSource() ?? [];
  if (!dataSource) {
    return;
  }

  switching = true;
  const notificationId = uiNotificationService?.show?.({
    title: 'Comparison',
    message: 'Loading selected prior…',
    type: 'info',
    autoClose: false,
  });
  const dismiss = () => notificationId && uiNotificationService?.hide?.(notificationId);

  try {
    log('selectPrior ->', { chosen: studyInstanceUID, replaced: replaceUID, nextPriors });

    // madeInClient = false for the same reason the loader passes false: this is
    // background loading, and `true` makes the study-browser panel scroll itself
    // and pop accordions open as if the user had jumped to the study.
    await requestDisplaySetCreationForStudy(
      dataSource,
      displaySetService,
      studyInstanceUID,
      false
    );

    setComparisonRoles({ priors: nextPriors, siblings: getSiblingUIDs() });

    const reHang = () => {
      // Build/refresh the chosen prior's all-in-one composite before matching, so
      // the all-in-one stage has something to hang beside the current study's.
      syncAllInOneDisplaySets({ servicesManager, extensionManager });
      rehangForMode(servicesManager);
    };

    /**
     * Confirm the chosen prior actually ended up in a viewport, and say so when it
     * did not. A cross-modality or off-region pick can be perfectly loaded and
     * still match no prior selector in the protocol — which reads as an empty pane
     * with no explanation, and takes the on-image switcher off screen with the
     * PRIOR pill, leaving the rad no way back. Advisory only: nothing is reverted,
     * because silently undoing an explicit choice would be worse.
     */
    const warnIfNotHung = () => {
      const { viewportGridService } = servicesManager?.services ?? {};
      // Superseded by a later switch (or the study changed) — not ours to judge.
      if (!getPriorUIDs().includes(studyInstanceUID)) {
        return;
      }
      const viewports = viewportGridService?.getState?.()?.viewports;
      const viewportIds =
        viewports instanceof Map
          ? [...viewports.keys()]
          : Array.isArray(viewports)
            ? viewports.map((v: any) => v?.viewportId).filter(Boolean)
            : [];
      // Unknown grid shape: stay silent rather than cry wolf.
      if (!viewportIds.length) {
        return;
      }
      const hung = viewportIds.some(viewportId =>
        (viewportGridService.getDisplaySetsUIDsForViewport?.(viewportId) ?? []).some(
          (uid: string) =>
            displaySetService.getDisplaySetByUID?.(uid)?.StudyInstanceUID === studyInstanceUID
        )
      );
      log('post-switch check', { prior: studyInstanceUID, hung });
      if (!hung) {
        uiNotificationService?.show?.({
          title: 'Comparison',
          message:
            'The selected prior is loaded but this protocol has no viewport for it ' +
            '(different modality or body part). Pick another prior, or view it from the study list.',
          type: 'info',
          duration: 6000,
        });
      }
    };

    // The grid remounts asynchronously after run(), so judge a beat later.
    const settle = () => {
      switching = false;
      dismiss();
      setTimeout(warnIfNotHung, 1500);
    };

    reHang();

    // The chosen study's display sets can still be finalizing right after creation
    // resolves (they carry SeriesDescription but no instance metadata yet, so they
    // are flagged `unsupported` and the matcher skips them — a blank prior pane).
    // Re-hang once it is genuinely matchable. Mirrors the loader's poll, shorter
    // window: the current study is already hung, so only the prior pane is at stake.
    const priorReady = () =>
      displaySetService
        .getActiveDisplaySets()
        .some(
          (ds: any) =>
            ds?.StudyInstanceUID === studyInstanceUID &&
            !ds?.unsupported &&
            ds?.numImageFrames > 0
        );

    if (priorReady()) {
      settle();
      return;
    }
    let elapsed = 0;
    const intervalMs = 750;
    const interval = setInterval(() => {
      elapsed += intervalMs;
      if (priorReady()) {
        clearInterval(interval);
        log('selected prior became matchable — re-hanging');
        reHang();
        settle();
      } else if (elapsed >= 20000) {
        clearInterval(interval);
        log('selected prior never became matchable within 20s');
        settle();
      }
    }, intervalMs);
    // From here the poll owns `switching` and the notification — it clears both when
    // the prior becomes matchable or the window expires, so a second click cannot
    // land mid-poll and race a competing re-hang. (No `finally` for that reason.)
  } catch (error) {
    switching = false;
    console.warn('[pacsai-hp] selectPrior failed', error);
    uiNotificationService?.show?.({
      title: 'Comparison',
      message: 'Could not load the selected prior.',
      type: 'info',
      duration: 3000,
    });
    dismiss();
  }
}

/**
 * Managers captured at extension preRegistration, so the on-image switcher can
 * trigger a swap: viewport overlay items receive `servicesManager` but neither
 * `extensionManager` (needed for the data source) nor `commandsManager`. Same
 * single-active-route assumption as the role registry's module state.
 */
let managers: { servicesManager: any; extensionManager: any } | undefined;

export function configurePriorSwitching(next: {
  servicesManager: any;
  extensionManager: any;
}): void {
  managers = next;
}

/** Switch the compared prior from the UI (the on-image prior switcher). */
export function requestPriorSwitch(opts: {
  studyInstanceUID?: string;
  replaceUID?: string;
}): void {
  if (!managers) {
    console.warn('[pacsai-hp] prior switching not configured');
    return;
  }
  void selectPrior({ ...managers, ...opts });
}

export default selectPrior;
