/**
 * Rev 11 milestone 7 (B31, N05): Arrange's controller. One per document; the
 * header's control (readingDock/ArrangeControl.tsx) drives it.
 *
 * Opening Arrange holds what the reader sees: the hanging (protocol, stage and
 * browsing mode), the images' place as F58 keeps it (grid, series, slice,
 * zoom, pan, window) and the workspace layout. Every choice then shows at once
 * on the real viewports and the real dock, and writes nothing:
 *
 *   - a protocol, the prior on or off, a layout (stage): OHIF's own hanging
 *     service, with the browsing mode held in memory (browsingMode.ts
 *     previewBrowsingMode; the stored mode is not touched);
 *   - Images / Both / Report and the report's width: the dock's preview, which
 *     tells the island nothing, so nothing is remembered.
 *
 * Use this case keeps the images for this case (the stored browsing mode comes
 * back with the next case) and applies the workspace layout as the reader's
 * choice, which the island remembers as it remembers every layout the reader
 * chooses (workspace decision 4; F56). Cancel, Escape or a click outside puts
 * back everything held. Save this layout, Restore saved and a modality's own
 * layout are F56's deliberate actions, done at once.
 *
 * Nothing here reads or writes a report, a claim or a study's status, and no
 * patient data is kept: study UIDs only, to know the case is still the one open.
 */
import type { BrowsingMode } from '../allinone/browsingMode';
import type { HeldView, ViewerPlace } from '../readingDock/viewerPlace';
import {
  ALL_IN_ONE_CHOICE,
  MANUAL_CHOICE,
  browsingForChoice,
  hiddenStages,
  imagesSummary,
  priorChoices,
  protocolChoices,
  protocolKind,
  sameImages,
  sameWorkspace,
  shareChoices,
  stageChoices,
  type ArrangeMode,
  type ImagesState,
  type PriorChoice,
  type ProtocolChoice,
  type ProtocolLike,
  type ShareChoice,
  type StageChoice,
  type WorkspaceState,
} from './arrangeModel';

export interface ArrangeHanging {
  getActiveProtocol: () => {
    protocol?: ProtocolLike | null;
    stageIndex?: number;
    activeStudy?: { StudyInstanceUID?: string } | null;
  };
  getState: () => { protocolId?: string; stageIndex?: number; activeStudyUID?: string } | undefined;
  run: (
    data: { studies?: unknown[]; displaySets: unknown[]; activeStudy?: unknown },
    protocolId?: string,
    options?: { stageIndex?: number }
  ) => void;
  setProtocol: (protocolId: string, options?: { stageIndex?: number }) => void;
  protocolEngine?: {
    findMatchByStudy?: (
      study: unknown,
      options: { studies?: unknown[]; displaySets?: unknown[] }
    ) => Array<{ score?: number; protocol?: ProtocolLike }>;
  };
  studies?: unknown[];
}

/** The dock's half (readingDock.ts). */
export interface ArrangeDock {
  layoutNow: () => WorkspaceState;
  splitBoundsNow: () => { min: number; max: number } | null;
  previewLayout: (layout: { mode?: ArrangeMode; reportRatio?: number }) => boolean;
  endLayoutPreview: (apply: boolean) => void;
  layoutMenu: () => { modality: string | null; ownLayout: boolean } | null;
  layoutAction: (action: 'save' | 'reset' | 'own-on' | 'own-off') => boolean;
  getSnapshot: () => {
    routeStudyRef?: string;
    imagesHeld?: boolean;
    dictation?: unknown;
    phase?: string;
  };
}

export interface ArrangeDeps {
  hanging: () => ArrangeHanging | null;
  /** The display sets loaded now (displaySetService.getActiveDisplaySets). */
  displaySets: () => Array<{ StudyInstanceUID?: string }>;
  /** A loaded study's metadata (DicomMetadataStore.getStudy). */
  getStudy: (studyInstanceUID: string) => unknown;
  /** F58's images place; null: the images' view is not held (protocol and stage still are). */
  place: () => ViewerPlace | null;
  dock: () => ArrangeDock | null;
  /** The comparison of this study is still being set up (loadRelevantPriors). */
  settling: (studyInstanceUID: string | undefined) => boolean;
  /** A prior study is loaded beside the current one. */
  priorLoaded: () => boolean;
  browsing: { get: () => BrowsingMode; preview: (mode: BrowsingMode) => void };
}

export interface ArrangeView {
  open: boolean;
  /** The comparison is still being set up: the Images group waits. */
  settling: boolean;
  summary: string;
  protocols: ProtocolChoice[];
  prior: PriorChoice[];
  stages: StageChoice[];
  /** The protocol's layouts this case cannot fill (not listed). */
  hiddenStages: number;
  /** Null without a dock (another mode). */
  workspace: {
    modes: Array<{ value: ArrangeMode; label: string; selected: boolean }>;
    shares: ShareChoice[];
    /** F56's items, where the island can remember layouts. */
    layoutMenu: { modality: string | null; ownLayout: boolean } | null;
  } | null;
  changed: { images: boolean; workspace: boolean };
  /** One line when a choice could not be shown. */
  note: string | null;
}

export interface Arrange {
  open: () => boolean;
  isOpen: () => boolean;
  view: () => ArrangeView;
  chooseProtocol: (id: string) => boolean;
  choosePrior: (value: 'append' | 'current') => boolean;
  chooseStage: (index: number) => boolean;
  chooseMode: (mode: ArrangeMode) => boolean;
  chooseShare: (reportRatio: number) => boolean;
  /** Keeps the images for this case and applies the workspace layout; closes. */
  useThisCase: () => void;
  /** Puts back everything held; closes. Writes nothing. */
  cancel: () => Promise<void>;
  saveLayout: () => boolean;
  restoreSaved: () => boolean;
  setOwnLayout: (on: boolean) => boolean;
  /** The case changed under an open Arrange: it closes, putting nothing back. */
  caseChanged: () => void;
  subscribe: (listener: () => void) => () => void;
  /** Counts for the probes: no study data. */
  counts: () => ArrangeCounts;
}

export interface ArrangeCounts {
  opens: number;
  previews: number;
  uses: number;
  cancels: number;
  restoredViews: number;
  missingSeries: number;
  dropped: number;
}

const MODES: Array<{ value: ArrangeMode; label: string }> = [
  { value: 'images', label: 'Images' },
  { value: 'both', label: 'Both' },
  { value: 'report', label: 'Report' },
];

interface Held {
  study: string | undefined;
  routeStudyRef: string | undefined;
  images: ImagesState;
  view: HeldView | null;
  workspace: WorkspaceState | null;
}

export function createArrange(deps: ArrangeDeps): Arrange {
  let held: Held | null = null;
  let note: string | null = null;
  const listeners = new Set<() => void>();
  const tally: ArrangeCounts = {
    opens: 0,
    previews: 0,
    uses: 0,
    cancels: 0,
    restoredViews: 0,
    missingSeries: 0,
    dropped: 0,
  };
  const notify = () => listeners.forEach(l => l());

  const imagesNow = (): ImagesState | null => {
    const st = deps.hanging()?.getState?.();
    if (!st?.protocolId) {
      return null;
    }
    return {
      protocolId: st.protocolId,
      stageIndex: typeof st.stageIndex === 'number' ? st.stageIndex : 0,
      browsing: deps.browsing.get(),
    };
  };
  const activeStudyUID = () => deps.hanging()?.getState?.()?.activeStudyUID;

  const stillTheCase = (): boolean => {
    if (!held) {
      return false;
    }
    const routeRef = deps.dock()?.getSnapshot?.()?.routeStudyRef;
    return activeStudyUID() === held.study && routeRef === held.routeStudyRef;
  };

  /** Runs a protocol over the loaded studies as the viewer's own re-hangs do. */
  const runProtocol = (protocolId: string, stageIndex?: number): boolean => {
    const hps = deps.hanging();
    if (!hps) {
      return false;
    }
    const displaySets = deps.displaySets();
    const active = hps.getActiveProtocol?.()?.activeStudy ?? null;
    const uid = active?.StudyInstanceUID ?? activeStudyUID();
    const activeStudy = (uid && deps.getStudy(uid)) || active || undefined;
    const run = (options?: { stageIndex?: number }) =>
      hps.run({ studies: hps.studies, displaySets, activeStudy }, protocolId, options ?? {});
    try {
      run(stageIndex !== undefined ? { stageIndex } : undefined);
      return true;
    } catch (_) {
      // The stage asked for cannot be shown with these studies: the protocol's own first.
      try {
        run();
        return true;
      } catch (__) {
        return false;
      }
    }
  };

  const matchedProtocols = (): ProtocolLike[] => {
    const hps = deps.hanging();
    const engine = hps?.protocolEngine;
    if (!hps || typeof engine?.findMatchByStudy !== 'function') {
      return [];
    }
    const uid = activeStudyUID();
    const study = (uid && deps.getStudy(uid)) || hps.getActiveProtocol?.()?.activeStudy;
    if (!study) {
      return [];
    }
    try {
      return engine
        .findMatchByStudy(study, { studies: hps.studies, displaySets: deps.displaySets() })
        .filter(m => (m?.score ?? 0) > 0 && m?.protocol)
        .map(m => m.protocol as ProtocolLike);
    } catch (_) {
      return [];
    }
  };

  const open = (): boolean => {
    if (held) {
      return true;
    }
    const images = imagesNow();
    const dock = deps.dock();
    if (!images && !dock) {
      return false;
    }
    let view: HeldView | null = null;
    try {
      view = deps.place()?.capture() ?? null;
    } catch (_) {
      view = null;
    }
    held = {
      study: activeStudyUID(),
      routeStudyRef: dock?.getSnapshot?.()?.routeStudyRef,
      images: images ?? { protocolId: null, stageIndex: 0, browsing: deps.browsing.get() },
      view,
      workspace: dock ? { ...dock.layoutNow() } : null,
    };
    note = null;
    tally.opens++;
    notify();
    return true;
  };

  /** A choice on the images: refused while the comparison settles or once the case moved on. */
  const imagesChoice = (apply: () => boolean): boolean => {
    if (!held) {
      return false;
    }
    if (!stillTheCase()) {
      dropHeld();
      return false;
    }
    if (deps.settling(activeStudyUID())) {
      note = 'Still setting up the comparison: try again in a moment.';
      notify();
      return false;
    }
    const ok = apply();
    note = ok ? null : 'That layout cannot be shown with this case’s series.';
    if (ok) {
      tally.previews++;
    }
    notify();
    return ok;
  };

  const chooseProtocol = (id: string): boolean =>
    imagesChoice(() => {
      const kind = protocolKind(id);
      const browsing = browsingForChoice(kind, deps.browsing.get());
      deps.browsing.preview(browsing);
      const protocolId =
        kind === 'allinone' ? ALL_IN_ONE_CHOICE : kind === 'manual' ? MANUAL_CHOICE : id;
      return runProtocol(protocolId);
    });

  const choosePrior = (value: 'append' | 'current'): boolean =>
    imagesChoice(() => {
      const now = imagesNow();
      if (!now?.protocolId || protocolKind(now.protocolId) !== 'compare') {
        return false;
      }
      deps.browsing.preview(value);
      // The role attribute reads the browsing mode: the protocol runs again.
      return runProtocol(now.protocolId);
    });

  const chooseStage = (index: number): boolean =>
    imagesChoice(() => {
      const hps = deps.hanging();
      const now = imagesNow();
      if (!hps || !now?.protocolId) {
        return false;
      }
      try {
        hps.setProtocol(now.protocolId, { stageIndex: index });
        return true;
      } catch (_) {
        return false;
      }
    });

  const workspaceChoice = (layout: { mode?: ArrangeMode; reportRatio?: number }): boolean => {
    const dock = deps.dock();
    if (!held || !dock) {
      return false;
    }
    if (!stillTheCase()) {
      dropHeld();
      return false;
    }
    const ok = dock.previewLayout(layout);
    note = ok
      ? null
      : layout.mode === 'images'
        ? 'Images waits until the report has said whether it is dictating.'
        : 'That layout cannot be shown here.';
    if (ok) {
      tally.previews++;
    }
    notify();
    return ok;
  };

  const chooseMode = (mode: ArrangeMode) => workspaceChoice({ mode });
  const chooseShare = (reportRatio: number) => workspaceChoice({ mode: 'both', reportRatio });

  /** Forgets what was held without putting it back (the case is not the one held). */
  const dropHeld = () => {
    if (!held) {
      return;
    }
    // A layout preview belongs to the window, not the case: it goes back.
    deps.dock()?.endLayoutPreview(false);
    held = null;
    note = null;
    tally.dropped++;
    notify();
  };

  const useThisCase = () => {
    if (!held) {
      return;
    }
    if (!stillTheCase()) {
      dropHeld();
      return;
    }
    // The images are already the chosen ones; the browsing mode chosen stays in
    // memory for this case (the next case's entry restores the stored one).
    deps.dock()?.endLayoutPreview(true);
    held = null;
    note = null;
    tally.uses++;
    notify();
  };

  const cancel = async (): Promise<void> => {
    const h = held;
    if (!h) {
      return;
    }
    held = null;
    note = null;
    tally.cancels++;
    // The workspace first: the images' place is measured in the layout it was held in.
    deps.dock()?.endLayoutPreview(false);
    const sameCase =
      activeStudyUID() === h.study &&
      deps.dock()?.getSnapshot?.()?.routeStudyRef === h.routeStudyRef;
    const now = imagesNow();
    if (sameCase && h.images.protocolId && now && !sameImages(now, h.images)) {
      if (deps.browsing.get() !== h.images.browsing) {
        deps.browsing.preview(h.images.browsing);
      }
      if (now.protocolId !== h.images.protocolId || now.browsing !== h.images.browsing) {
        runProtocol(h.images.protocolId, h.images.stageIndex);
      } else {
        try {
          deps.hanging()?.setProtocol(h.images.protocolId, { stageIndex: h.images.stageIndex });
        } catch (_) {
          runProtocol(h.images.protocolId, h.images.stageIndex);
        }
      }
      const place = deps.place();
      if (place && h.view) {
        try {
          const { missing } = await place.restore(h.view);
          tally.restoredViews++;
          tally.missingSeries += missing.length;
        } catch (_) {
          /* the protocol and stage are back; the view is the protocol's own */
        }
      }
    }
    notify();
  };

  const layoutAction = (action: 'save' | 'reset' | 'own-on' | 'own-off'): boolean => {
    const dock = deps.dock();
    if (!dock) {
      return false;
    }
    const done = dock.layoutAction(action);
    if (held && done) {
      // Deliberate: what the reader saved or reset to is not put back by Cancel.
      held = { ...held, workspace: { ...dock.layoutNow() } };
    }
    note = done ? null : 'The layout could not be saved here.';
    notify();
    return done;
  };

  const view = (): ArrangeView => {
    const hps = deps.hanging();
    const active = hps?.getActiveProtocol?.();
    const images = imagesNow();
    const protocol = active?.protocol ?? null;
    const settling = deps.settling(activeStudyUID());
    const state: ImagesState = images ?? {
      protocolId: null,
      stageIndex: 0,
      browsing: deps.browsing.get(),
    };
    const dock = deps.dock();
    const ws = dock?.layoutNow() ?? null;
    return {
      open: !!held,
      settling,
      summary: imagesSummary(protocol, state.stageIndex, state.browsing),
      protocols: images ? protocolChoices(held ? matchedProtocols() : [], state) : [],
      prior: priorChoices(state, deps.priorLoaded()),
      stages: stageChoices(protocol, state.stageIndex),
      hiddenStages: hiddenStages(protocol, state.stageIndex),
      workspace:
        dock && ws
          ? {
              modes: MODES.map(m => ({ ...m, selected: ws.mode === m.value })),
              shares: ws.mode === 'both' ? shareChoices(ws.reportRatio, dock.splitBoundsNow()) : [],
              layoutMenu: dock.layoutMenu(),
            }
          : null,
      changed: {
        images: !!held && !!images && !sameImages(images, held.images),
        workspace: !!held && !!ws && !!held.workspace && !sameWorkspace(ws, held.workspace),
      },
      note,
    };
  };

  return {
    open,
    isOpen: () => !!held,
    view,
    chooseProtocol,
    choosePrior,
    chooseStage,
    chooseMode,
    chooseShare,
    useThisCase,
    cancel,
    saveLayout: () => layoutAction('save'),
    restoreSaved: () => layoutAction('reset'),
    setOwnLayout: (on: boolean) => layoutAction(on ? 'own-on' : 'own-off'),
    caseChanged: dropHeld,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    counts: () => ({ ...tally }),
  };
}
