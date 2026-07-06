import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Enums, metaData, utilities as csUtils } from '@cornerstonejs/core';
import { planeOfImageId, rowColOf, vec3 } from './imagePlaneOf';

/**
 * Scout navigator (PACS AI, build-spec "scout navigator"): a small inset on the
 * ACTIVE stack viewport showing the study's scout/localizer with a line marking the
 * current slice's position in the patient — the classic "where am I in the body"
 * reference. The line tracks scrolling live; CLICKING the scout jumps the stack to
 * that anatomical level (jumpToSlice — the scrollbar's call, so scroll sync sees it
 * as a user scroll).
 *
 * Geometry (pure DICOM patient-space math, no cornerstone viewport for the scout):
 *   world(i,j) = IPP + rowCosines·(i·colSpacing) + colCosines·(j·rowSpacing)
 * The current image's four corners are projected orthographically onto the scout
 * plane; the two most distant projections form the slice line. A click inverts the
 * mapping (scout pixel → world point) and jumps to the stack slice whose plane is
 * nearest to that point.
 *
 * Scout pick (STRICT): same-study displaySets, MONOCHROME only (derived RGB
 * screenshots like "Rapid RV/LV Ratio" are never scouts), with full plane geometry
 * (IOP + spacing + dims), image plane DIFFERENT from the stack's plane — required
 * for a meaningful line: a coronal slice projected on a coronal scout degenerates
 * to the whole image, so an axial stack gets a coronal/sagittal scout, a coronal
 * stack gets a sagittal one, etc. Ranked: description-matched scouts
 * (scout/topo/localizer) first, then the 1-2-image CT/MR fallback; within a rank,
 * plane preference coronal → sagittal → axial. Rendered via loadImageToCanvas into
 * a cached dataURL (same pattern as thumbnails/hover-scrub). Every pick logs
 * '[pacsai-scout] scout chosen' once per (viewport, scout) so a wrong image in the
 * inset is attributable from the console.
 *
 * Shown PER PANE on every stack viewport with >1 slice and a usable scout — in a
 * current|prior compare each pane shows its OWN study's scout. Collapsible
 * (persisted, localStorage 'pacsai.scoutNavigator').
 * Kill switch: window.PACSAI_FLAGS = { disableScoutNavigator: true }.
 * DEBUGGING: window.PACSAI_DEBUG_SCOUT = true logs scout choice, projections and
 * click-jumps; scout render failures warn once.
 */

const flags = () => (window as any).PACSAI_FLAGS ?? {};
const verbose = () => (window as any).PACSAI_DEBUG_SCOUT === true;

const SCOUT_RE = /(topo|scout|localizer)/i;
const PLANE_PREFERENCE = ['coronal', 'sagittal', 'axial'];
const COLLAPSE_KEY = 'pacsai.scoutNavigator';
const INSET_WIDTH = 132;

const scoutSrcCache = new Map<string, string>(); // imageId -> dataURL (scouts are few)
const warnedFailures = new Set<string>();
const loggedPicks = new Set<string>(); // `${viewportId}|${imageId}` — one pick log each

// ---- geometry -------------------------------------------------------------------

type PlaneInfo = {
  ipp: number[];
  row: number[]; // direction along increasing column index i
  col: number[]; // direction along increasing row index j
  rowSpacing: number; // j step (PixelSpacing[0])
  colSpacing: number; // i step (PixelSpacing[1])
  rows: number;
  columns: number;
};

function planeInfoOf(imageId: string): PlaneInfo | undefined {
  const m = metaData.get('imagePlaneModule', imageId) as any;
  const rc = rowColOf(imageId);
  const ipp = vec3(m?.imagePositionPatient);
  if (!m || !rc || !ipp || !m.rows || !m.columns) {
    return undefined;
  }
  const rowSpacing = Number(m.rowPixelSpacing ?? m.pixelSpacing?.[0]);
  const colSpacing = Number(m.columnPixelSpacing ?? m.pixelSpacing?.[1]);
  if (!rowSpacing || !colSpacing) {
    return undefined;
  }
  return {
    ipp,
    row: rc.row,
    col: rc.col,
    rowSpacing,
    colSpacing,
    rows: Number(m.rows),
    columns: Number(m.columns),
  };
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** World position of pixel (i=column, j=row) on a plane. */
function worldOf(p: PlaneInfo, i: number, j: number): number[] {
  return [
    p.ipp[0] + p.row[0] * i * p.colSpacing + p.col[0] * j * p.rowSpacing,
    p.ipp[1] + p.row[1] * i * p.colSpacing + p.col[1] * j * p.rowSpacing,
    p.ipp[2] + p.row[2] * i * p.colSpacing + p.col[2] * j * p.rowSpacing,
  ];
}

/** Orthographic projection of a world point onto a plane, as image FRACTIONS 0..1. */
function fractionOn(p: PlaneInfo, w: number[]): { x: number; y: number } {
  const d = [w[0] - p.ipp[0], w[1] - p.ipp[1], w[2] - p.ipp[2]];
  const i = dot(d, p.row) / p.colSpacing;
  const j = dot(d, p.col) / p.rowSpacing;
  return { x: i / Math.max(1, p.columns - 1), y: j / Math.max(1, p.rows - 1) };
}

/** The current image's slice line on the scout: two endpoints as fractions. */
function sliceLineOn(
  scout: PlaneInfo,
  slice: PlaneInfo
): { x1: number; y1: number; x2: number; y2: number } | undefined {
  const corners = [
    worldOf(slice, 0, 0),
    worldOf(slice, slice.columns - 1, 0),
    worldOf(slice, 0, slice.rows - 1),
    worldOf(slice, slice.columns - 1, slice.rows - 1),
  ].map(w => fractionOn(scout, w));
  // Two most distant projections define the line (an oblique slice projects to a
  // thin quadrilateral; its long diagonal is the display line).
  let best: [number, number] = [0, 1];
  let bestD = -1;
  for (let a = 0; a < corners.length; a++) {
    for (let b = a + 1; b < corners.length; b++) {
      const d = (corners[a].x - corners[b].x) ** 2 + (corners[a].y - corners[b].y) ** 2;
      if (d > bestD) {
        bestD = d;
        best = [a, b];
      }
    }
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const [a, b] = best;
  return {
    x1: clamp(corners[a].x),
    y1: clamp(corners[a].y),
    x2: clamp(corners[b].x),
    y2: clamp(corners[b].y),
  };
}

// ---- component ------------------------------------------------------------------

function ViewportScoutNavigator(props: withAppTypes) {
  const { viewportId, viewportData, element, imageSliceData, servicesManager } = props;
  const { cornerstoneViewportService, viewportGridService, displaySetService, cineService } =
    servicesManager.services;

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === 'collapsed'
  );
  const [scoutSrc, setScoutSrc] = useState<string | null>(null);
  const scoutImgRef = useRef<HTMLImageElement>(null);

  const disabled = flags().disableScoutNavigator === true;
  const isStack = viewportData?.viewportType === Enums.ViewportType.STACK;
  const numberOfSlices = imageSliceData?.numberOfSlices ?? 0;
  const imageIndex = imageSliceData?.imageIndex ?? 0;

  // The hung stack's imageIds and plane (stable per viewportData).
  const stack = useMemo(() => {
    if (!isStack || disabled) {
      return undefined;
    }
    const viewport: any = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    const imageIds: string[] = viewport?.getImageIds?.() ?? [];
    if (imageIds.length < 2) {
      return undefined;
    }
    return { imageIds, plane: planeOfImageId(imageIds[Math.floor(imageIds.length / 2)]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStack, disabled, viewportId, viewportData, numberOfSlices]);

  // Scout pick: same study, scout-ish series, image plane ≠ stack plane.
  const scout = useMemo(() => {
    if (!stack) {
      return undefined;
    }
    const { viewports } = viewportGridService.getState() ?? {};
    const dsUID = viewports?.get(viewportId)?.displaySetInstanceUIDs?.[0];
    // Works for all-in-one composites too — scouts come from the same study.
    const hung = dsUID ? displaySetService.getDisplaySetByUID(dsUID) : undefined;
    if (!hung?.StudyInstanceUID) {
      return undefined;
    }
    const candidates: Array<{
      imageId: string;
      plane: string;
      info: PlaneInfo;
      desc: string;
      descMatched: boolean;
    }> = [];
    (displaySetService.getActiveDisplaySets?.() ?? [])
      .filter((ds: any) => ds.StudyInstanceUID === hung.StudyInstanceUID && !ds.isAllInOne)
      .forEach((ds: any) => {
        const mod = String(ds.Modality ?? '').toUpperCase();
        const desc = String(ds.SeriesDescription ?? '');
        const images = Array.from(ds.images ?? ds.instances ?? []);
        const descMatched = SCOUT_RE.test(desc);
        const looksLikeScout =
          descMatched || ((mod === 'CT' || mod === 'MR') && images.length <= 2);
        if (!looksLikeScout || !images.length) {
          return;
        }
        images.slice(0, 3).forEach((inst: any) => {
          const imageId = inst?.imageId;
          if (!imageId) {
            return;
          }
          // MONOCHROME only — derived RGB screenshots (e.g. "Rapid RV/LV Ratio")
          // are never scouts, whatever their size/geometry claims.
          if (
            Number(inst.SamplesPerPixel) === 3 ||
            /RGB|YBR|PALETTE/i.test(String(inst.PhotometricInterpretation ?? ''))
          ) {
            return;
          }
          const plane = planeOfImageId(imageId);
          if (!plane || plane === stack.plane) {
            return;
          }
          // Full geometry required up front (IOP + spacing + dims) — an image the
          // projection can't use must not win the pick.
          const info = planeInfoOf(imageId);
          if (!info) {
            return;
          }
          candidates.push({ imageId, plane, info, desc, descMatched });
        });
      });
    if (!candidates.length) {
      if (verbose()) {
        console.log('[pacsai-scout] no scout found for study', hung.StudyInstanceUID);
      }
      return undefined;
    }
    // Rank: real (description-matched) scouts before the small-series fallback,
    // then by plane preference.
    const preference = PLANE_PREFERENCE.filter(p => p !== stack.plane);
    candidates.sort(
      (a, b) =>
        Number(b.descMatched) - Number(a.descMatched) ||
        preference.indexOf(a.plane) - preference.indexOf(b.plane)
    );
    const chosen = candidates[0];
    const pickKey = `${viewportId}|${chosen.imageId}`;
    if (!loggedPicks.has(pickKey)) {
      loggedPicks.add(pickKey);
      // Unconditional (once per pick): a wrong image in the inset must be
      // attributable from the console without a redeploy.
      console.log('[pacsai-scout] scout chosen', {
        viewportId,
        series: chosen.desc,
        plane: chosen.plane,
        stackPlane: stack.plane,
        descMatched: chosen.descMatched,
      });
    }
    return chosen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack, viewportId, viewportGridService, displaySetService]);

  // Render the scout image (cached dataURL).
  useEffect(() => {
    if (!scout || collapsed) {
      return;
    }
    const cached = scoutSrcCache.get(scout.imageId);
    if (cached) {
      setScoutSrc(cached);
      return;
    }
    let cancelled = false;
    const canvas = document.createElement('canvas');
    csUtils
      .loadImageToCanvas({ canvas, imageId: scout.imageId, thumbnail: true })
      .then(() => {
        const src = canvas.toDataURL();
        scoutSrcCache.set(scout.imageId, src);
        if (!cancelled) {
          setScoutSrc(src);
        }
      })
      .catch(e => {
        if (!warnedFailures.has(scout.imageId)) {
          warnedFailures.add(scout.imageId);
          console.warn('[pacsai-scout] scout render failed', { imageId: scout.imageId, error: e });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scout, collapsed]);

  // Slice line for the CURRENT image (recomputed per scroll tick — cheap math).
  const line = useMemo(() => {
    if (!scout || !stack) {
      return undefined;
    }
    const imageId = stack.imageIds[Math.min(stack.imageIds.length - 1, Math.max(0, imageIndex))];
    const slice = imageId ? planeInfoOf(imageId) : undefined;
    return slice ? sliceLineOn(scout.info, slice) : undefined;
  }, [scout, stack, imageIndex]);

  if (disabled || !isStack || !scout || numberOfSlices < 2) {
    return null;
  }

  const toggleCollapsed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, next ? 'collapsed' : 'open');
  };

  if (collapsed) {
    return (
      <button
        onClick={toggleCollapsed}
        title="Show scout navigator"
        style={{
          position: 'absolute',
          bottom: 34,
          right: 22,
          zIndex: 19,
          padding: '2px 6px',
          borderRadius: 4,
          border: '1px solid rgba(142,164,184,0.4)',
          background: 'rgba(0,0,0,0.55)',
          color: 'rgba(255,255,255,0.75)',
          fontSize: 10,
          cursor: 'pointer',
        }}
      >
        scout
      </button>
    );
  }

  const onScoutClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const img = scoutImgRef.current;
    if (!img || !stack) {
      return;
    }
    const rect = img.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / Math.max(1, rect.height)));
    const w = worldOf(scout.info, fx * (scout.info.columns - 1), fy * (scout.info.rows - 1));
    // Nearest stack slice: smallest out-of-plane distance to the clicked point.
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let k = 0; k < stack.imageIds.length; k++) {
      const p = planeInfoOf(stack.imageIds[k]);
      if (!p) {
        continue;
      }
      const n = cross(p.row, p.col);
      const dist = Math.abs(dot(w, n) - dot(p.ipp, n));
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = k;
      }
    }
    if (bestIdx < 0 || bestIdx === imageIndex) {
      return;
    }
    const { isCineEnabled } = cineService.getState();
    if (isCineEnabled) {
      cineService.stopClip(element, { viewportId });
      cineService.setCine({ id: viewportId, isPlaying: false });
    }
    if (verbose()) {
      console.log('[pacsai-scout] jump', { toIndex: bestIdx, distMm: Math.round(bestDist * 10) / 10 });
    }
    csUtils.jumpToSlice(element, { imageIndex: bestIdx, debounceLoading: true });
  };

  return (
    <div
      data-cy="pacsai-scout-navigator"
      style={{
        position: 'absolute',
        bottom: 34,
        right: 22, // clear of the minimap strip
        width: INSET_WIDTH,
        zIndex: 19,
        borderRadius: 4,
        overflow: 'hidden',
        border: '1px solid rgba(142,164,184,0.35)',
        background: 'rgba(0,0,0,0.65)',
        lineHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 4px',
          lineHeight: '12px',
        }}
      >
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', userSelect: 'none' }}>
          SCOUT · {scout.plane.toUpperCase()}
        </span>
        <button
          onClick={toggleCollapsed}
          title="Hide scout navigator"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'rgba(255,255,255,0.6)',
            fontSize: 10,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ position: 'relative', cursor: 'crosshair' }} onClick={onScoutClick}>
        {scoutSrc ? (
          <img
            ref={scoutImgRef}
            src={scoutSrc}
            alt="scout"
            style={{ width: '100%', display: 'block' }}
            draggable={false}
          />
        ) : (
          <div style={{ width: '100%', height: 80 }} />
        )}
        {line && scoutSrc && (
          <svg
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <line
              x1={line.x1 * 100}
              y1={line.y1 * 100}
              x2={line.x2 * 100}
              y2={line.y2 * 100}
              stroke="rgb(var(--pacs-primary-light, 49 215 255))"
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

ViewportScoutNavigator.propTypes = {
  viewportData: PropTypes.object,
  viewportId: PropTypes.string.isRequired,
  element: PropTypes.instanceOf(Element),
  imageSliceData: PropTypes.object.isRequired,
  servicesManager: PropTypes.object.isRequired,
};

export default ViewportScoutNavigator;
