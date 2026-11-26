/**
 * RS-38, the refine tool's state: the study's refine targets, whether the tool
 * is active, and the one refine in hand.
 *
 *   idle ─ mark ─▶ drawing ─ let go ─▶ (hit) sending ─▶ preview ─ Keep ─▶ keeping ─▶ kept ─▶ idle
 *                               │                 └──▶ answered (failed, unavailable, stale,
 *                               └ (miss) missed            refused, no pixels, no answer)
 *
 * A mark is a click (one point) or a box (a drag past MIN_BOX_PX). Its lesion
 * is the hit test's (refineHit); its request names the lesion's live
 * revisions (refineContract.buildSegmentRequest). SAM2CT's outline is shown
 * beside the current one until the reader keeps it, discards it, or marks
 * again. A keep goes through the pane's controller (a `refine_keep` event),
 * and the targets are read again after it, so the kept outline is the one the
 * record now holds.
 *
 * Pure: the client, the clock, the timers and the keep are handed in.
 */
import type { Vec3 } from '../anatomy/anatomyGeometry';
import type { RsIntakeResponse } from '../rsContract';
import {
  buildSegmentRequest,
  type RefineMask,
  type RefinePrompt,
  type RefinePromptType,
  type RefineQc,
  type RefineTarget,
  type RefineTargets,
  type SegmentAnswer,
  type SegmentRequest,
  type IndexTriple,
} from './refineContract';
import { hitTest, prepareTarget, type PreparedTarget, type ShownImage } from './refineHit';
import { unpackMask, type UnpackedMask } from './refineMask';

/** The current outline's colour, and SAM2CT's (the overlay draws in these, the bar keys them). */
export const CURRENT_RGB: [number, number, number] = [255, 255, 255];
export const PREVIEW_RGB: [number, number, number] = [255, 216, 77];

/** A drag shorter than this (canvas pixels) is a click. */
export const MIN_BOX_PX = 4;
/** How long a miss, or a kept outline's note, stays (ms). */
export const NOTE_MS = 4000;

export type RefinePhase =
  | 'idle'
  | 'drawing'
  | 'missed'
  | 'sending'
  | 'preview'
  | 'answered'
  | 'keeping'
  | 'kept';

export type TargetsState = 'idle' | 'loading' | 'ready' | 'none' | 'failed';

export interface RefineMessage {
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface RefinePreview {
  mask: RefineMask;
  unpacked: UnpackedMask;
  resultId: string | null;
  maskRevision: number | null;
  qc: RefineQc | null;
}

export interface RefineView {
  targetsState: TargetsState;
  targets: PreparedTarget[];
  /** Entries the viewer could not read (left out). */
  dropped: number;
  /** The tool is the active mouse tool. */
  armed: boolean;
  phase: RefinePhase;
  /** The viewport the refine in hand was marked on. */
  viewportId: string | null;
  /** The mark being drawn, or the one sent (on the lesion's slice). */
  mark: RefinePrompt | null;
  target: RefineTarget | null;
  preview: RefinePreview | null;
  message: RefineMessage | null;
  /** When the request went (the clock's ms), while it runs. */
  startedAt: number | null;
  /** Whether Try again has something to send again. */
  canRetry: boolean;
}

export interface RefineClient {
  refineTargets(study: string): Promise<RefineTargets>;
  segment(request: SegmentRequest, shape: IndexTriple): Promise<SegmentAnswer>;
}

export interface RefineStoreDeps {
  client: RefineClient;
  reader: () => { id: string; role: string };
  /** The pane's keep (RsController.keepRefine). */
  keep: (keep: {
    resultId: string;
    observationId: string;
    maskRevision: number | null;
  }) => Promise<RsIntakeResponse | null>;
  /** Select a report finding in the pane, when the lesion is one. */
  selectEntry?: (entryId: string) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** The study by reference (a digest), for the harness: never the UID. */
  studyRef: (studyUID: string) => string;
}

export interface RefineStore {
  enter(study: string): void;
  leave(): void;
  /** Read the targets again (the published revision moved, or a keep went). */
  refresh(): Promise<void>;
  setArmed(armed: boolean): void;
  /** The mouse went down on a viewport showing the series' own slices. */
  beginMark(viewportId: string, world: Vec3): void;
  /** It moved: a box once it has gone MIN_BOX_PX from where it went down. */
  moveMark(world: Vec3, canvasDistance: number): void;
  /** It came up over this image: hit test, then send. */
  endMark(shown: ShownImage | null): void;
  /** A mark that cannot be taken here (not one of the series' own slices). */
  refuseMark(viewportId: string, text: string): void;
  keep(): Promise<void>;
  discard(): void;
  retry(): Promise<void>;
  getView(): RefineView;
  subscribe(listener: () => void): () => void;
  version(): number;
  harnessState(): Record<string, unknown>;
}

const MISS_TEXT: Record<'no_targets' | 'other_series' | 'off_slice' | 'nothing_here', string> = {
  no_targets: 'This study has no lesion the system found to refine.',
  other_series: 'No lesion the system found is on this series.',
  off_slice: 'Draw on the series’ own slices (not a reformat).',
  nothing_here: 'No lesion the system found is here.',
};

/** What the bar says about SAM2CT's outline. */
export function describePreview(p: RefinePreview): string {
  const slices = p.unpacked.slices.length;
  const parts = [
    `${p.unpacked.voxels} voxel${p.unpacked.voxels === 1 ? '' : 's'} on ${slices} slice${slices === 1 ? '' : 's'}`,
  ];
  const qc = p.qc;
  if (qc) {
    if (qc.components !== null && qc.components > 1) {
      parts.push(`${qc.components} pieces`);
    }
    if (qc.partialVolume) {
      parts.push('partial volume (under two slices)');
    }
    if (qc.truncated) {
      parts.push('cut off at the edge of what SAM2CT saw');
    }
    if (qc.passed === false) {
      parts.push(`QC failed${qc.failures.length ? `: ${qc.failures.join(', ')}` : ''}`);
    }
  }
  return parts.join('; ');
}

const idleFields = {
  phase: 'idle' as RefinePhase,
  viewportId: null,
  mark: null,
  target: null,
  preview: null,
  message: null,
  startedAt: null,
  canRetry: false,
};

export function createRefineStore(deps: RefineStoreDeps): RefineStore {
  let study: string | null = null;
  let generation = 0;
  let ver = 0;
  let noteTimer: unknown = null;
  let down: Vec3 | null = null;
  const listeners = new Set<() => void>();
  const counts = {
    reads: 0,
    readFailures: 0,
    marks: 0,
    misses: 0,
    segments: 0,
    previews: 0,
    stale: 0,
    refused: 0,
    failures: 0,
    keeps: 0,
    kept: 0,
  };
  let view: RefineView = {
    targetsState: 'idle',
    targets: [],
    dropped: 0,
    armed: false,
    ...idleFields,
  };

  const notify = () => {
    ver++;
    listeners.forEach(l => l());
  };
  const set = (patch: Partial<RefineView>) => {
    view = { ...view, ...patch };
    notify();
  };
  const clearNote = () => {
    if (noteTimer !== null) {
      deps.clearTimer(noteTimer);
      noteTimer = null;
    }
  };
  /** Back to idle after a while, unless something else happened first. */
  const fadeTo = (phase: RefinePhase) => {
    clearNote();
    const at = ver;
    noteTimer = deps.setTimer(() => {
      noteTimer = null;
      if (ver === at && view.phase === phase) {
        set({ ...idleFields });
      }
    }, NOTE_MS);
  };

  async function load(gen: number): Promise<void> {
    if (!study) {
      return;
    }
    counts.reads++;
    if (view.targetsState !== 'ready') {
      set({ targetsState: 'loading' });
    }
    try {
      const doc = await deps.client.refineTargets(study);
      if (gen !== generation) {
        return;
      }
      const targets = doc.targets.map(prepareTarget).filter((p): p is PreparedTarget => p !== null);
      set({
        targetsState: targets.length ? 'ready' : 'none',
        targets,
        dropped: doc.dropped + (doc.targets.length - targets.length),
      });
    } catch (e) {
      if (gen !== generation) {
        return;
      }
      counts.readFailures++;
      const status = (e as { status?: number }).status;
      set({ targetsState: status === 404 ? 'none' : 'failed', targets: [], dropped: 0 });
    }
  }

  /** The target with this observation as the targets now hold it (after a read). */
  const currentOf = (t: RefineTarget): RefineTarget | null =>
    view.targets.find(p => p.target.observationId === t.observationId)?.target ?? null;

  async function send(target: RefineTarget, prompt: RefinePrompt, viewportId: string | null) {
    const gen = generation;
    clearNote();
    counts.segments++;
    set({
      phase: 'sending',
      viewportId,
      mark: prompt,
      target,
      preview: null,
      message: { level: 'info', text: `Refining the ${target.label}…` },
      startedAt: deps.now(),
      canRetry: false,
    });
    let answer: SegmentAnswer;
    try {
      answer = await deps.client.segment(
        buildSegmentRequest(target, prompt, deps.reader()),
        target.grid.shape
      );
    } catch (e) {
      if (gen !== generation) {
        return;
      }
      counts.failures++;
      const status = (e as { status?: number }).status;
      set({
        phase: 'answered',
        startedAt: null,
        canRetry: true,
        message: {
          level: 'error',
          text:
            status === 502 || status === 504
              ? 'The CT analysis service did not answer in time. Try again.'
              : 'The CT analysis service did not answer the refine. Try again.',
        },
      });
      return;
    }
    if (gen !== generation) {
      return;
    }
    if (answer.kind === 'result' && answer.status === 'ok' && answer.mask) {
      counts.previews++;
      const preview: RefinePreview = {
        mask: answer.mask,
        unpacked: unpackMask(answer.mask),
        resultId: answer.resultId,
        maskRevision: answer.maskRevision,
        qc: answer.qc,
      };
      set({
        phase: 'preview',
        startedAt: null,
        preview,
        canRetry: true,
        message: {
          level: preview.qc?.passed === false ? 'warn' : 'info',
          text: `SAM2CT’s outline: ${describePreview(preview)}.`,
        },
      });
      return;
    }
    let message: RefineMessage;
    if (answer.kind === 'result') {
      counts.failures++;
      message = {
        level: 'warn',
        text: `SAM2CT gave no outline (${answer.status}${answer.reasons.length ? `: ${answer.reasons.join('; ')}` : ''}).`,
      };
    } else if (answer.kind === 'stale') {
      counts.stale++;
      message = {
        level: 'warn',
        text: 'The lesion changed since this page read it. Its outline is shown as it is now: mark it again.',
      };
      void load(gen);
    } else if (answer.kind === 'refused') {
      counts.refused++;
      message = { level: 'error', text: `Not refined: ${answer.reason}.` };
    } else {
      counts.failures++;
      message = { level: 'error', text: `Not refined: ${answer.reason}.` };
    }
    set({
      phase: 'answered',
      startedAt: null,
      preview: null,
      canRetry: answer.kind !== 'stale' && answer.kind !== 'refused',
      message,
    });
  }

  const store: RefineStore = {
    enter(next) {
      if (next === study) {
        return;
      }
      generation++;
      clearNote();
      study = next;
      down = null;
      view = { ...view, ...idleFields, targetsState: 'idle', targets: [], dropped: 0 };
      notify();
      void load(generation);
    },
    leave() {
      generation++;
      clearNote();
      study = null;
      down = null;
      view = { ...view, ...idleFields, targetsState: 'idle', targets: [], dropped: 0 };
      notify();
    },
    refresh: () => load(generation),
    setArmed(armed) {
      if (armed === view.armed) {
        return;
      }
      const patch: Partial<RefineView> = { armed };
      if (!armed && (view.phase === 'drawing' || view.phase === 'missed')) {
        down = null;
        Object.assign(patch, idleFields);
      }
      set(patch);
    },
    beginMark(viewportId, world) {
      if (!view.armed || view.phase === 'sending' || view.phase === 'keeping') {
        return;
      }
      clearNote();
      down = world;
      counts.marks++;
      set({
        ...idleFields,
        phase: 'drawing',
        viewportId,
        mark: { type: 'point', world: [world] },
      });
    },
    moveMark(world, canvasDistance) {
      if (view.phase !== 'drawing' || !down) {
        return;
      }
      const type: RefinePromptType = canvasDistance >= MIN_BOX_PX ? 'box' : 'point';
      set({ mark: { type, world: type === 'box' ? [down, world] : [down] } });
    },
    endMark(shown) {
      if (view.phase !== 'drawing' || !view.mark) {
        return;
      }
      const mark = view.mark;
      const viewportId = view.viewportId;
      down = null;
      const hit = shown
        ? hitTest(view.targets, mark, shown)
        : ({ kind: 'miss', reason: 'off_slice' } as const);
      if (hit.kind !== 'hit') {
        counts.misses++;
        set({
          ...idleFields,
          phase: 'missed',
          viewportId,
          message: {
            level: 'warn',
            text:
              hit.kind === 'not_taken'
                ? `The ${hit.target.label}’s recipe does not take a ${hit.type === 'box' ? 'box' : 'click'}.`
                : MISS_TEXT[hit.reason],
          },
        });
        fadeTo('missed');
        return;
      }
      if (hit.target.entryId) {
        deps.selectEntry?.(hit.target.entryId);
      }
      void send(hit.target, hit.prompt, viewportId);
    },
    refuseMark(viewportId, text) {
      if (!view.armed || view.phase === 'sending' || view.phase === 'keeping') {
        return;
      }
      counts.misses++;
      set({ ...idleFields, phase: 'missed', viewportId, message: { level: 'warn', text } });
      fadeTo('missed');
    },
    async keep() {
      const p = view.preview;
      const target = view.target;
      if (view.phase !== 'preview' || !p || !target) {
        return;
      }
      if (!p.resultId) {
        set({
          message: {
            level: 'warn',
            text: 'The CT analysis service keeps no refine attempts yet, so this outline cannot be saved.',
          },
        });
        return;
      }
      const gen = generation;
      counts.keeps++;
      set({ phase: 'keeping', message: { level: 'info', text: 'Keeping the new outline…' } });
      const answer = await deps.keep({
        resultId: p.resultId,
        observationId: target.observationId,
        maskRevision: p.maskRevision,
      });
      if (gen !== generation) {
        return;
      }
      if (answer?.status === 'applied') {
        counts.kept++;
        await load(gen);
        if (gen !== generation) {
          return;
        }
        set({
          phase: 'kept',
          preview: null,
          mark: null,
          target: currentOf(target) ?? target,
          canRetry: false,
          message: { level: 'info', text: `Kept: the ${target.label}’s outline is the new one.` },
        });
        fadeTo('kept');
        return;
      }
      const text = !answer
        ? 'Not kept: the change did not go (the pane was busy, or the service did not answer). Try Keep again.'
        : answer.status === 'conflict'
          ? 'Not kept: the record moved before this reached it. Mark the lesion again.'
          : `Not kept: ${answer.reason ?? answer.status}.`;
      set({ phase: 'preview', message: { level: answer ? 'warn' : 'error', text } });
      if (answer?.status === 'conflict') {
        void load(gen);
      }
    },
    discard() {
      if (
        view.phase === 'preview' ||
        view.phase === 'answered' ||
        view.phase === 'missed' ||
        view.phase === 'kept'
      ) {
        clearNote();
        set({ ...idleFields });
      }
    },
    async retry() {
      const target = view.target;
      const mark = view.mark;
      if (
        !view.canRetry ||
        !target ||
        !mark ||
        (view.phase !== 'answered' && view.phase !== 'preview')
      ) {
        return;
      }
      await send(currentOf(target) ?? target, mark, view.viewportId);
    },
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => ver,
    harnessState: () => ({
      study: study ? deps.studyRef(study) : null,
      targetsState: view.targetsState,
      targets: view.targets.length,
      dropped: view.dropped,
      armed: view.armed,
      phase: view.phase,
      mark: view.mark?.type ?? null,
      target: view.target ? { kind: view.target.kind, label: view.target.label } : null,
      previewVoxels: view.preview?.unpacked.voxels ?? null,
      message: view.message?.text ?? null,
      counts: { ...counts },
    }),
  };
  return store;
}
