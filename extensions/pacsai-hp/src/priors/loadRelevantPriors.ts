import { DicomMetadataStore } from '@ohif/core';
import {
  getStudiesForPatientByMRN,
  requestDisplaySetCreationForStudy,
} from '@ohif/extension-default';

import { getPriorPolicy } from './priorPolicy';
import scorePrior from './scorePrior';
import { setComparisonRoles } from './roleRegistry';
import { getBodyPart, getSpineRegion, isSpine, parseStudyDate } from './metadata';
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
 *   3. For a multi-part study (spine), also pick same-session sibling regions for
 *      the whole-spine overview.
 *   4. Register comparison roles (prior/sibling) and load their display sets.
 *   5. Re-run the protocol. Matching is role-/region-based (`pacsaiRole`,
 *      `pacsaiSpineRegion`), so it is independent of the study order passed to run().
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

  // Persistent "setting up" indicator, shown once we commit to loading a prior
  // and dismissed when the comparison finishes settling (or on timeout/error).
  // `let` (not const) so the async poll's closure can clear it after this
  // function has already returned.
  let loadingId: string | undefined;
  const dismissLoading = () => {
    if (loadingId) {
      uiNotificationService?.hide?.(loadingId);
      loadingId = undefined;
    }
  };

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

    const candidates = patientStudies
      .map(toStudyLike)
      .filter(study => study.StudyInstanceUID && study.StudyInstanceUID !== currentStudyUID);

    const curBody = getBodyPart(current);
    const curDate = parseStudyDate(current);
    const isSpineRegionStudy = isSpine(curBody) && curBody !== 'spine';

    let priorUIDs: string[] = [];
    let siblingUIDs: string[] = [];

    if (isSpineRegionStudy) {
      // Multi-region spine session: each region (the opened one + same-day sibling
      // regions) is compared to ITS OWN prior. Siblings = same-day, different-region
      // spine studies; per-region priors = best same-region prior for each session
      // region (scored against THAT region's session study so recency/region match).
      const siblingStudies = candidates.filter(s => {
        const b = getBodyPart(s);
        return (
          isSpine(b) && b !== 'spine' && b !== curBody && curDate !== undefined && parseStudyDate(s) === curDate
        );
      });
      siblingUIDs = siblingStudies.map(s => s.StudyInstanceUID);

      // One session study per region (opened study wins for its region).
      const sessionByRegion = new Map<string, StudyLike>([[curBody, current]]);
      siblingStudies.forEach(s => {
        const b = getBodyPart(s);
        if (!sessionByRegion.has(b)) {
          sessionByRegion.set(b, s);
        }
      });
      const sessionUIDs = new Set<string>([currentStudyUID, ...siblingUIDs]);

      for (const [region, sessionStudy] of sessionByRegion) {
        const ranked = candidates
          .filter(s => !sessionUIDs.has(s.StudyInstanceUID) && getBodyPart(s) === region)
          .map(prior => ({ prior, score: scorePrior({ current: sessionStudy, prior }, policy.scorers) }))
          .filter(({ score }) => score >= policy.minScore)
          .sort((a, b) => b.score - a.score);
        log(
          `region ${region}: ${ranked.length} prior candidate(s)`,
          ranked.map(({ prior, score }) => ({ score, desc: prior.StudyDescription, date: prior.StudyDate }))
        );
        if (ranked.length) {
          priorUIDs.push(ranked[0].prior.StudyInstanceUID);
        }
      }
    } else {
      // Single-study (non-multi-region): the established global scoring.
      const scored = candidates.map(prior => ({ prior, score: scorePrior({ current, prior }, policy.scorers) }));
      log(
        'candidate priors with scores',
        scored.map(({ prior, score }) => ({
          uid: prior.StudyInstanceUID,
          score,
          StudyDescription: prior.StudyDescription,
          StudyDate: prior.StudyDate,
        }))
      );
      priorUIDs = scored
        .filter(({ score }) => score >= policy.minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, policy.maxPriors)
        .map(({ prior }) => prior.StudyInstanceUID);
    }

    // Register roles BEFORE any (re)hang so the role-based current/prior selectors,
    // the region-timepoint compare selectors, and the overview resolve correctly.
    setComparisonRoles({ priors: priorUIDs, siblings: siblingUIDs });

    log(`${priorUIDs.length} prior(s), ${siblingUIDs.length} sibling region(s) to load`);

    if (!priorUIDs.length && !siblingUIDs.length) {
      // Nothing extra to load — the current-only fallback stage already hangs.
      return;
    }

    loadingId = uiNotificationService?.show?.({
      title: 'Comparison',
      message: 'Setting up hanging protocol…',
      type: 'info',
      autoClose: false,
    });

    // Studies to add beside the current one: chosen prior(s) then sibling regions.
    const extraUIDs = [...priorUIDs, ...siblingUIDs];

    // Ensure full display-set creation for the current study and each extra study
    // (short-circuits if already loaded). Awaiting the current study makes it
    // matchable deterministically — without this it can still be a half-loaded
    // "shell" when we re-hang, which is what the poll below otherwise waits out.
    await Promise.all(
      [currentStudyUID, ...extraUIDs].map(uid =>
        requestDisplaySetCreationForStudy(dataSource, displaySetService, uid, true)
      )
    );

    // Re-hang with current (index 0) + priors + sibling regions, ordered. Matching
    // is role-/region-based (not order-based), so order only affects the prior
    // overlay's "current first" assumption. Always rebuild from the latest study/
    // display-set state so late-loading series are picked up.
    const reHang = () => {
      const orderedStudies = [
        DicomMetadataStore.getStudy(currentStudyUID),
        ...extraUIDs.map(uid => DicomMetadataStore.getStudy(uid)),
      ].filter(Boolean);
      if (!orderedStudies.length) {
        return;
      }
      const activeDisplaySets = displaySetService.getActiveDisplaySets();
      if (DEBUG) {
        const priorSet = new Set(priorUIDs);
        activeDisplaySets.forEach((d: any) => {
          const inst = d?.instances?.[Math.floor((d?.instances?.length ?? 1) / 2)] ??
            d?.instances?.[0] ?? d?.images?.[0] ?? d;
          const iop = (inst?.ImageOrientationPatient ?? d?.ImageOrientationPatient) as
            | number[]
            | undefined;
          const role =
            d?.StudyInstanceUID === currentStudyUID
              ? 'CUR'
              : priorSet.has(d?.StudyInstanceUID)
                ? 'PRI'
                : 'SIB';
          const iopStr = Array.isArray(iop)
            ? iop.map(n => Number(n).toFixed(3)).join(',')
            : 'none';
          // StudyDescription/region drive the overview selectors — surface them so
          // a missing StudyDescription (→ no region → no overview) is diagnosable.
          const studyDesc = inst?.StudyDescription ?? d?.StudyDescription ?? '';
          const region = getSpineRegion(String(studyDesc));
          log(
            `series ${role} | "${d?.SeriesDescription}" | n=${d?.numImageFrames} | ` +
              `mod=${d?.Modality} | unsupported=${!!d?.unsupported} | imageIds=${
                d?.imageIds?.length ?? d?.images?.length ?? 0
              } | plane=${getImagePlane(
                d,
                activeDisplaySets.filter((s: any) => s?.StudyInstanceUID === d?.StudyInstanceUID)
              )} | kernel=${getImageKernel(d)} | region=${region ?? '-'} | studyDesc="${studyDesc}" | IOP=[${iopStr}]`
          );
        });
        log('ordered studies for run()', [currentStudyUID, ...extraUIDs]);
      }
      hangingProtocolService.run(
        {
          studies: orderedStudies,
          displaySets: activeDisplaySets,
          activeStudy: orderedStudies[0],
        },
        protocol.id
      );

      // Debug: after the hang settles, log what actually landed in each viewport of
      // the ACTIVE stage (matched series) vs the available pool, so missing/wrong
      // matches are easy to spot. Deferred a tick because the grid updates on event.
      if (DEBUG) {
        const dump = () => {
          const { protocol: active, stage } = hangingProtocolService.getActiveProtocol?.() ?? {};
          const stageModel = active?.stages?.[hangingProtocolService.getState?.()?.stageIndex ?? 0] ?? stage;
          const byUID = new Map(activeDisplaySets.map((d: any) => [d.displaySetInstanceUID, d]));
          const gridViewports = servicesManager?.services?.viewportGridService?.getState?.()?.viewports;
          log(`ACTIVE STAGE "${stageModel?.id ?? '?'}" matched viewports:`);
          gridViewports?.forEach?.((vp: any, viewportId: string) => {
            const descs = (vp?.displaySetInstanceUIDs ?? [])
              .map((uid: string) => byUID.get(uid))
              .map((d: any) => (d ? `${d.SeriesDescription} [${d.StudyInstanceUID === currentStudyUID ? 'CUR' : 'other'}]` : '?'));
            log(`  viewport ${viewportId} <- ${descs.join(', ') || '(empty)'}`);
          });
        };
        // setTimeout(0) is unavailable to guarantee here; use a microtask + best-effort.
        Promise.resolve().then(dump);
      }
    };

    // The current study's display sets can still be half-loaded "shell" sets when
    // we first re-hang: they carry SeriesDescription + numImageFrames but instance
    // metadata hasn't arrived, so they're flagged `unsupported` and the matcher
    // skips them (HangingProtocolService._matchImages filters `!unsupported`) —
    // leaving a blank viewport. Re-hang as display sets arrive/update until the
    // current study has a MATCHABLE series (supported + numImageFrames), mirroring
    // exactly what the matcher needs. A timeout guards against listening forever.
    const currentReady = () =>
      displaySetService
        .getActiveDisplaySets()
        .some(
          ds =>
            ds?.StudyInstanceUID === currentStudyUID &&
            !ds?.unsupported &&
            ds?.numImageFrames > 0
        );

    log('re-hanging', protocol.id, 'with studies', [currentStudyUID, ...extraUIDs]);
    reHang();

    // Awaiting creation above usually makes the current study matchable right away,
    // so this normally dismisses immediately. The poll is a fallback for the case
    // where display sets are still finalizing after creation resolves (large MR can
    // keep streaming); re-hang once it becomes matchable, up to 60s.
    if (currentReady()) {
      dismissLoading();
    } else {
      let elapsed = 0;
      const intervalMs = 750;
      const interval = setInterval(() => {
        elapsed += intervalMs;
        if (currentReady()) {
          clearInterval(interval);
          log('current study became matchable — re-hanging');
          reHang();
          dismissLoading();
        } else if (elapsed >= 60000) {
          clearInterval(interval);
          log('current study never became matchable within 60s');
          dismissLoading();
        }
      }, intervalMs);
    }
  } catch (error) {
    dismissLoading();
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
