import { metaData } from '@cornerstonejs/core';
import { DicomMetadataStore } from '@ohif/core';

/**
 * 4D fallback for perfusion series that lack standard temporal tags (PACS AI).
 *
 * cs3d detects a 4D ("dynamic") series by probing, per imageId,
 * `metaData.get('TemporalPositionIdentifier', imageId)` (then DiffusionBValue /
 * TriggerTime / EchoTime / private b-values / PET frame time) and grouping images
 * into equal-sized timepoints per slice position (splitImageIdsBy4DTags). Detection
 * drives EVERYTHING downstream: the stack handler marks the displaySet
 * isDynamicVolume + swaps in the streaming DYNAMIC volume loader, the viewport is
 * forced to volume mode, ActiveViewportBehavior auto-shows the cine player, and cine
 * plays through TIME. Both the handler and the loader RE-derive the split from
 * metaData — so the fix must live at the metadata layer, not in the handler.
 *
 * Live-confirmed gap (Siemens "VPCT DynMulti4D 10.0 CTP", 360 instances): every tag
 * cs3d checks is absent; the true timepoint key is AcquisitionNumber (36 distinct ×
 * 10 positions = 360). AcquisitionTime is NOT a usable key (341 distinct — each
 * slice in a rotation has its own time).
 *
 * This provider answers ONLY the 'TemporalPositionIdentifier' query:
 *  - real tag present on the instance → returned as-is;
 *  - else, IF the instance's whole series passes a strict 4D shape check, the
 *    instance's AcquisitionNumber is returned as a synthetic temporal position.
 *
 * The shape check (memoized per series, re-checked when the instance count changes,
 * e.g. while streaming) keeps every ordinary CT exactly as it is today:
 *  - every instance has ImagePositionPatient and an AcquisitionNumber;
 *  - timepoints (distinct AcquisitionNumbers) ≥ MIN_TIMEPOINTS (6) — a 2-4 phase
 *    multi-phase series in one series must NOT become a forced-volume cine pane;
 *  - timepoints × positions === instance count, and every timepoint covers the full
 *    position set exactly once (rules out multi-station / partial re-scans).
 *
 * Kill switch: window.PACSAI_FLAGS = { disablePerfusion4D: true }.
 * DEBUGGING: window.PACSAI_DEBUG_4D = true logs each series verdict with the shape
 * numbers; an accepted series also logs unconditionally (once) so a live 4D pickup
 * is always visible in the console.
 */

const MIN_TIMEPOINTS = 6;

const flags = () => (window as any).PACSAI_FLAGS ?? {};
const verbose = () => (window as any).PACSAI_DEBUG_4D === true;

// SeriesInstanceUID -> { count, eligible } — re-evaluated when the series' instance
// count changes (metadata still streaming in), served from cache otherwise.
const verdicts = new Map<string, { count: number; eligible: boolean }>();

function seriesEligible(instance: any): boolean {
  const seriesUID = instance.SeriesInstanceUID;
  const studyUID = instance.StudyInstanceUID;
  if (!seriesUID || !studyUID) {
    return false;
  }

  let instances: any[] = [];
  try {
    instances = DicomMetadataStore.getSeries(studyUID, seriesUID)?.instances ?? [];
  } catch (e) {
    return false;
  }

  const cached = verdicts.get(seriesUID);
  if (cached && cached.count === instances.length) {
    return cached.eligible;
  }

  let eligible = false;
  let shape: Record<string, unknown> | undefined;
  try {
    if (instances.length >= MIN_TIMEPOINTS && !instances.some(i => i.NumberOfFrames > 1)) {
      const positions = new Set<string>();
      const perAcq = new Map<string, number>();
      let valid = true;
      for (const i of instances) {
        const pos = i.ImagePositionPatient;
        const acq = i.AcquisitionNumber;
        if (!pos || acq === undefined || acq === null || acq === '') {
          valid = false;
          break;
        }
        positions.add(JSON.stringify(pos));
        const k = String(acq);
        perAcq.set(k, (perAcq.get(k) ?? 0) + 1);
      }
      const P = positions.size;
      const T = perAcq.size;
      shape = { instances: instances.length, positions: P, timepoints: T };
      eligible =
        valid &&
        T >= MIN_TIMEPOINTS &&
        P >= 1 &&
        T * P === instances.length &&
        [...perAcq.values()].every(n => n === P);
    }
  } catch (e) {
    eligible = false;
  }

  verdicts.set(seriesUID, { count: instances.length, eligible });
  if (eligible || verbose()) {
    console.log(
      `[pacsai-4d] ${eligible ? 'ACCEPTED as 4D (synthetic temporal position from AcquisitionNumber)' : 'not 4D-shaped'}`,
      { series: instance.SeriesDescription, ...shape }
    );
  }
  return eligible;
}

function temporalPositionProvider(type: string, imageId: string) {
  if (type !== 'TemporalPositionIdentifier') {
    return;
  }
  if (flags().disablePerfusion4D === true) {
    return;
  }
  const instance = metaData.get('instance', imageId);
  if (!instance) {
    return;
  }
  // Real tag wins — the fallback only fills the gap.
  if (instance.TemporalPositionIdentifier !== undefined && instance.TemporalPositionIdentifier !== null) {
    return instance.TemporalPositionIdentifier;
  }
  const acq = instance.AcquisitionNumber;
  if (acq === undefined || acq === null || acq === '') {
    return;
  }
  if (!seriesEligible(instance)) {
    return;
  }
  const n = Number(acq);
  return Number.isNaN(n) ? undefined : n;
}

/** Register the provider (idempotent per app lifetime — called from preRegistration). */
let registered = false;
function initPerfusion4DProvider(): void {
  if (registered || typeof window === 'undefined') {
    return;
  }
  registered = true;
  // Low priority: any provider that can answer with a REAL value goes first; this
  // one only fills in where everything else returned undefined.
  metaData.addProvider(temporalPositionProvider, -100);
}

export default initPerfusion4DProvider;
