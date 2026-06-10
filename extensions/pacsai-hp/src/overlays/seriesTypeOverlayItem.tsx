import React from 'react';
import getImagePlane from '../utils/getImagePlane';
import getImageKernel from '../utils/getImageKernel';

/**
 * Viewport overlay item that labels each viewport with its series type:
 *  - plane (AXIAL / CORONAL / SAGITTAL), computed from orientation/ImageType,
 *  - kernel class (SOFT / BONE) for CT, from ConvolutionKernel,
 *  - slice thickness (e.g. 5mm).
 *
 * Falls back to modality + view position / laterality for series with no plane
 * or thickness (e.g. CR/DX projection radiographs), so every viewport gets a tag.
 *
 * Registered into `viewportOverlay.topRight` (see the longitudinal mode).
 */
export const SERIES_TYPE_OVERLAY_ITEM_ID = 'pacsai-series-type';

function firstInstance(displaySet: any): any {
  return displaySet?.instances?.[0] ?? displaySet?.images?.[0] ?? displaySet ?? {};
}

function getModality(displaySet: any): string | undefined {
  const m = displaySet?.Modality ?? firstInstance(displaySet)?.Modality;
  return m ? String(m).toUpperCase() : undefined;
}

function formatThickness(displaySet: any): string | undefined {
  const raw = displaySet?.SliceThickness ?? firstInstance(displaySet)?.SliceThickness;
  const n = parseFloat(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  // Trim trailing zeros: 5.0 -> "5mm", 0.60 -> "0.6mm", 1.25 -> "1.25mm".
  return `${+n.toFixed(2)}mm`;
}

export const seriesTypeOverlayItem = {
  id: SERIES_TYPE_OVERLAY_ITEM_ID,
  title: 'Series type',
  contentF: (props: Record<string, any>) => {
    const { displaySet } = props ?? {};
    if (!displaySet) {
      return null;
    }

    const instance = firstInstance(displaySet);
    const modality = getModality(displaySet);
    const parts: string[] = [];

    const plane = getImagePlane(displaySet);
    if (plane) {
      parts.push(plane.toUpperCase());
    }

    // Kernel class is only meaningful for CT.
    if (modality === 'CT') {
      parts.push(getImageKernel(displaySet) === 'bone' ? 'BONE' : 'SOFT');
    }

    const thickness = formatThickness(displaySet);
    if (thickness) {
      parts.push(thickness);
    }

    // Fallback for series without plane/thickness (e.g. CR/DX): show modality
    // and view position / laterality so the tag still appears.
    if (!parts.length) {
      if (modality) {
        parts.push(modality);
      }
      const viewPosition = instance?.ViewPosition;
      const laterality = instance?.ImageLaterality ?? instance?.Laterality;
      if (viewPosition) {
        parts.push(String(viewPosition));
      } else if (laterality) {
        parts.push(String(laterality));
      }
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
