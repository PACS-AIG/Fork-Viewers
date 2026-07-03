import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Enums, VolumeViewport3D, utilities as csUtils, metaData } from '@cornerstonejs/core';
import ViewportImageScrollbar from './ViewportImageScrollbar';

/**
 * Scroll minimap (PACS AI, build-spec "scroll minimap"): replaces the plain range
 * slider on MULTI-SLICE STACK viewports with a strip that maps the whole stack —
 * position thumb + i/N chip, and, when the stack contains several acquisition planes
 * (the all-in-one composite), one tinted block per contiguous plane run (A/C/S) so
 * the rad can see and jump straight to a plane. Volume / single-slice / non-stack
 * viewports keep the classic scrollbar (rendered via composition below).
 *
 * Navigation uses the EXACT same call as the classic scrollbar (jumpToSlice with
 * debounceLoading, cine stopped first), so the scroll synchronizers see a minimap
 * jump as a user scroll — the synced pane follows, echo guards apply, nothing new
 * touches the sync layer.
 *
 * Kill switch: window.PACSAI_FLAGS = { disableScrollMinimap: true } falls back to
 * the classic scrollbar. DEBUGGING: window.PACSAI_DEBUG_MINIMAP = true logs segment
 * classification per stack and (throttled) jump decisions.
 */

const verbose = () => (window as any).PACSAI_DEBUG_MINIMAP === true;
let lastJumpLog = 0;

// ---- plane classification -------------------------------------------------------
// Duplicated from pacsai-hp's createAllInOneScrollSynchronizer (cornerstone ext must
// not depend on pacsai-hp — wrong dependency direction). Keep the math in sync.

function vec3(x: any): number[] | undefined {
  if (!x || typeof x.length !== 'number' || x.length < 3) {
    return undefined;
  }
  const a = [Number(x[0]), Number(x[1]), Number(x[2])];
  return a.some(n => Number.isNaN(n)) ? undefined : a;
}

function planeOfImageId(imageId: string): string | undefined {
  const m = metaData.get('imagePlaneModule', imageId) as any;
  if (!m) {
    return undefined;
  }
  let row = vec3(m.rowCosines);
  let col = vec3(m.columnCosines);
  if (!row || !col) {
    const iop = m.imageOrientationPatient;
    if (iop && iop.length >= 6) {
      row = vec3([iop[0], iop[1], iop[2]]);
      col = vec3([iop[3], iop[4], iop[5]]);
    }
  }
  if (!row || !col) {
    return undefined;
  }
  const nx = Math.abs(row[1] * col[2] - row[2] * col[1]);
  const ny = Math.abs(row[2] * col[0] - row[0] * col[2]);
  const nz = Math.abs(row[0] * col[1] - row[1] * col[0]);
  if (nz >= nx && nz >= ny) {
    return 'axial';
  }
  return nx >= ny ? 'sagittal' : 'coronal';
}

type Segment = { plane: string | undefined; start: number; count: number };

// Contiguous same-plane runs of a stack, memoized by a cheap signature (the thumb
// re-renders every slice; classification must not re-run then).
const segmentCache = new Map<string, Segment[]>();
function segmentsFor(imageIds: string[]): Segment[] {
  const sig = `${imageIds.length}|${imageIds[0]}|${imageIds[imageIds.length - 1]}`;
  let segments = segmentCache.get(sig);
  if (!segments) {
    segments = [];
    for (let i = 0; i < imageIds.length; i++) {
      let plane: string | undefined;
      try {
        plane = planeOfImageId(imageIds[i]);
      } catch (e) {
        plane = undefined;
      }
      const last = segments[segments.length - 1];
      if (last && last.plane === plane) {
        last.count += 1;
      } else {
        segments.push({ plane, start: i, count: 1 });
      }
    }
    segmentCache.set(sig, segments);
    if (segmentCache.size > 32) {
      segmentCache.delete(segmentCache.keys().next().value as string);
    }
    if (verbose()) {
      console.log('[pacsai-minimap] segments', {
        images: imageIds.length,
        segments: segments.map(s => `${s.plane ?? '?'}:${s.count}`),
      });
    }
  }
  return segments;
}

// Muted, theme-independent block tints (dark viewport background assumed).
const PLANE_FILL: Record<string, string> = {
  axial: 'rgba(49, 215, 255, 0.28)',
  coronal: 'rgba(255, 179, 96, 0.30)',
  sagittal: 'rgba(167, 139, 250, 0.32)',
};
const UNKNOWN_FILL = 'rgba(142, 164, 184, 0.18)';
const PLANE_LETTER: Record<string, string> = { axial: 'A', coronal: 'C', sagittal: 'S' };
// Accent follows the runtime theme (dark cyan / warm-night amber) via the --pacs-*
// triplets defined in @ohif/ui tailwind.css; hex fallback for safety.
const ACCENT = 'rgb(var(--pacs-primary-light, 49 215 255))';

// ---- component ------------------------------------------------------------------

function ViewportScrollMinimap(props: withAppTypes) {
  const {
    viewportId,
    viewportData,
    element,
    imageSliceData,
    setImageSliceData,
    scrollbarHeight,
    servicesManager,
  } = props;
  const { cineService, cornerstoneViewportService } = servicesManager.services;

  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const disabled = (window as any).PACSAI_FLAGS?.disableScrollMinimap === true;
  const isStack = viewportData?.viewportType === Enums.ViewportType.STACK;

  // Index tracking for the stack path (mirrors ViewportImageScrollbar's listeners,
  // which are NOT active on this path since we render instead of it).
  useEffect(() => {
    if (!viewportData || !isStack || disabled) {
      return;
    }
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport || viewport instanceof VolumeViewport3D) {
      return;
    }
    try {
      setImageSliceData({
        imageIndex: viewport.getCurrentImageIdIndex(),
        numberOfSlices: viewport.getNumberOfSlices(),
      });
    } catch (error) {
      console.warn(error);
    }
  }, [viewportId, viewportData, isStack, disabled]);

  useEffect(() => {
    if (!viewportData || !isStack || disabled || !element) {
      return;
    }
    const updateIndex = event => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport || viewport instanceof VolumeViewport3D) {
        return;
      }
      const { imageIndex, newImageIdIndex = imageIndex } = event.detail;
      setImageSliceData({
        imageIndex: newImageIdIndex,
        numberOfSlices: viewport.getNumberOfSlices(),
      });
    };
    element.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, updateIndex);
    return () => {
      element.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, updateIndex);
    };
  }, [viewportData, element, isStack, disabled]);

  const numberOfSlices = imageSliceData?.numberOfSlices ?? 0;
  const imageIndex = imageSliceData?.imageIndex ?? 0;

  // Plane segments — recomputed only when the stack itself changes (viewportData /
  // slice count), served from the signature cache on every other render.
  const segments = useMemo<Segment[]>(() => {
    if (!isStack || disabled || numberOfSlices < 2) {
      return [];
    }
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    const imageIds = viewport?.getImageIds?.() ?? [];
    if (imageIds.length < 2) {
      return [];
    }
    return segmentsFor(imageIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStack, disabled, viewportId, viewportData, numberOfSlices]);

  // Non-stack viewports (volumes) keep the classic scrollbar — same props contract.
  if (disabled || (viewportData && !isStack)) {
    return <ViewportImageScrollbar {...props} />;
  }
  if (!viewportData || numberOfSlices < 2) {
    return null;
  }

  const jumpTo = (index: number) => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport?.element) {
      return;
    }
    const { isCineEnabled } = cineService.getState();
    if (isCineEnabled) {
      // mirror the classic scrollbar: a manual jump stops CINE
      cineService.stopClip(element, { viewportId });
      cineService.setCine({ id: viewportId, isPlaying: false });
    }
    if (verbose() && Date.now() - lastJumpLog > 500) {
      lastJumpLog = Date.now();
      console.log('[pacsai-minimap] jump', { viewportId, index, numberOfSlices });
    }
    csUtils.jumpToSlice(viewport.element, { imageIndex: index, debounceLoading: true });
  };

  const indexFromPointer = (e: React.PointerEvent): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) {
      return imageIndex;
    }
    const frac = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return Math.min(numberOfSlices - 1, Math.max(0, Math.round(frac * (numberOfSlices - 1))));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    const idx = indexFromPointer(e);
    if (idx !== imageIndex) {
      jumpTo(idx);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const idx = indexFromPointer(e);
    if (idx !== imageIndex) {
      jumpTo(idx);
    }
  };
  const endDrag = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
  };

  const thumbTopPct = numberOfSlices > 1 ? (imageIndex / (numberOfSlices - 1)) * 100 : 0;
  const multiPlane = segments.length > 1;

  return (
    <div
      data-cy="pacsai-scroll-minimap"
      style={{
        position: 'absolute',
        top: 30,
        right: 2,
        height: scrollbarHeight,
        width: 14,
        zIndex: 20,
        cursor: 'pointer',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* track + plane blocks */}
      <div
        ref={trackRef}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 2,
          width: hovering || dragging ? 10 : 6,
          borderRadius: 3,
          overflow: 'hidden',
          background: multiPlane ? 'transparent' : UNKNOWN_FILL,
          transition: 'width 120ms',
        }}
      >
        {multiPlane &&
          segments.map((seg, i) => {
            const topPct = (seg.start / numberOfSlices) * 100;
            const heightPct = (seg.count / numberOfSlices) * 100;
            const letter = seg.plane ? PLANE_LETTER[seg.plane] : undefined;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: `${topPct}%`,
                  height: `${heightPct}%`,
                  background: seg.plane ? PLANE_FILL[seg.plane] : UNKNOWN_FILL,
                  borderTop: i > 0 ? '1px solid rgba(0,0,0,0.6)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {(hovering || dragging) && letter && heightPct > 7 && (
                  <span
                    style={{
                      fontSize: 8,
                      lineHeight: 1,
                      color: 'rgba(255,255,255,0.75)',
                      userSelect: 'none',
                      pointerEvents: 'none',
                    }}
                  >
                    {letter}
                  </span>
                )}
              </div>
            );
          })}
      </div>

      {/* thumb */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          width: hovering || dragging ? 14 : 10,
          height: 2,
          top: `calc(${thumbTopPct}% - 1px)`,
          background: ACCENT,
          borderRadius: 1,
          pointerEvents: 'none',
          transition: 'width 120ms',
        }}
      />

      {/* i/N chip while interacting */}
      {(hovering || dragging) && (
        <div
          style={{
            position: 'absolute',
            right: 18,
            top: `calc(${thumbTopPct}% - 9px)`,
            padding: '1px 5px',
            borderRadius: 4,
            background: 'rgba(0,0,0,0.75)',
            color: 'rgba(255,255,255,0.9)',
            fontSize: 10,
            lineHeight: '14px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {imageIndex + 1}/{numberOfSlices}
        </div>
      )}
    </div>
  );
}

ViewportScrollMinimap.propTypes = {
  viewportData: PropTypes.object,
  viewportId: PropTypes.string.isRequired,
  element: PropTypes.instanceOf(Element),
  scrollbarHeight: PropTypes.string,
  imageSliceData: PropTypes.object.isRequired,
  setImageSliceData: PropTypes.func.isRequired,
  servicesManager: PropTypes.object.isRequired,
};

export default ViewportScrollMinimap;
