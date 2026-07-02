/**
 * Strict DICOM age helpers, shared by the header study chip (and available to
 * any consumer via `utils`). Rules (diagnostic safety): prefer PatientAge
 * (0010,1010); else derive from PatientBirthDate (0010,0030) and the STUDY
 * date (0008,0020) — never today's date; else return null. Never guess.
 *
 * NOTE: the pacsai-hp clinical-context overlay carries its own copy of these
 * (extensions can't be imported from platform code and the extension predates
 * this util) — keep the logic in sync if it ever changes.
 */

/** DICOM PatientAge "052Y"/"018M"/"030W"/"009D" → "52Y", or null. */
export function parseDicomAge(patientAge: unknown): string | null {
  if (!patientAge) {
    return null;
  }
  const m = /^0*(\d{1,3})\s*([DWMY])$/i.exec(String(patientAge).trim());
  return m ? `${parseInt(m[1], 10)}${m[2].toUpperCase()}` : null;
}

/**
 * Age at STUDY time from PatientBirthDate + StudyDate (both YYYYMMDD), or
 * null when either is missing/malformed. Years when >= 2y, else months,
 * else days.
 */
export function deriveAgeFromDob(dob: unknown, studyDate: unknown): string | null {
  const dobStr = typeof dob === 'string' ? dob.trim() : '';
  const studyStr = typeof studyDate === 'string' ? studyDate.trim() : '';
  if (!/^\d{8}$/.test(dobStr) || !/^\d{8}$/.test(studyStr)) {
    return null;
  }
  const toDate = (s: string) =>
    new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  const b = toDate(dobStr);
  const s = toDate(studyStr);
  if (Number.isNaN(b.getTime()) || Number.isNaN(s.getTime()) || s < b) {
    return null;
  }
  let years = s.getFullYear() - b.getFullYear();
  if (
    s.getMonth() - b.getMonth() < 0 ||
    (s.getMonth() === b.getMonth() && s.getDate() < b.getDate())
  ) {
    years--;
  }
  if (years >= 2) {
    return `${years}Y`;
  }
  let months = (s.getFullYear() - b.getFullYear()) * 12 + (s.getMonth() - b.getMonth());
  if (s.getDate() < b.getDate()) {
    months--;
  }
  if (months >= 1) {
    return `${months}M`;
  }
  return `${Math.max(0, Math.round((s.getTime() - b.getTime()) / 86400000))}D`;
}
