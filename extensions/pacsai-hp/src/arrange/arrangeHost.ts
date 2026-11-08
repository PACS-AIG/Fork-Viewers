/**
 * Rev 11 milestone 7: this document's Arrange, over the live viewer: OHIF's
 * hanging and display-set services (as the radcopilot mode hands them in for
 * F58), the loaded studies' metadata, F58's images place, the reading dock,
 * the prior loader's settling state and the in-memory browsing mode.
 */
import { DicomMetadataStore } from '@ohif/core';
import { getBrowsingMode, previewBrowsingMode } from '../allinone/browsingMode';
import { comparisonSettling } from '../priors/comparisonSettling';
import { getPriorUIDs } from '../priors/roleRegistry';
import {
  currentReadingDock,
  readingViewerPlace,
  readingViewerServices,
} from '../readingDock/session';
import {
  createArrange,
  type Arrange,
  type ArrangeDock,
  type ArrangeHanging,
} from './arrangeSession';

type DisplaySetLike = { StudyInstanceUID?: string };

const services = () => readingViewerServices();
const displaySets = (): DisplaySetLike[] => {
  const ds = services()?.displaySetService as
    | { getActiveDisplaySets?: () => DisplaySetLike[] }
    | undefined;
  try {
    return ds?.getActiveDisplaySets?.() ?? [];
  } catch (_) {
    return [];
  }
};

let arrange: Arrange | null = null;

/** This document's Arrange (made at first use). */
export function currentArrange(): Arrange {
  if (!arrange) {
    arrange = createArrange({
      hanging: () => (services()?.hangingProtocolService as ArrangeHanging | undefined) ?? null,
      displaySets,
      getStudy: uid => DicomMetadataStore.getStudy(uid),
      place: () => readingViewerPlace(),
      dock: () => (currentReadingDock() as unknown as ArrangeDock | null) ?? null,
      settling: comparisonSettling,
      priorLoaded: () => {
        const priors = new Set(getPriorUIDs());
        return (
          priors.size > 0 &&
          displaySets().some(d => !!d.StudyInstanceUID && priors.has(d.StudyInstanceUID))
        );
      },
      browsing: { get: getBrowsingMode, preview: previewBrowsingMode },
    });
  }
  return arrange;
}

/** A route entry or leave: an open Arrange closes, putting nothing back into the next case. */
export function arrangeCaseChanged(): void {
  arrange?.caseChanged();
}
