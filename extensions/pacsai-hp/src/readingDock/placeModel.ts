/**
 * Rev 11 milestone 6, approach C, F58 (29 Oct 2026): Hold / Back, the pure
 * half. "Hold" (or "save place", Alt+H) keeps where the reader is in the
 * images and the report; "back" (or "return to survey", Alt+B) puts it back,
 * with one line in the header saying what was put back, what could not be,
 * and what arrived meanwhile. The viewer's half is viewerPlace.ts, the
 * report's the island's `holdPlace` / `returnToPlace`; readingDock.ts holds
 * them together.
 *
 * Pure: no window, React or OHIF here.
 */

export type PlaceCommand = 'hold' | 'back';

/** A series as the line names it: by its number, never by patient data. */
export interface SeriesSeen {
  uid: string;
  label: string;
}

/** What going back did in the report (the island's `returnToPlace`). */
export interface ReportReturn {
  caret: 'restored' | 'section-gone' | 'none';
  section: string | null;
  placedSince: number;
  waiting: number;
}

const SECTION_NAME = /^[A-Z0-9][A-Z0-9 /&()'-]{0,39}$/;

/** A report return the island told, checked: anything else is no report. */
export function reportReturnOf(v: unknown): ReportReturn | null {
  if (typeof v !== 'object' || v === null) {
    return null;
  }
  const o = v as Record<string, unknown>;
  if (o.caret !== 'restored' && o.caret !== 'section-gone' && o.caret !== 'none') {
    return null;
  }
  const count = (n: unknown) => (Number.isSafeInteger(n) && (n as number) >= 0 ? (n as number) : 0);
  const section =
    typeof o.section === 'string' && SECTION_NAME.test(o.section.trim()) ? o.section.trim() : null;
  return { caret: o.caret, section, placedSince: count(o.placedSince), waiting: count(o.waiting) };
}

/** A series by its number ("series 4"), else "a series". */
export function seriesLabel(seriesNumber: unknown): string {
  const n = typeof seriesNumber === 'string' ? Number(seriesNumber) : seriesNumber;
  return Number.isSafeInteger(n) && (n as number) >= 0 ? `series ${n}` : 'a series';
}

/** The study's series now that were not there at the hold. */
export function arrivedSince(
  atHold: readonly SeriesSeen[],
  now: readonly SeriesSeen[]
): SeriesSeen[] {
  const before = new Set(atHold.map(s => s.uid));
  return now.filter(s => !before.has(s.uid));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const list = (labels: readonly string[]): string =>
  labels.length <= 1
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;

export const NOTHING_HELD_LINE = 'Nothing held yet: say "hold" or press Alt+H first';

/** The header's line once a place is held. */
export function heldLine(report: { section: string | null } | null): string {
  const where = report ? ` and the report${report.section ? ` at ${report.section}` : ''}` : '';
  return `Place held: the images${where}. Say "back" or press Alt+B to return`;
}

export interface BackLineInput {
  /** Viewports whose series is no longer available (left as they are). */
  missing: readonly string[];
  /** Series that arrived since the hold. */
  arrived: readonly SeriesSeen[];
  /** The report's half, or null when the report was not held. */
  report: ReportReturn | null;
}

/** The header's line after Back: put back, what could not be, and what
 *  arrived meanwhile, or that nothing did. */
export function backLine({ missing, arrived, report }: BackLineInput): string {
  const parts: string[] = ['Back to your place.'];
  const since: string[] = [];
  if (arrived.length) {
    since.push(
      `${plural(arrived.length, 'new series', 'new series')} (${list(arrived.map(s => s.label))})`
    );
  }
  if (report?.placedSince) {
    since.push(plural(report.placedSince, 'sentence placed', 'sentences placed'));
  }
  if (report?.waiting) {
    since.push(`${report.waiting} waiting to be placed`);
  }
  parts.push(since.length ? `Since then: ${since.join(', ')}.` : 'Nothing new arrived.');
  if (missing.length) {
    const labels = list([...new Set(missing)]);
    const one = new Set(missing).size === 1;
    parts.push(
      `${labels.charAt(0).toUpperCase()}${labels.slice(1)} ${one ? 'is' : 'are'} no longer available; ${
        one ? 'its viewport is' : 'their viewports are'
      } left as ${one ? 'it is' : 'they are'}.`
    );
  }
  if (report?.caret === 'section-gone') {
    parts.push(
      `${report.section ?? 'The held section'} is no longer in the report; the caret stays where it is.`
    );
  }
  return parts.join(' ');
}
