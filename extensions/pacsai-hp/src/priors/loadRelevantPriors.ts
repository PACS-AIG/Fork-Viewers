import { DicomMetadataStore } from '@ohif/core';
import {
  getStudiesForPatientByMRN,
  requestDisplaySetCreationForStudy,
} from '@ohif/extension-default';

import { getPriorPolicy } from './priorPolicy';
import scorePrior from './scorePrior';
import type { StudyLike } from './types';
import getImagePlane from '../utils/getImagePlane';
import getImageKernel from '../utils/getImageKernel';

/**
 * Auto-loads the most relevant prior study/studies for the active study and
 * re-hangs the active comparison protocol so current and priors appear side by
 * side (ClearCanvas-style relevant priors).
 *
 * Flow:
 *   1. The active protocol must be a pacsai compare protocol with a prior policy.
 *   2. QIDO the patient's studies, score each candidate prior, keep those above
 *      `minScore`, sort descending, take the top `maxPriors`.
 *   3. Load display sets for the chosen priors.
 *   4. Re-run the protocol with an explicit `[current, ...priorsByScore]` study
 *      order — the order maps to `studyInstanceUIDsIndex` used by the selectors.
 *
 * Safe to call once per study open from `onSetupRouteComplete`; it no-ops for
 * non-comparison protocols, data sources without patient query, and patients
 * with no qualifying priors.
 */

// Guards against concurrent re-entry for the same active study.
const inFlight = new Set<string>();

/**
 * Normalize an OHIF QIDO study-summary object (see DicomWebDataSource/qido.js:
 * `{ studyInstanceUid, date, description, modalities, mrn, ... }`) into the
 * StudyLike shape the scorers expect. The QIDO result does NOT use DICOM
 * keyword casing, so we remap explicitly.
 */
function toStudyLike(qido: Record<string, unknown> = {}): StudyLike {
  return {
    StudyInstanceUID: (qido.studyInstanceUid ?? qido.StudyInstanceUID) as string,
    StudyDate: (qido.date ?? qido.StudyDate) as string,
    StudyDescription: (qido.description ?? qido.StudyDescription) as string,
    // `modalities` is a (possibly backslash-delimited) string; getModality handles it.
    ModalitiesInStudy: (qido.modalities ?? qido.ModalitiesInStudy) as string,
    PatientID: (qido.mrn ?? qido.PatientID) as string,
  };
}

// Verbose logging to debug prior selection. Flip to true when troubleshooting.
const DEBUG = true;
const log = (...args: unknown[]) => DEBUG && console.log('[pacsai-hp]', ...args);

export async function loadRelevantPriors({ servicesManager, extensionManager }: withAppTypes) {
  const { hangingProtocolService, displaySetService, customizationService, uiNotificationService } =
    servicesManager?.services ?? {};

  if (!hangingProtocolService || !displaySetService || !extensionManager) {
    return;
  }

  const { protocol } = hangingProtocolService.getActiveProtocol() ?? {};
  log('loadRelevantPriors invoked. active protocol =', protocol?.id);
  if (!protocol?.id) {
    return;
  }

  const policy = getPriorPolicy(protocol.id, customizationService);
  if (!policy) {
    log('no prior policy for active protocol — skipping (not a comparison protocol)');
    return;
  }
  log('policy', { minScore: policy.minScore, maxPriors: policy.maxPriors });

  const currentStudyUID = hangingProtocolService.getState()?.activeStudyUID;
  if (!currentStudyUID || inFlight.has(currentStudyUID)) {
    return;
  }

  const [dataSource] = extensionManager.getActiveDataSource();
  // Patient-level query is required to discover priors; bail gracefully otherwise.
  if (typeof dataSource?.query?.studies?.search !== 'function') {
    return;
  }

  inFlight.add(currentStudyUID);
  try {
    const qidoForStudyUID = await dataSource.query.studies.search({
      studyInstanceUid: currentStudyUID,
    });
    if (!qidoForStudyUID?.length) {
      return;
    }
    const current = toStudyLike(qidoForStudyUID[0]);
    log('current study', current);

    let patientStudies: Array<Record<string, unknown>>;
    try {
      patientStudies = (await getStudiesForPatientByMRN(dataSource, qidoForStudyUID)) ?? [];
    } catch (error) {
      console.warn('[pacsai-hp] Failed to query patient studies for priors', error);
      return;
    }
    log(`patient query returned ${patientStudies.length} studies`);

    const scored = patientStudies
      .map(toStudyLike)
      .filter(study => study.StudyInstanceUID && study.StudyInstanceUID !== currentStudyUID)
      .map(prior => ({ prior, score: scorePrior({ current, prior }, policy.scorers) }));

    log(
      'candidate priors with scores',
      scored.map(({ prior, score }) => ({
        uid: prior.StudyInstanceUID,
        score,
        StudyDescription: prior.StudyDescription,
        StudyDate: prior.StudyDate,
        ModalitiesInStudy: prior.ModalitiesInStudy,
      }))
    );

    const ranked = scored
      .filter(({ score }) => score >= policy.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, policy.maxPriors);

    log(`${ranked.length} prior(s) passed minScore=${policy.minScore}`);

    if (!ranked.length) {
      // No qualifying priors — the current-only fallback stage already hangs.
      return;
    }

    // Load display sets for each chosen prior (short-circuits if already loaded).
    await Promise.all(
      ranked.map(({ prior }) =>
        requestDisplaySetCreationForStudy(
          dataSource,
          displaySetService,
          prior.StudyInstanceUID,
          true
        )
      )
    );

    const priorUIDs = ranked.map(({ prior }) => prior.StudyInstanceUID);

    // Re-hang with current (index 0) + priors, ordered. Always rebuild from the
    // latest study/display-set state so late-loading series are picked up.
    const reHang = () => {
      const orderedStudies = [
        DicomMetadataStore.getStudy(currentStudyUID),
        ...priorUIDs.map(uid => DicomMetadataStore.getStudy(uid)),
      ].filter(Boolean);
      if (!orderedStudies.length) {
        return;
      }
      const activeDisplaySets = displaySetService.getActiveDisplaySets();
      if (DEBUG) {
        activeDisplaySets.forEach((d: any) => {
          const inst = d?.instances?.[Math.floor((d?.instances?.length ?? 1) / 2)] ??
            d?.instances?.[0] ?? d?.images?.[0] ?? d;
          const iop = (inst?.ImageOrientationPatient ?? d?.ImageOrientationPatient) as
            | number[]
            | undefined;
          const role = d?.StudyInstanceUID === currentStudyUID ? 'CUR' : 'PRI';
          const iopStr = Array.isArray(iop)
            ? iop.map(n => Number(n).toFixed(3)).join(',')
            : 'none';
          log(
            `series ${role} | "${d?.SeriesDescription}" | n=${d?.numImageFrames} | ` +
              `mod=${d?.Modality} | plane=${getImagePlane(d)} | kernel=${getImageKernel(d)} | ` +
              `IOP=[${iopStr}]`
          );
        });
        log('ordered studies for run()', [currentStudyUID, ...priorUIDs]);
      }
      hangingProtocolService.run(
        {
          studies: orderedStudies,
          displaySets: activeDisplaySets,
          activeStudy: orderedStudies[0],
        },
        protocol.id
      );
    };

    // The current study's series may still be loading (numImageFrames not yet
    // populated), so a single re-hang can find the prior but not the current.
    // Re-hang as display sets arrive until the current study has a usable series,
    // then stop. A timeout guards against listening forever.
    const currentReady = () =>
      displaySetService
        .getActiveDisplaySets()
        .some(ds => ds?.StudyInstanceUID === currentStudyUID && ds?.numImageFrames > 0);

    log('re-hanging', protocol.id, 'with studies', [currentStudyUID, ...priorUIDs]);
    reHang();

    if (!currentReady()) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const subscription = displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SETS_ADDED,
        () => {
          reHang();
          if (currentReady()) {
            clearTimeout(timer);
            subscription?.unsubscribe?.();
          }
        }
      );
      // Stop listening after a while regardless (current study may have no usable series).
      timer = setTimeout(() => subscription?.unsubscribe?.(), 30000);
    }
  } catch (error) {
    console.warn('[pacsai-hp] loadRelevantPriors failed', error);
    uiNotificationService?.show?.({
      title: 'Relevant priors',
      message: 'Could not load prior studies for comparison.',
      type: 'info',
      duration: 3000,
    });
  } finally {
    inFlight.delete(currentStudyUID);
  }
}

export default loadRelevantPriors;
