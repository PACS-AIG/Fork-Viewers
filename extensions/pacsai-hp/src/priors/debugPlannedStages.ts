import getImagePlane from '../utils/getImagePlane';
import getImageKernel from '../utils/getImageKernel';
import getImageColor from '../utils/getImageColor';
import { ALL_IN_ONE_MARKER } from '../allinone/buildAllInOneDisplaySet';
import { getStudyRole } from './roleRegistry';
import { getSpineRegion } from './metadata';
import { hangingIgnoresPriors } from '../allinone/browsingMode';

/**
 * DEBUG-only: log every stage of a built protocol together with the series each
 * viewport's selector resolves to, by replaying the hanging-protocol matcher's
 * rule evaluation against the loaded display sets. Deterministic (no dependence on
 * grid timing), so it shows the EXACT planned protocol rather than relying on
 * eyeballing the rendered viewports.
 *
 * Mirrors HPMatcher/validator semantics for the rule shapes the compare builder
 * emits: equals / greaterThan / containsI / doesNotContainI / contains, with custom
 * attributes (pacsaiRole, pacsaiRegionTimepoint, pacsaiPlane, pacsaiKernel) resolved
 * the same way the registered callbacks do. Only `required` rules gate matching
 * (matching the matcher's requiredFailed check); soft rules affect score, not
 * inclusion, so they are ignored here.
 */

type AnyDS = Record<string, any>;

function studyDescriptionOf(d: AnyDS): string {
  return String(d?.instances?.[0]?.StudyDescription ?? d?.StudyDescription ?? '');
}

/**
 * The role the MATCHER sees — mirrors index.tsx's `hangRoleFor`: the 'Current +
 * all-in-one' browsing mode suppresses the prior role, so without this the replay
 * would report the prior stages ENABLED while the real engine disables them.
 */
function hangRole(d: AnyDS, activeStudyUID?: string): string | undefined {
  const role = getStudyRole(d?.StudyInstanceUID, activeStudyUID);
  return role === 'prior' && hangingIgnoresPriors() ? undefined : role;
}

function regionTimepoint(d: AnyDS, activeStudyUID?: string): string | undefined {
  const role = hangRole(d, activeStudyUID);
  const tp = role === 'current' || role === 'sibling' ? 'session' : role === 'prior' ? 'prior' : undefined;
  if (!tp) {
    return undefined;
  }
  const region = getSpineRegion(studyDescriptionOf(d));
  return region && region.startsWith('spine-') ? `${region.slice('spine-'.length)}-${tp}` : undefined;
}

function attrValue(d: AnyDS, attr: string, activeStudyUID: string | undefined, siblings: AnyDS[]): unknown {
  switch (attr) {
    case 'pacsaiRole':
      return hangRole(d, activeStudyUID);
    case 'pacsaiRegionTimepoint':
      return regionTimepoint(d, activeStudyUID);
    case 'pacsaiPlane':
      return getImagePlane(d, siblings);
    case 'pacsaiKernel':
      return getImageKernel(d);
    case 'pacsaiColor':
      // excludeColorSeries protocols (CTA/CTA-chest) add a required pacsaiColor==='mono'
      // rule; without this the replay fails it for every series and shows (none).
      return getImageColor(d);
    case 'pacsaiAllInOne':
      // All-in-one stages (allinone-cp / allinone) require pacsaiAllInOne==='allinone';
      // without this the replay fails it and falsely shows those stages disabled/(none)
      // even when the real engine matched the composites. Mirrors the index.tsx callback.
      return d?.isAllInOne ? ALL_IN_ONE_MARKER : 'series';
    case 'pacsaiDynamic':
      // 4D-source stages (SelectorDef.dynamic) require pacsaiDynamic==='dynamic';
      // mirrors the index.tsx callback (same misleading-replay class as above).
      return d?.isDynamicVolume ? 'dynamic' : 'static';
    default:
      return d?.[attr];
  }
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
}

function rulePasses(value: unknown, constraint: Record<string, any> = {}): boolean {
  if (constraint.equals !== undefined) {
    const expected = constraint.equals?.value ?? constraint.equals;
    return value === expected;
  }
  if (constraint.greaterThan !== undefined) {
    const expected = constraint.greaterThan?.value ?? constraint.greaterThan;
    return typeof value === 'number' && value > Number(expected);
  }
  if (constraint.containsI !== undefined) {
    const s = String(value ?? '').toLowerCase();
    return asArray(constraint.containsI).some(k => s.includes(k.toLowerCase()));
  }
  if (constraint.doesNotContainI !== undefined) {
    const s = String(value ?? '').toLowerCase();
    return !asArray(constraint.doesNotContainI).some(k => s.includes(k.toLowerCase()));
  }
  if (constraint.contains !== undefined) {
    const s = String(value ?? '');
    return asArray(constraint.contains).some(k => s.includes(k));
  }
  return true;
}

/**
 * Series matching ALL required series-rules of a selector (and not unsupported),
 * ordered so the FIRST is the series the matcher most likely hangs. Approximates the
 * matcher's score: sum the weights of the SOFT (non-required) rules a series passes
 * (e.g. preferImageType ORIGINAL = +15, numImageFrames > floor), with frame count as
 * the final tiebreak. Not authoritative for every weighting, but reflects the
 * configured preferences (so e.g. the primary axial outranks a derived reformat).
 */
function matchesForSelector(
  selector: any,
  displaySets: AnyDS[],
  activeStudyUID: string | undefined
): AnyDS[] {
  const allRules = selector?.seriesMatchingRules ?? [];
  const requiredRules = allRules.filter((r: any) => r.required);
  const softRules = allRules.filter((r: any) => !r.required);
  const siblingsOf = (d: AnyDS) => displaySets.filter(s => s?.StudyInstanceUID === d?.StudyInstanceUID);
  const softScore = (d: AnyDS) =>
    softRules.reduce(
      (sum: number, r: any) =>
        sum + (rulePasses(attrValue(d, r.attribute, activeStudyUID, siblingsOf(d)), r.constraint) ? (r.weight ?? 1) : 0),
      0
    );
  return displaySets
    .filter(d => {
      if (d?.unsupported) {
        return false;
      }
      return requiredRules.every((r: any) =>
        rulePasses(attrValue(d, r.attribute, activeStudyUID, siblingsOf(d)), r.constraint)
      );
    })
    .sort((a, b) => softScore(b) - softScore(a) || (b?.numImageFrames ?? 0) - (a?.numImageFrames ?? 0));
}

export function logPlannedStages(
  protocol: any,
  displaySets: AnyDS[],
  activeStudyUID: string | undefined,
  log: (...args: unknown[]) => void
): void {
  const selectors = protocol?.displaySetSelectors ?? {};
  const desc = (d: AnyDS) => {
    const role = getStudyRole(d?.StudyInstanceUID, activeStudyUID) ?? '?';
    return `${d?.SeriesDescription} <${role}/${getImagePlane(d, displaySets.filter(s => s?.StudyInstanceUID === d?.StudyInstanceUID))}/n${d?.numImageFrames}>`;
  };

  log(`PLANNED PROTOCOL "${protocol?.id}" — ${protocol?.stages?.length ?? 0} stage(s):`);
  if (hangingIgnoresPriors()) {
    // The role in each `<role/plane/nN>` tag below is the TRUE registry role, so a
    // loaded prior still prints as <prior> while being unmatchable by design.
    log('  browsing mode "Current + all-in-one": prior role SUPPRESSED — every prior stage is expected to be disabled');
  }
  (protocol?.stages ?? []).forEach((stage: any, i: number) => {
    const en = stage?.stageActivation?.enabled?.minViewportsMatched ?? 1;
    const pa = stage?.stageActivation?.passive?.minViewportsMatched ?? 0;
    const vpMatches = (stage?.viewports ?? []).map((vp: any) => {
      const ds0 = vp?.displaySets?.[0];
      const id = ds0?.id;
      // Index-pinned panes (tiling stages) take the Nth ranked match — matched only
      // when an Nth match exists, so the count mirrors the real engine's dedup.
      const mdi = ds0?.matchedDisplaySetsIndex ?? 0;
      const matched = matchesForSelector(selectors[id], displaySets, activeStudyUID);
      const isMatched = mdi > 0 ? matched.length > mdi : matched.length > 0;
      return { id, mdi, matched, isMatched };
    });
    const matchedCount = vpMatches.filter((v: any) => v.isMatched).length;
    const status = matchedCount >= pa ? (matchedCount >= en ? 'ENABLED' : 'passive') : 'disabled';
    log(
      `  [${i}] ${stage?.id} "${stage?.name}" — ${matchedCount}/${stage?.viewports?.length} vp matched, en≥${en}/pa≥${pa} => ${status}`
    );
    vpMatches.forEach((v: any) => {
      const label = v.mdi ? `${v.id}[${v.mdi}]` : v.id;
      let list: string;
      if (!v.matched.length) {
        list = '(none)';
      } else if (v.mdi > 0) {
        // Pinned pane: show just the single ranked pick (or none if out of range).
        list = v.isMatched ? `▶ ${desc(v.matched[v.mdi])}` : '(none)';
      } else {
        // First candidate (▶) is the likely pick; others are also-eligible.
        list = v.matched.map((d: AnyDS, idx: number) => `${idx === 0 ? '▶ ' : '  '}${desc(d)}`).join('  |  ');
      }
      log(`        ${label}: ${list}`);
    });
  });
}

export default logPlannedStages;
