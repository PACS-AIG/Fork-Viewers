import React from 'react';
import getImagePlane from '../utils/getImagePlane';
import { getImageKernelInfo } from '../utils/getImageKernel';

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
    const { displaySet, servicesManager } = props ?? {};
    if (!displaySet) {
      return null;
    }

    const instance = firstInstance(displaySet);
    const modality = getModality(displaySet);
    const parts: React.ReactNode[] = [];

    // Coronal/sagittal of oblique reformats are disambiguated against the study's
    // axial reformat, so pass same-study siblings (matches the HP matcher's plane).
    const displaySetService = servicesManager?.services?.displaySetService;
    const siblings = displaySetService
      ?.getActiveDisplaySets?.()
      ?.filter((d: any) => d?.StudyInstanceUID === displaySet?.StudyInstanceUID);
    const plane = getImagePlane(displaySet, siblings);
    if (plane) {
      parts.push(plane.toUpperCase());
    }

    // Kernel class is only meaningful for CT.
    if (modality === 'CT') {
      const kinfo = getImageKernelInfo(displaySet);
      const kernelLabel = kinfo.kernel === 'bone' ? 'BONE' : kinfo.kernel === 'lung' ? 'LUNG' : 'SOFT';
      if (kinfo.labelConflict) {
        // Series is named BONE but reconstructed with a soft kernel — show BONE per
        // the label, with a red marker + tooltip so the reader knows the real kernel.
        parts.push(
          <span
            key="kernel"
            data-cy="series-type-kernel-conflict"
            title={`Series name implies BONE, but it was reconstructed with a SOFT kernel${
              kinfo.convKernel ? ` (${kinfo.convKernel})` : ''
            }. Labeled BONE per the series description.`}
            style={{
              backgroundColor: '#b91c1c',
              color: '#fff',
              padding: '0 4px',
              borderRadius: '3px',
              // Viewport overlays render with pointer-events:none so cornerstone tools
              // work underneath; re-enable it on this chip alone so the title tooltip
              // (and the help cursor) trigger on hover.
              pointerEvents: 'auto',
              cursor: 'help',
            }}
          >
            {kernelLabel}
          </span>
        );
      } else {
        parts.push(kernelLabel);
      }
    }

    const thickness = formatThickness(displaySet);
    if (thickness) {
      parts.push(thickness);
    }

    // Fallback for series without plane/thickness (e.g. CR/DX): show modality
    // and view position / laterality so the tag still appears.
    if (!parts.length) {
      if (modality) {
        parts.push(String(modality));
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
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 ? ' · ' : ''}
            {part}
          </React.Fragment>
        ))}
      </span>
    );
  },
};

export default seriesTypeOverlayItem;
