import React from 'react';

/**
 * Bottom-left viewport overlay items: patient identification — name on one line,
 * then MRN · sex · date-of-birth.
 *
 * These render their own markup (no `inheritsFrom`) so the text is FLUSH-LEFT,
 * aligned with the stock W:/L: readout below them. The base `ohif.overlayItem`
 * wraps its value in an `ml-1` span (a ~4px indent), whereas the W/L row's leading
 * span has no left margin — matching that here keeps the bottom-left column
 * aligned. We reuse the same `overlay-item flex flex-row` class for identical
 * color/typography. Registered into `viewportOverlay.bottomLeft` by the mode.
 */
export const PATIENT_NAME_OVERLAY_ITEM_ID = 'pacsai-patient-name';
export const PATIENT_DETAILS_OVERLAY_ITEM_ID = 'pacsai-patient-details';

const row = (value: React.ReactNode, title: string) =>
  value ? (
    <div className="overlay-item flex flex-row" title={title}>
      <span className="mr-2 shrink-0">{value}</span>
    </div>
  ) : null;

const patientNameOverlayItem = {
  id: PATIENT_NAME_OVERLAY_ITEM_ID,
  title: 'Patient name',
  condition: ({ referenceInstance }: Record<string, any>) => referenceInstance?.PatientName,
  contentF: ({ referenceInstance, formatters }: Record<string, any>) => {
    const name = formatters?.formatPN?.(referenceInstance.PatientName) ?? referenceInstance.PatientName;
    return row(name, 'Patient name');
  },
};

const patientDetailsOverlayItem = {
  id: PATIENT_DETAILS_OVERLAY_ITEM_ID,
  title: 'Patient ID · sex · DOB',
  condition: ({ referenceInstance }: Record<string, any>) =>
    referenceInstance &&
    (referenceInstance.PatientID || referenceInstance.PatientSex || referenceInstance.PatientBirthDate),
  contentF: ({ referenceInstance, formatters }: Record<string, any>) => {
    const mrn = referenceInstance.PatientID;
    const sex = referenceInstance.PatientSex;
    const dob =
      referenceInstance.PatientBirthDate && formatters?.formatDate
        ? formatters.formatDate(referenceInstance.PatientBirthDate)
        : referenceInstance.PatientBirthDate;
    return row([mrn, sex, dob].filter(Boolean).join(' · '), 'Patient ID · sex · DOB');
  },
};

/** Ordered name-then-details, for registration into `viewportOverlay.bottomLeft`. */
export const patientInfoOverlayItems = [patientNameOverlayItem, patientDetailsOverlayItem];

export default patientInfoOverlayItems;
