import getImagePlane from '../utils/getImagePlane';
import getImageKernel from '../utils/getImageKernel';
import { getStudyRole } from './roleRegistry';
import { getSpineRegion } from './metadata';

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

function regionTimepoint(d: AnyDS, activeStudyUID?: string): string | undefined {
  const role = getStudyRole(d?.StudyInstanceUID, activeStudyUID);
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
      return getStudyRole(d?.StudyInstanceUID, activeStudyUID);
    case 'pacsaiRegionTimepoint':
      return regionTimepoint(d, activeStudyUID);
    case 'pacsaiPlane':
      return getImagePlane(d, siblings);
    case 'pacsaiKernel':
      return getImageKernel(d);
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
  (protocol?.stages ?? []).forEach((stage: any, i: number) => {
    const en = stage?.stageActivation?.enabled?.minViewportsMatched ?? 1;
    const pa = stage?.stageActivation?.passive?.minViewportsMatched ?? 0;
    const vpMatches = (stage?.viewports ?? []).map((vp: any) => {
      const id = vp?.displaySets?.[0]?.id;
      const matched = matchesForSelector(selectors[id], displaySets, activeStudyUID);
      return { id, matched };
    });
    const matchedCount = vpMatches.filter((v: any) => v.matched.length).length;
    const status = matchedCount >= pa ? (matchedCount >= en ? 'ENABLED' : 'passive') : 'disabled';
    log(
      `  [${i}] ${stage?.id} "${stage?.name}" — ${matchedCount}/${stage?.viewports?.length} vp matched, en≥${en}/pa≥${pa} => ${status}`
    );
    vpMatches.forEach((v: any) => {
      // First candidate (▶) is the likely pick; others are also-eligible.
      const list = v.matched.length
        ? v.matched.map((d: AnyDS, idx: number) => `${idx === 0 ? '▶ ' : '  '}${desc(d)}`).join('  |  ')
        : '(none)';
      log(`        ${v.id}: ${list}`);
    });
  });
}

export default logPlannedStages;
