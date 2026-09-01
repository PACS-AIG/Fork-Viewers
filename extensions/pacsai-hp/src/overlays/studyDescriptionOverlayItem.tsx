import React from 'react';

import OverlayTextLine from './OverlayTextLine';

/**
 * Top-left viewport overlay item: the StudyDescription, shown beneath the
 * series description. Useful in the spine whole-view, where each pane is a
 * different study (cervical / thoracic / lumbar) — the study description names
 * the region while the series description names the sequence.
 *
 * Mirrors the stock top-left items (inheritsFrom `ohif.overlayItem`, reads from
 * `referenceInstance`); registered into `viewportOverlay.topLeft` after the
 * series description by the longitudinal mode. Rendered through
 * `OverlayTextLine` so a study name clipped by the narrow corner is still
 * readable on hover.
 */
export const STUDY_DESCRIPTION_OVERLAY_ITEM_ID = 'pacsai-study-description';

export const studyDescriptionOverlayItem = {
  id: STUDY_DESCRIPTION_OVERLAY_ITEM_ID,
  inheritsFrom: 'ohif.overlayItem',
  label: '',
  title: 'Study description',
  condition: ({ referenceInstance }: Record<string, any>) => referenceInstance?.StudyDescription,
  contentF: ({ referenceInstance }: Record<string, any>) => (
    <OverlayTextLine text={referenceInstance.StudyDescription} />
  ),
};

export default studyDescriptionOverlayItem;
