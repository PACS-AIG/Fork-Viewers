/**
 * Rev 11 milestone 7, PR 2 (B31, N06): the reader's own image layout for a
 * study type, Arrange's "Save for this study type". Pure: no OHIF, no DOM, no
 * network (presetStore.ts reads and saves; caseHanging.ts applies).
 *
 * A study type is the case's modality and the site protocol the matcher picks
 * for it: the protocols' rules are the site's mapping of procedures to
 * hangings. For a generic protocol (a CT, MR or CR the site has no
 * exam-specific protocol for) it is also the procedure's name, whole, so one
 * save never reaches every exam the generic protocol catches (docs/12 §4: not a
 * description substring). No UID, date, series number or person goes into a
 * study type or a preset.
 *
 * A preset is one of the site's protocols, one of its layouts (a stage, by id
 * and name) and the prior choice. At a case's re-hang the precedence is: a
 * choice made in this case, then the reader's preset for its study type (its
 * protocol must still match the case), then the site protocol in the browsing
 * mode in use. A preset's layout the case cannot show leaves the protocol's
 * opening layout, the protocol's own fallback.
 */
import type { BrowsingMode } from '../allinone/browsingMode';
import { protocolKind, protocolLabel, type ProtocolLike } from './arrangeModel';

/** The version of these rules; a key made by other rules is another study type. */
export const HANGING_RULES_VERSION = 1;

/** The per-modality protocols the site falls back to (getHangingProtocolModule's generic three). */
export const GENERIC_PROTOCOLS: ReadonlySet<string> = new Set([
  '@pacsai/compareCT',
  '@pacsai/compareMR',
  '@pacsai/compareCR',
]);

/** Series that are not images say nothing of a study's modality. */
const NOT_IMAGE_MODALITIES = new Set([
  'SR',
  'KO',
  'PR',
  'SEG',
  'RTSTRUCT',
  'RTPLAN',
  'RTDOSE',
  'REG',
  'DOC',
  'OT',
]);

const PROTOCOL_ID = /^@?[A-Za-z0-9/_.-]{1,64}$/;
const KEY = /^v\d{1,2}\|[A-Z0-9]{1,8}\|@?[A-Za-z0-9/_.-]{1,64}(\|[A-Z0-9 &/,.()+:-]{1,96})?$/;
const BROWSING: ReadonlyArray<BrowsingMode> = ['append', 'current', 'allinone', 'manual'];

export interface HangingPreset {
  /** HANGING_RULES_VERSION when saved. */
  v: number;
  /** The study type, for the reader ("CTA Head/Neck"). */
  label: string;
  protocolId: string;
  /** The protocol's layouts when saved (protocolRevision). */
  protocolRevision: string;
  /** Its layout by id and name; both null: the protocol's opening layout. */
  stageId: string | null;
  stageName: string | null;
  browsing: BrowsingMode;
  /** What it shows, in one line. */
  summary: string;
}

export interface HangingEntry {
  /** Each save or reset of the study type's preset counts one, from 1. */
  revision: number;
  /** Null once reset: the site's layout. */
  preset: HangingPreset | null;
  at: string;
}

export interface StudyType {
  key: string;
  label: string;
  /** Made with the procedure's name (a generic protocol). */
  generic: boolean;
}

/** A modality code as a key part ("CT"); null when it is not one. */
export function modalityPart(modality: unknown): string | null {
  if (typeof modality !== 'string') {
    return null;
  }
  const m = modality.trim().toUpperCase();
  return /^[A-Z0-9]{1,8}$/.test(m) ? m : null;
}

/**
 * A procedure's name as a key part: upper case, plain characters, single
 * spaces, at most 96. A date, or a number of five digits or more (an accession,
 * an order), is dropped: the key names the kind of exam, never one (docs/12 §4).
 */
export function procedurePart(description: unknown): string | null {
  if (typeof description !== 'string') {
    return null;
  }
  const s = description
    .toUpperCase()
    .replace(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g, ' ')
    .replace(/\d{5,}/g, ' ')
    .replace(/[^A-Z0-9 &/,.()+:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96)
    .trim();
  return /[A-Z]/.test(s) ? s : null;
}

export interface DisplaySetFacts {
  StudyInstanceUID?: string;
  Modality?: string;
  isAllInOne?: boolean;
  StudyDescription?: string;
  instances?: Array<{ StudyDescription?: string } | undefined>;
  instance?: { StudyDescription?: string };
}

/**
 * The study's modality (the most common among its image series, the first seen
 * on a tie) and its procedure's name (the study's description).
 */
export function caseFacts(
  studyInstanceUID: string | undefined,
  displaySets: ReadonlyArray<DisplaySetFacts>,
  study?: { StudyDescription?: unknown } | null
): { modality: string | null; description: string | null } {
  const own = displaySets.filter(
    ds =>
      !!ds &&
      ds.StudyInstanceUID === studyInstanceUID &&
      !ds.isAllInOne &&
      !!modalityPart(ds.Modality) &&
      !NOT_IMAGE_MODALITIES.has(String(ds.Modality).toUpperCase())
  );
  const counts = new Map<string, number>();
  for (const ds of own) {
    const m = modalityPart(ds.Modality) as string;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  let modality: string | null = null;
  for (const [m, n] of counts) {
    if (modality === null || n > (counts.get(modality) ?? 0)) {
      modality = m;
    }
  }
  const fromStudy = typeof study?.StudyDescription === 'string' ? study.StudyDescription : null;
  const first = own[0] ?? displaySets.find(ds => ds?.StudyInstanceUID === studyInstanceUID);
  const fromSeries =
    first?.instances?.[0]?.StudyDescription ??
    first?.instance?.StudyDescription ??
    first?.StudyDescription ??
    null;
  const description = fromStudy?.trim() ? fromStudy : fromSeries?.trim() ? fromSeries : null;
  return { modality, description };
}

/** A study type's name for the reader: the site protocol's, without "Compare". */
function typeLabel(p: ProtocolLike): string {
  const label = protocolLabel(p);
  return label.replace(/\s+compare$/i, '').trim() || label;
}

/**
 * The case's study type, from the site protocol the matcher picks (a compare
 * protocol), its modality and, for a generic protocol, its procedure's name.
 * Null when the case has none: no compare protocol matches, or the generic
 * protocol's case names no procedure.
 */
export function studyTypeOf(input: {
  siteProtocol: ProtocolLike | null | undefined;
  modality: unknown;
  description: unknown;
}): StudyType | null {
  const p = input.siteProtocol;
  if (
    !p ||
    typeof p.id !== 'string' ||
    protocolKind(p.id) !== 'compare' ||
    !PROTOCOL_ID.test(p.id)
  ) {
    return null;
  }
  const modality = modalityPart(input.modality);
  if (!modality) {
    return null;
  }
  const head = `v${HANGING_RULES_VERSION}|${modality}|${p.id}`;
  if (!GENERIC_PROTOCOLS.has(p.id)) {
    return { key: head, label: typeLabel(p).slice(0, 80), generic: false };
  }
  const procedure = procedurePart(input.description);
  if (!procedure) {
    return null;
  }
  return { key: `${head}|${procedure}`, label: procedure.slice(0, 80), generic: true };
}

/** A short revision of a protocol's layouts: FNV-1a over its id and its stages' ids and names. */
export function protocolRevision(protocol: ProtocolLike): string {
  const text = [
    protocol.id,
    ...(protocol.stages ?? []).map(s => `${s?.id ?? ''}:${s?.name ?? ''}`),
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The browsing mode a protocol stands for: its own for All-in-one and Manual, else the prior's choice. */
function browsingOf(protocolId: string, browsing: BrowsingMode): BrowsingMode {
  const kind = protocolKind(protocolId);
  if (kind === 'allinone') {
    return 'allinone';
  }
  if (kind === 'manual') {
    return 'manual';
  }
  return browsing === 'current' ? 'current' : 'append';
}

/** One line: "CTA Head/Neck Compare · CTA Source axial (head + neck) · prior when available". */
export function presetSummary(
  protocol: ProtocolLike,
  stageName: string | null,
  browsing: BrowsingMode
): string {
  const kind = protocolKind(protocol.id);
  if (kind !== 'compare') {
    return protocolLabel(protocol);
  }
  return [
    protocolLabel(protocol),
    stageName,
    browsing === 'current' ? 'current only' : 'prior when available',
  ]
    .filter(Boolean)
    .join(' · ');
}

const stageNameOf = (s: { name?: string } | undefined): string =>
  typeof s?.name === 'string' ? s.name.trim() : '';

/**
 * The preset the images on screen make: the protocol in use, its layout (a
 * protocol with one layout keeps none) and the prior choice.
 */
export function presetFromImages(input: {
  type: StudyType;
  protocol: ProtocolLike | null | undefined;
  stageIndex: number;
  browsing: BrowsingMode;
}): HangingPreset | null {
  const { type, protocol } = input;
  if (!protocol || typeof protocol.id !== 'string' || !PROTOCOL_ID.test(protocol.id)) {
    return null;
  }
  const stages = protocol.stages ?? [];
  const stage = stages.length > 1 ? stages[input.stageIndex] : undefined;
  const stageId = typeof stage?.id === 'string' && stage.id.trim() ? stage.id.slice(0, 96) : null;
  const stageName = stageNameOf(stage).slice(0, 96) || null;
  const browsing = browsingOf(protocol.id, input.browsing);
  return {
    v: HANGING_RULES_VERSION,
    label: type.label,
    protocolId: protocol.id,
    protocolRevision: protocolRevision(protocol),
    stageId,
    stageName,
    browsing,
    summary: presetSummary(protocol, stageName, browsing).slice(0, 200),
  };
}

/**
 * Where a preset's layout is in the protocol: by its id (the name agreeing,
 * when both are kept), else by its name when one stage has it. Null when it is
 * not there, or the preset keeps none. Whether the case can show it is the
 * stage's status (`disabled`: it lacks the series or the prior).
 */
export function presetStageIndex(
  protocol: ProtocolLike | null | undefined,
  preset: Pick<HangingPreset, 'stageId' | 'stageName'>
): number | null {
  const stages = protocol?.stages ?? [];
  if (!preset.stageId && !preset.stageName) {
    return null;
  }
  let index = preset.stageId
    ? stages.findIndex(
        s => s?.id === preset.stageId && (!preset.stageName || stageNameOf(s) === preset.stageName)
      )
    : -1;
  if (index < 0 && preset.stageName) {
    const named = stages
      .map((s, i) => (stageNameOf(s) === preset.stageName ? i : -1))
      .filter(i => i >= 0);
    if (named.length === 1) {
      index = named[0];
    }
  }
  return index >= 0 ? index : null;
}

/** Whether the images on screen are the preset: its protocol, prior choice and layout. */
export function showsPreset(
  preset: HangingPreset | null | undefined,
  now: { protocol: ProtocolLike | null | undefined; stageIndex: number; browsing: BrowsingMode }
): boolean {
  if (!preset || !now.protocol || preset.protocolId !== now.protocol.id) {
    return false;
  }
  if (preset.browsing !== browsingOf(now.protocol.id, now.browsing)) {
    return false;
  }
  if ((now.protocol.stages ?? []).length < 2 || (!preset.stageId && !preset.stageName)) {
    return true;
  }
  return presetStageIndex(now.protocol, preset) === now.stageIndex;
}

export interface CasePlan {
  /** 'case': a choice made in this case; 'preset': the reader's; 'site': the site protocol. */
  source: 'case' | 'preset' | 'site';
  /** The compare protocol to run (All-in-one and Manual come from the browsing mode). */
  protocolId: string;
  /** The browsing mode the re-hang is in. */
  browsing: BrowsingMode;
  /** The preset applied, when it is. */
  preset: HangingPreset | null;
  /** Why the reader's preset is not applied: none saved, a choice in this case, its protocol does not match. */
  skipped: 'none' | 'case-choice' | 'not-eligible' | null;
}

/** A case's re-hang: this case's choice, else the reader's preset when it matches, else the site's. */
export function planCase(input: {
  siteProtocolId: string;
  /** The browsing mode in use now (the stored one, unless this case chose another). */
  browsing: BrowsingMode;
  preset: HangingPreset | null;
  /** The compare protocols that match this case (score above nought). */
  matchedIds: ReadonlySet<string>;
  /** The reader chose the images in this case (Arrange's Use this case, the toolbar's browsing mode). */
  caseChoice: boolean;
}): CasePlan {
  const site = { protocolId: input.siteProtocolId, browsing: input.browsing, preset: null };
  if (!input.preset) {
    return { ...site, source: input.caseChoice ? 'case' : 'site', skipped: 'none' };
  }
  if (input.caseChoice) {
    return { ...site, source: 'case', skipped: 'case-choice' };
  }
  const kind = protocolKind(input.preset.protocolId);
  if (kind === 'compare' && !input.matchedIds.has(input.preset.protocolId)) {
    return { ...site, source: 'site', skipped: 'not-eligible' };
  }
  return {
    source: 'preset',
    protocolId: kind === 'compare' ? input.preset.protocolId : input.siteProtocolId,
    browsing: input.preset.browsing,
    preset: input.preset,
    skipped: null,
  };
}

// ---- what the app answers, checked as the app checks it (userSettings.ts) ----------

/** Whether a string holds a control character (a line break, a NUL). */
const hasControl = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      return true;
    }
  }
  return false;
};

const isText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max && !hasControl(v);

export function isStudyTypeKey(key: unknown): key is string {
  return typeof key === 'string' && KEY.test(key);
}

/** A preset as the app stores it; null when any field is not one. */
export function readPreset(v: unknown): HangingPreset | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return null;
  }
  const p = v as Record<string, unknown>;
  if (typeof p.v !== 'number' || !Number.isInteger(p.v) || p.v < 1 || p.v > 99) {
    return null;
  }
  if (!isText(p.label, 80) || !isText(p.summary, 200)) {
    return null;
  }
  if (typeof p.protocolId !== 'string' || !PROTOCOL_ID.test(p.protocolId)) {
    return null;
  }
  if (typeof p.protocolRevision !== 'string' || !/^[a-z0-9]{1,32}$/.test(p.protocolRevision)) {
    return null;
  }
  if (p.stageId !== null && !isText(p.stageId, 96)) {
    return null;
  }
  if (p.stageName !== null && !isText(p.stageName, 96)) {
    return null;
  }
  if (!BROWSING.includes(p.browsing as BrowsingMode)) {
    return null;
  }
  return {
    v: p.v,
    label: p.label,
    protocolId: p.protocolId,
    protocolRevision: p.protocolRevision,
    stageId: p.stageId as string | null,
    stageName: p.stageName as string | null,
    browsing: p.browsing as BrowsingMode,
    summary: p.summary,
  };
}

/** An entry as the app stores it; null when it is not one. */
export function readEntry(v: unknown): HangingEntry | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return null;
  }
  const e = v as Record<string, unknown>;
  if (typeof e.revision !== 'number' || !Number.isInteger(e.revision) || e.revision < 1) {
    return null;
  }
  if (typeof e.at !== 'string' || e.at.length === 0 || e.at.length > 40) {
    return null;
  }
  if (e.preset === null) {
    return { revision: e.revision, preset: null, at: e.at };
  }
  const preset = readPreset(e.preset);
  return preset ? { revision: e.revision, preset, at: e.at } : null;
}

/** The entries the app answers, each under a study type's key, all checked. */
export function readEntries(v: unknown): Record<string, HangingEntry> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return {};
  }
  const out: Record<string, HangingEntry> = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    const entry = isStudyTypeKey(key) ? readEntry(raw) : null;
    if (entry) {
      out[key] = entry;
    }
  }
  return out;
}
