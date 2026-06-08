import React from 'react';

/**
 * Viewport overlay item that renders a yellow "PRIOR" badge on any viewport
 * whose study is NOT the active (current) study — i.e. the auto-loaded prior.
 *
 * Registered into `viewportOverlay.topRight` (see the longitudinal mode). The
 * overlay framework only passes `servicesManager` to `contentF` (not to
 * `condition`), so the current-vs-prior check lives in `contentF`, returning
 * null when the viewport is showing the current study.
 */
export const PRIOR_OVERLAY_ITEM_ID = 'pacsai-prior-indicator';

export const priorOverlayItem = {
  id: PRIOR_OVERLAY_ITEM_ID,
  title: 'Prior study indicator',
  contentF: (props: Record<string, any>) => {
    const { displaySet, servicesManager, formatters } = props ?? {};
    const activeStudyUID =
      servicesManager?.services?.hangingProtocolService?.getState?.()?.activeStudyUID;

    // Only label viewports showing a different study than the active/current one.
    if (!displaySet || !activeStudyUID || displaySet.StudyInstanceUID === activeStudyUID) {
      return null;
    }

    const studyDate = displaySet.instances?.[0]?.StudyDate ?? displaySet.SeriesDate;
    const dateStr = studyDate && formatters?.formatDate ? formatters.formatDate(studyDate) : '';

    return (
      <span
        data-cy="prior-indicator"
        style={{ color: '#FFFF00', fontWeight: 'bold', letterSpacing: '0.05em' }}
      >
        {dateStr ? `PRIOR · ${dateStr}` : 'PRIOR'}
      </span>
    );
  },
};

export default priorOverlayItem;
