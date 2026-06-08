import { DicomMetadataStore } from '@ohif/core';
import {
  getStudiesForPatientByMRN,
  requestDisplaySetCreationForStudy,
} from '@ohif/extension-default';

import { getPriorPolicy } from './priorPolicy';
import scorePrior from './scorePrior';
import type { StudyLike } from './types';

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

// Temporary verbose logging to debug prior selection. Set to false to silence.
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
    const current = qidoForStudyUID[0] as StudyLike;
    log('current study', {
      uid: current.StudyInstanceUID,
      Modality: current.Modality,
      ModalitiesInStudy: current.ModalitiesInStudy,
      StudyDescription: current.StudyDescription,
      mrn: (current as Record<string, unknown>).mrn ?? current.PatientID,
    });

    let patientStudies: StudyLike[];
    try {
      patientStudies = (await getStudiesForPatientByMRN(dataSource, qidoForStudyUID)) ?? [];
    } catch (error) {
      console.warn('[pacsai-hp] Failed to query patient studies for priors', error);
      return;
    }
    log(`patient query returned ${patientStudies.length} studies`);

    const scored = patientStudies
      .filter(study => study?.StudyInstanceUID && study.StudyInstanceUID !== currentStudyUID)
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

    // Build an explicit, ordered studies array: current first (index 0), then
    // priors by descending relevance. Never rely on implicit date sorting.
    const orderedStudies = [
      DicomMetadataStore.getStudy(currentStudyUID),
      ...ranked.map(({ prior }) => DicomMetadataStore.getStudy(prior.StudyInstanceUID)),
    ].filter(Boolean);

    const activeStudy = orderedStudies[0];
    log(
      're-hanging',
      protocol.id,
      'with studies',
      orderedStudies.map(s => s?.StudyInstanceUID)
    );
    hangingProtocolService.run(
      {
        studies: orderedStudies,
        displaySets: displaySetService.getActiveDisplaySets(),
        activeStudy,
      },
      protocol.id
    );
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
