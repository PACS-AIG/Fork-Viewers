/**
 * Bottom-left viewport overlay items: patient identification — name on one line,
 * then MRN · sex · date-of-birth. Mirrors the stock overlay items (inheritsFrom
 * `ohif.overlayItem`, reads from `referenceInstance`, uses the provided
 * formatters). Registered into `viewportOverlay.bottomLeft` by the longitudinal
 * mode, ahead of the window-level / zoom readouts.
 */
export const PATIENT_NAME_OVERLAY_ITEM_ID = 'pacsai-patient-name';
export const PATIENT_DETAILS_OVERLAY_ITEM_ID = 'pacsai-patient-details';

const patientNameOverlayItem = {
  id: PATIENT_NAME_OVERLAY_ITEM_ID,
  inheritsFrom: 'ohif.overlayItem',
  label: '',
  title: 'Patient name',
  condition: ({ referenceInstance }: Record<string, any>) => referenceInstance?.PatientName,
  contentF: ({ referenceInstance, formatters }: Record<string, any>) =>
    formatters?.formatPN?.(referenceInstance.PatientName) ?? referenceInstance.PatientName,
};

const patientDetailsOverlayItem = {
  id: PATIENT_DETAILS_OVERLAY_ITEM_ID,
  inheritsFrom: 'ohif.overlayItem',
  label: '',
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
    return [mrn, sex, dob].filter(Boolean).join(' · ');
  },
};

/** Ordered name-then-details, for registration into `viewportOverlay.bottomLeft`. */
export const patientInfoOverlayItems = [patientNameOverlayItem, patientDetailsOverlayItem];

export default patientInfoOverlayItems;
