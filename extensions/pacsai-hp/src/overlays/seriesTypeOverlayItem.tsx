import React from 'react';
import getImagePlane from '../utils/getImagePlane';
import getImageKernel from '../utils/getImageKernel';

/**
 * Viewport overlay item that labels each viewport with its series type — the
 * computed plane (AXIAL / CORONAL / SAGITTAL) and, for CT, the reconstruction
 * kernel class (SOFT / BONE). Helps the user tell apart otherwise similar
 * reformats whose SeriesDescription may be uninformative ("REFORMATS").
 *
 * Registered into `viewportOverlay.topRight` (see the longitudinal mode).
 */
export const SERIES_TYPE_OVERLAY_ITEM_ID = 'pacsai-series-type';

function getModality(displaySet: any): string | undefined {
  const m = displaySet?.Modality ?? displaySet?.instances?.[0]?.Modality;
  return m ? String(m).toUpperCase() : undefined;
}

export const seriesTypeOverlayItem = {
  id: SERIES_TYPE_OVERLAY_ITEM_ID,
  title: 'Series type',
  contentF: (props: Record<string, any>) => {
    const { displaySet } = props ?? {};
    if (!displaySet) {
      return null;
    }

    const parts: string[] = [];

    const plane = getImagePlane(displaySet);
    if (plane) {
      parts.push(plane.toUpperCase());
    }

    // Kernel class is only meaningful for CT.
    if (getModality(displaySet) === 'CT') {
      parts.push(getImageKernel(displaySet) === 'bone' ? 'BONE' : 'SOFT');
    }

    if (!parts.length) {
      return null;
    }

    return (
      <span
        data-cy="series-type-indicator"
        style={{ color: '#5DE2E7', fontWeight: 'bold', letterSpacing: '0.05em' }}
      >
        {parts.join(' · ')}
      </span>
    );
  },
};

export default seriesTypeOverlayItem;
