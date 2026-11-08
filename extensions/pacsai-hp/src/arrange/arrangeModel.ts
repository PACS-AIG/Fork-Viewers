/**
 * Rev 11 milestone 7 (B31, N05): Arrange, the one presentation control in the
 * reading window's header. What its two groups offer, from the viewer's state:
 *
 *   - Images: the hanging the case is using (protocol and stage, in one line),
 *     the protocols that match this study plus All-in-one only and Manual, with
 *     or without the prior (the browsing mode's current), and the protocol's
 *     layouts (its stages) by name;
 *   - Workspace: Images / Both / Report and the report's share of the width.
 *
 * Pure: no OHIF, no DOM. The controller (arrangeSession.ts) reads the hanging
 * service and the dock into these shapes and applies the reader's choices.
 */
import type { BrowsingMode } from '../allinone/browsingMode';

export const ALL_IN_ONE_CHOICE = '@pacsai/allInOne';
export const MANUAL_CHOICE = 'default';

/** The images as the hanging service shows them, and the browsing mode in use. */
export interface ImagesState {
  protocolId: string | null;
  stageIndex: number;
  browsing: BrowsingMode;
}

export interface ProtocolLike {
  id: string;
  name?: string;
  stages?: Array<{
    id?: string;
    name?: string;
    status?: string;
    viewportStructure?: { properties?: { rows?: number; columns?: number } };
  }>;
}

export type ProtocolKind = 'compare' | 'allinone' | 'manual';

export interface ProtocolChoice {
  id: string;
  label: string;
  kind: ProtocolKind;
  selected: boolean;
}

export interface StageChoice {
  index: number;
  label: string;
  /** False for a stage this case cannot fill (OHIF's `disabled`). */
  available: boolean;
  selected: boolean;
}

export interface PriorChoice {
  value: 'append' | 'current';
  label: string;
  selected: boolean;
}

/** The kind of choice a protocol id is in Arrange. */
export function protocolKind(id: string | null | undefined): ProtocolKind {
  if (id === ALL_IN_ONE_CHOICE) {
    return 'allinone';
  }
  if (id === MANUAL_CHOICE || !id) {
    return 'manual';
  }
  return 'compare';
}

/** The browsing mode a protocol choice stands for (the prior's choice kept for a compare protocol). */
export function browsingForChoice(kind: ProtocolKind, browsing: BrowsingMode): BrowsingMode {
  if (kind === 'allinone') {
    return 'allinone';
  }
  if (kind === 'manual') {
    return 'manual';
  }
  return browsing === 'current' ? 'current' : 'append';
}

const ALL_IN_ONE_LABEL = 'All-in-one only';
const MANUAL_LABEL = 'Manual (pick series)';

/** A protocol's name for the reader ("CT Chest Compare"), never its id's prefix. */
export function protocolLabel(p: ProtocolLike | null | undefined): string {
  if (!p) {
    return 'No hanging';
  }
  if (p.id === ALL_IN_ONE_CHOICE) {
    return ALL_IN_ONE_LABEL;
  }
  if (p.id === MANUAL_CHOICE) {
    return MANUAL_LABEL;
  }
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  return name || p.id.replace(/^@[^/]+\//, '');
}

/** A stage's name for the reader; a stage with none is named by its place. */
export function stageLabel(stage: { name?: string } | null | undefined, index: number): string {
  const name = typeof stage?.name === 'string' ? stage.name.trim() : '';
  return name || `Layout ${index + 1}`;
}

/** The one line Arrange opens on: "Using: CT Chest Compare · Axial Lung (current/prior)". */
export function imagesSummary(
  protocol: ProtocolLike | null | undefined,
  stageIndex: number,
  browsing: BrowsingMode
): string {
  if (!protocol) {
    return 'Using: no hanging yet';
  }
  const stages = protocol.stages ?? [];
  const parts = [protocolLabel(protocol)];
  if (stages.length > 1 && stages[stageIndex]) {
    parts.push(stageLabel(stages[stageIndex], stageIndex));
  }
  if (protocolKind(protocol.id) === 'compare' && browsing === 'current') {
    parts.push('current only');
  }
  return `Using: ${parts.join(' · ')}`;
}

/**
 * The Images group's protocols: the compare protocols that match this study, in
 * the engine's order (the best first), then All-in-one only and Manual. The one
 * in use is selected; a compare protocol in use that the match list lacks (the
 * reader chose it on another study's hang) is listed first so it stays visible.
 */
export function protocolChoices(
  matched: ReadonlyArray<ProtocolLike>,
  active: ImagesState
): ProtocolChoice[] {
  const activeKind = protocolKind(active.protocolId);
  const seen = new Set<string>();
  const compare: ProtocolChoice[] = [];
  for (const p of matched) {
    if (!p || typeof p.id !== 'string' || protocolKind(p.id) !== 'compare' || seen.has(p.id)) {
      continue;
    }
    seen.add(p.id);
    compare.push({
      id: p.id,
      label: protocolLabel(p),
      kind: 'compare',
      selected: activeKind === 'compare' && p.id === active.protocolId,
    });
  }
  if (activeKind === 'compare' && active.protocolId && !seen.has(active.protocolId)) {
    compare.unshift({
      id: active.protocolId,
      label: protocolLabel({ id: active.protocolId }),
      kind: 'compare',
      selected: true,
    });
  }
  return [
    ...compare,
    {
      id: ALL_IN_ONE_CHOICE,
      label: ALL_IN_ONE_LABEL,
      kind: 'allinone',
      selected: activeKind === 'allinone',
    },
    { id: MANUAL_CHOICE, label: MANUAL_LABEL, kind: 'manual', selected: activeKind === 'manual' },
  ];
}

/** The protocol's layouts (its stages) by name; one the case cannot fill is listed, not offered. */
/** A stage's grid ("1×3"), when its protocol says. */
function gridOf(
  stage: { viewportStructure?: { properties?: { rows?: number; columns?: number } } } | undefined
): string | null {
  const p = stage?.viewportStructure?.properties;
  return p && Number.isFinite(p.rows) && Number.isFinite(p.columns)
    ? `${p.rows}×${p.columns}`
    : null;
}

/**
 * The protocol's layouts (its stages) this case can show, by name; a name the
 * protocol repeats ("Current", one per density) gets its grid ("Current · 1×3"),
 * and where the grid repeats too, its place among them. A stage the case cannot
 * fill (OHIF's `disabled`: a prior or a series it lacks) is not listed (docs/12
 * §3: one small panel, not a dashboard): `hiddenStages` counts them.
 */
export function stageChoices(
  protocol: ProtocolLike | null | undefined,
  stageIndex: number
): StageChoice[] {
  const stages = protocol?.stages ?? [];
  if (stages.length < 2) {
    return [];
  }
  const shown = stages
    .map((s, index) => ({ s, index }))
    .filter(({ s, index }) => s?.status !== 'disabled' || index === stageIndex);
  const byName = new Map<string, number>();
  for (const { s, index } of shown) {
    const name = stageLabel(s, index);
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return shown.map(({ s, index }) => {
    const name = stageLabel(s, index);
    let label = name;
    if ((byName.get(name) ?? 0) > 1) {
      const grid = gridOf(s);
      const key = `${name}|${grid}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const sameGrid = shown.filter(
        x => stageLabel(x.s, x.index) === name && gridOf(x.s) === grid
      ).length;
      label = grid ? `${name} · ${grid}${sameGrid > 1 ? ` (${n})` : ''}` : `${name} (${n})`;
    }
    return {
      index,
      label,
      available: s?.status !== 'disabled',
      selected: index === stageIndex,
    };
  });
}

/** How many of the protocol's layouts this case cannot fill (not listed). */
export function hiddenStages(
  protocol: ProtocolLike | null | undefined,
  stageIndex: number
): number {
  const stages = protocol?.stages ?? [];
  if (stages.length < 2) {
    return 0;
  }
  return stages.filter((s, index) => s?.status === 'disabled' && index !== stageIndex).length;
}

/** With or without the prior: only for a compare protocol with a prior loaded. */
export function priorChoices(state: ImagesState, priorLoaded: boolean): PriorChoice[] {
  if (!priorLoaded || protocolKind(state.protocolId) !== 'compare') {
    return [];
  }
  return [
    { value: 'append', label: 'With prior', selected: state.browsing !== 'current' },
    { value: 'current', label: 'Current only', selected: state.browsing === 'current' },
  ];
}

export function sameImages(a: ImagesState | null, b: ImagesState | null): boolean {
  return (
    !!a &&
    !!b &&
    a.protocolId === b.protocolId &&
    a.stageIndex === b.stageIndex &&
    a.browsing === b.browsing
  );
}

// ---- the Workspace group ----------------------------------------------------------

export type ArrangeMode = 'images' | 'both' | 'report';

export interface WorkspaceState {
  mode: ArrangeMode;
  reportRatio: number;
}

/** The report widths Arrange offers (the share of the window's width). */
export const REPORT_SHARES: readonly number[] = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55];

export interface ShareChoice {
  value: number;
  label: string;
  /** False where the window cannot keep both floors at this share. */
  available: boolean;
  selected: boolean;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The report widths for a window: each offered where both floors hold
 * (`bounds`, from the dock's split rules; null: no split fits), the one in use
 * selected when it is one of them (else the nearest is not pretended).
 */
export function shareChoices(
  reportRatio: number,
  bounds: { min: number; max: number } | null
): ShareChoice[] {
  return REPORT_SHARES.map(value => ({
    value,
    label: `${Math.round(value * 100)} %`,
    available: !!bounds && value >= bounds.min - 1e-9 && value <= bounds.max + 1e-9,
    selected: Math.abs(round3(reportRatio) - value) < 0.0005,
  }));
}

export function sameWorkspace(a: WorkspaceState | null, b: WorkspaceState | null): boolean {
  return !!a && !!b && a.mode === b.mode && Math.abs(a.reportRatio - b.reportRatio) < 0.0005;
}
