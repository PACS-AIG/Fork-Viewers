import React from 'react';
import { getStudyRole } from '../priors/roleRegistry';

/**
 * Viewport overlay item that renders a yellow "PRIOR" badge on any viewport
 * showing the auto-loaded comparison prior.
 *
 * Registered into `viewportOverlay.topRight` (see the longitudinal mode). The
 * overlay framework only passes `servicesManager` to `contentF` (not to
 * `condition`), so the role check lives in `contentF`, returning null otherwise.
 *
 * We badge ONLY studies whose comparison role is `prior` (via the role registry),
 * NOT every non-active study — same-session siblings tiled in the whole-spine
 * overview are not priors and must not be mislabeled "PRIOR".
 */
export const PRIOR_OVERLAY_ITEM_ID = 'pacsai-prior-indicator';

export const priorOverlayItem = {
  id: PRIOR_OVERLAY_ITEM_ID,
  title: 'Prior study indicator',
  contentF: (props: Record<string, any>) => {
    const { displaySet, servicesManager, formatters } = props ?? {};
    const activeStudyUID =
      servicesManager?.services?.hangingProtocolService?.getState?.()?.activeStudyUID;

    // Only label viewports whose study is the designated comparison prior.
    if (!displaySet || getStudyRole(displaySet.StudyInstanceUID, activeStudyUID) !== 'prior') {
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
