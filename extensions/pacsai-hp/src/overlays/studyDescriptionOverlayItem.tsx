/**
 * Top-left viewport overlay item: the StudyDescription, shown beneath the
 * series description. Useful in the spine whole-view, where each pane is a
 * different study (cervical / thoracic / lumbar) — the study description names
 * the region while the series description names the sequence.
 *
 * Mirrors the stock top-left items (inheritsFrom `ohif.overlayItem`, reads from
 * `referenceInstance`); registered into `viewportOverlay.topLeft` after the
 * series description by the longitudinal mode.
 */
export const STUDY_DESCRIPTION_OVERLAY_ITEM_ID = 'pacsai-study-description';

export const studyDescriptionOverlayItem = {
  id: STUDY_DESCRIPTION_OVERLAY_ITEM_ID,
  inheritsFrom: 'ohif.overlayItem',
  label: '',
  title: 'Study description',
  condition: ({ referenceInstance }: Record<string, any>) => referenceInstance?.StudyDescription,
  contentF: ({ referenceInstance }: Record<string, any>) => referenceInstance.StudyDescription,
};

export default studyDescriptionOverlayItem;
