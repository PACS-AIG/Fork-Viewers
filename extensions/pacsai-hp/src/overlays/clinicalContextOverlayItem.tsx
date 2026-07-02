import React, { useEffect, useReducer } from 'react';
import {
  isClinicalContextVisible,
  requestClinicalIndication,
  subscribeClinicalContext,
} from '../clinicalContext/clinicalContextStore';

/**
 * On-image clinical-context overlay: `52Y F · CHEST PAIN R/O PE`.
 *
 * The patient's age, sex, and reason-for-exam shape the whole differential, so
 * they stay quietly in view on the image instead of buried in a drawer. Data:
 *  - age: DICOM PatientAge (0010,1010), else derived from PatientBirthDate
 *    (0010,0030) and STUDY date (0008,0020) — never today's date, never guessed;
 *  - sex: PatientSex (0010,0040), M/F/O only;
 *  - indication: PACS-AI API `patientHistory` (HL7 OBR-13 via /api/studydetails),
 *    else DICOM ReasonForRequestedProcedure (0040,1002) → ReasonForStudy
 *    (0032,1030) → AdmittingDiagnosesDescription (0008,1080). StudyDescription is
 *    NOT used — it already has its own overlay line.
 *
 * Missing fields are omitted cleanly (no "undefined", no dangling "·"); the item
 * renders nothing when there is no data. Per-viewport, so a prior pane shows the
 * PRIOR study's context (the CURRENT/PRIOR role tag disambiguates). Toggleable
 * via the `toggleClinicalContextOverlay` command (persisted preference).
 * Registered into `viewportOverlay.topLeft` by the longitudinal mode.
 */
export const CLINICAL_CONTEXT_OVERLAY_ITEM_ID = 'pacsai-clinical-context';

const INDICATION_TRUNCATE_AT = 80;

/** DICOM PatientAge "052Y"/"018M"/"030W"/"009D" → "52Y", or null. */
export function parseDicomAge(patientAge: unknown): string | null {
  if (!patientAge) {
    return null;
  }
  const m = /^0*(\d{1,3})\s*([DWMY])$/i.exec(String(patientAge).trim());
  return m ? `${parseInt(m[1], 10)}${m[2].toUpperCase()}` : null;
}

/**
 * Age at STUDY time from PatientBirthDate + StudyDate (both YYYYMMDD), or null
 * when either is missing/malformed. Years when >= 2y, else months, else days.
 */
export function deriveAgeFromDob(dob: unknown, studyDate: unknown): string | null {
  const dobStr = typeof dob === 'string' ? dob.trim() : '';
  const studyStr = typeof studyDate === 'string' ? studyDate.trim() : '';
  if (!/^\d{8}$/.test(dobStr) || !/^\d{8}$/.test(studyStr)) {
    return null;
  }
  const toDate = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  const b = toDate(dobStr);
  const s = toDate(studyStr);
  if (Number.isNaN(b.getTime()) || Number.isNaN(s.getTime()) || s < b) {
    return null;
  }
  let years = s.getFullYear() - b.getFullYear();
  if (s.getMonth() - b.getMonth() < 0 || (s.getMonth() === b.getMonth() && s.getDate() < b.getDate())) {
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

function normalizeSex(patientSex: unknown): string | null {
  const sex = typeof patientSex === 'string' ? patientSex.trim().toUpperCase() : '';
  return sex === 'M' || sex === 'F' || sex === 'O' ? sex : null;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    // Some parsers surface single-item multi-valued tags as arrays.
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return null;
}

function ClinicalContextLine({
  instance,
  studyInstanceUID,
  servicesManager,
}: Record<string, any>) {
  // Any store change (fetch resolved, visibility toggled) re-renders.
  const [, forceRender] = useReducer(x => x + 1, 0);
  useEffect(() => subscribeClinicalContext(forceRender), []);

  const apiEntry = requestClinicalIndication(studyInstanceUID, servicesManager);

  if (!isClinicalContextVisible() || !instance) {
    return null;
  }

  const age = parseDicomAge(instance.PatientAge) ?? deriveAgeFromDob(instance.PatientBirthDate, instance.StudyDate);
  const sex = normalizeSex(instance.PatientSex);
  const indication =
    apiEntry?.indication ??
    firstNonEmptyString(
      instance.ReasonForRequestedProcedure,
      instance.ReasonForStudy,
      instance.AdmittingDiagnosesDescription
    );

  const ageSex = [age, sex].filter(Boolean).join(' ');
  if (!ageSex && !indication) {
    return null;
  }

  const truncated =
    indication && indication.length > INDICATION_TRUNCATE_AT
      ? `${indication.slice(0, INDICATION_TRUNCATE_AT - 1)}…`
      : indication;

  return (
    <div
      // pl-1 mirrors the ml-1 indent the base `ohif.overlayItem` puts on its
      // value span, so this line left-aligns with the stock top-left items
      // (date / series / study description) rendered beneath it.
      className="overlay-item flex flex-row pl-1"
      data-cy="clinical-context"
      // Hover-to-expand on a truncated indication needs pointer events; the
      // hit area is one ~12px text line in the corner, outside the anatomy.
      style={{ pointerEvents: truncated !== indication ? 'auto' : 'none', whiteSpace: 'nowrap' }}
      title={truncated !== indication ? indication ?? undefined : undefined}
    >
      {ageSex ? <span style={{ fontWeight: 600 }}>{ageSex}</span> : null}
      {ageSex && truncated ? <span style={{ margin: '0 4px' }}>·</span> : null}
      {truncated ? <span>{truncated}</span> : null}
    </div>
  );
}

export const clinicalContextOverlayItem = {
  id: CLINICAL_CONTEXT_OVERLAY_ITEM_ID,
  title: 'Clinical context (age · sex · indication)',
  contentF: (props: Record<string, any>) => {
    const { instance, referenceInstance, displaySet, servicesManager } = props ?? {};
    // Study-level tags: the displaySet's reference instance is stable across
    // scrolling (`instance` changes per image and may be absent on volumes).
    const inst = referenceInstance ?? instance;
    if (!inst) {
      return null;
    }
    return (
      <ClinicalContextLine
        instance={inst}
        studyInstanceUID={displaySet?.StudyInstanceUID ?? inst.StudyInstanceUID}
        servicesManager={servicesManager}
      />
    );
  },
};

export default clinicalContextOverlayItem;
