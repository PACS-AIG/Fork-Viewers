/**
 * Rev 11 milestone 7: this document's Arrange, over the live viewer: OHIF's
 * hanging and display-set services (as the radcopilot mode hands them in for
 * F58), the loaded studies' metadata, F58's images place, the reading dock,
 * the prior loader's settling state and the in-memory browsing mode.
 */
import { DicomMetadataStore } from '@ohif/core';
import { getBrowsingMode, previewBrowsingMode, storedBrowsingMode } from '../allinone/browsingMode';
import { comparisonSettling } from '../priors/comparisonSettling';
import {
  caseApplied,
  hangingEntry,
  hangingPresetCounts,
  hangingPresetsState,
  loadHangingPresets,
  markCaseChoice,
  saveHangingPreset,
  startHangingCase,
  suspendHangingPresets,
} from './presetStore';
import {
  latchInteraction,
  lateCaseEntered,
  lateCaseLeft,
  lateCounts,
  releaseLateHold,
  setLateHold,
  updateLayout,
  type LateServices,
} from './lateArrivals';
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
      browsing: {
        get: getBrowsingMode,
        preview: previewBrowsingMode,
        stored: storedBrowsingMode,
      },
      presets: {
        state: hangingPresetsState,
        entry: hangingEntry,
        save: saveHangingPreset,
        markCaseChoice,
        applied: caseApplied,
      },
      // PR 3: the reader's choice of images latches the case; a re-hang held
      // only while the panel was open may run once it closes.
      interaction: () => latchInteraction('arrange', { hung: true }),
      closed: releaseLateHold,
    });
  }
  return arrange;
}

/**
 * PR 3: the header's Update layout. An Arrange left open is cancelled first
 * (its preview puts back what it held), then the case's held re-hang runs.
 */
export async function applyLateUpdate(): Promise<boolean> {
  if (arrange?.isOpen()) {
    await arrange.cancel();
  }
  return updateLayout();
}

// In a window too narrow for Both, Arrange's header button gives way (as the
// session switcher does, 30 Oct) and the gear menu opens it: the panel then
// takes the focus, the menu's trigger having had it.
let focusRequested = false;

/** The gear menu's "Arrange…" (a window too narrow for Both). */
export function openArrangeFromMenu(): void {
  focusRequested = true;
  currentArrange().open();
}

/** Whether the panel was opened from the menu (asked once). */
export function takeArrangeFocusRequest(): boolean {
  const asked = focusRequested;
  focusRequested = false;
  return asked;
}

/** A route entry or leave: an open Arrange closes, putting nothing back into the next case. */
export function arrangeCaseChanged(): void {
  arrange?.caseChanged();
}

/**
 * Milestone 7, PR 2: a case enters the reading window. Its own choices start
 * clear, and with the reading dock on the reader's hanging presets are read
 * for it (the case's re-hang waits for them, briefly); without, none applies.
 * PR 3: so does its interaction latch (lateArrivals.ts), watching the viewer's
 * hanging (`services`) with the dock on; automatic re-hangs also wait while
 * Arrange holds a preview.
 */
export function hangingCaseEntered(readPresets: boolean, services?: LateServices): void {
  installArrangeHook();
  startHangingCase();
  setLateHold(() => arrange?.isOpen() === true);
  lateCaseEntered(readPresets, services);
  if (readPresets) {
    void loadHangingPresets();
  } else {
    suspendHangingPresets();
  }
}

let hookInstalled = false;
/** Read-only counts for the probes (`window.__pacsaiArrange`): no study data. */
function installArrangeHook(): void {
  if (hookInstalled || typeof window === 'undefined') {
    return;
  }
  hookInstalled = true;
  try {
    Object.defineProperty(window, '__pacsaiArrange', {
      value: Object.freeze({
        counts: () => ({
          arrange: arrange?.counts() ?? null,
          presets: hangingPresetCounts(),
          applied: caseApplied(),
          late: lateCounts(),
        }),
      }),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  } catch (_) {
    /* defined already */
  }
}

/** The reading window's case is left: no preset applies until a case entry reads them again. */
export function hangingCaseLeft(): void {
  suspendHangingPresets();
  lateCaseLeft();
}
