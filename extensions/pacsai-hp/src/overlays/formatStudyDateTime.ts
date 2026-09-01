/**
 * Shared date+time formatting for the viewport overlays.
 *
 * The stock overlays show the study DATE only, which is ambiguous exactly where
 * it matters most: two studies on one calendar day (an ER repeat CXR, a pre/post
 * contrast pair, a same-day follow-up) read identically, and the reading rad
 * cannot tell which pane is the later acquisition. Appending the clock time
 * disambiguates them.
 *
 * Conventions:
 *  - 24-hour `HH:mm` (radiology convention; seconds are noise on an overlay).
 *  - Time is APPENDED, never substituted — the date stays the primary token.
 *  - Absent / unparseable StudyTime degrades silently to the date alone, so a
 *    PACS that omits (0008,0030) looks exactly like it does today (no "00:00").
 */

/**
 * Format a DICOM TM value (`HHMMSS[.frac]`, also tolerating an already
 * colon-delimited `HH:MM:SS`) as 24-hour `HH:mm`. Returns '' when the value is
 * absent or does not parse — callers treat '' as "no time available".
 *
 * Deliberately hand-parsed rather than routed through the overlay framework's
 * `formatters.formatTime` (moment(raw, 'HH:mm:ss')): moment's non-strict parser
 * yields "Invalid date" for an empty/garbage TM and would print that string on
 * the image. Mirrors the regex in `priors/metadata.ts parseStudyDateTime`.
 */
export function formatDicomTimeHM(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return '';
  }
  const cleaned = String(raw).trim().replace(/:/g, '');
  if (!cleaned) {
    return '';
  }
  const m = cleaned.match(/^(\d{2})(\d{2})?/);
  if (!m) {
    return '';
  }
  const hh = Number(m[1]);
  const mi = Number(m[2] ?? '0');
  if (!Number.isFinite(hh) || hh > 23 || !Number.isFinite(mi) || mi > 59) {
    return '';
  }
  return `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/**
 * Resolve the study timestamp of an instance / display set into
 * `"<formatted date> HH:mm"` (or just the date when no time is available).
 *
 * `src` is anything carrying DICOM keywords — an instance, or a display set.
 * SeriesDate/SeriesTime are the fallback (a display set always has them, and
 * they differ from the study stamp by minutes at most, which does not change
 * the clinical read of "morning vs afternoon exam").
 *
 * Returns '' when there is no date at all: a bare time with no date would be
 * more confusing than showing nothing.
 */
export function formatStudyDateTime(
  src: Record<string, any> | undefined | null,
  formatDate?: (value: unknown) => string
): string {
  if (!src) {
    return '';
  }
  const rawDate = src.StudyDate ?? src.SeriesDate;
  if (!rawDate || !formatDate) {
    return '';
  }
  const datePart = formatDate(rawDate);
  if (!datePart) {
    return '';
  }
  const timePart = formatDicomTimeHM(src.StudyTime ?? src.SeriesTime);
  return timePart ? `${datePart} ${timePart}` : datePart;
}

export default formatStudyDateTime;
