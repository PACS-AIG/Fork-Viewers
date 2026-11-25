/**
 * RS-36: the Anatomy tab's 3D view: a series' display surfaces (contract
 * 1.17, D-345), like Slicer's 3D view of a segmentation.
 *
 *   - Opening it reads the series' surfaces (once; the store checks each
 *     file) and draws each structure as it arrives (anatomy3dScene, vtk.js).
 *   - The Anatomy tab's colours and toggles: a structure or a task hidden
 *     there is hidden here (the body cavities start hidden: they wrap
 *     everything; shown, they are see-through, CONTAINER_OPACITY, and so is
 *     the skull, which wraps the brain). The
 *     structure in the spotlight (selected, or pointed at in the table) stays
 *     solid, every other one fades to OTHERS_OPACITY.
 *   - Front view, Enlarge (over the images, beside the pane, so the toggles
 *     stay at hand) and close.
 *
 * Display surfaces only: never a measurement, never in OHIF's segmentation
 * panel or a SEG.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SceneLook, SurfaceScene } from './anatomy3dScene';
import {
  isContainerTask,
  type AnatomySnapshot,
  type AnatomyStore,
  type AnatomyTask,
} from './anatomyStore';

/** Makes the scene in a container (null: the page draws no WebGL). */
export type SceneFactory = (container: HTMLElement) => Promise<SurfaceScene | null>;

const vtkScene: SceneFactory = async container =>
  (await import('./anatomy3dScene')).createSurfaceScene(container);
let sceneFactory: SceneFactory = vtkScene;
/** Another way to make the scene (the unit tests' stand-in); null puts vtk.js back. */
export function setSceneFactory(factory: SceneFactory | null): void {
  sceneFactory = factory ?? vtkScene;
}

/** Every other structure's opacity while one is in the spotlight. */
export const OTHERS_OPACITY = 0.15;
/** A structure that wraps others (a body cavity, the skull): see-through, so what it holds shows. */
export const CONTAINER_OPACITY = 0.3;

/**
 * A structure that wraps the others it is drawn with, though its task does not
 * (WeiWei, 26 Nov 2026: the skull hid the brain and the ventricles from every
 * side): see-through while nothing is in the spotlight.
 */
export const wrapsOthers = (s: { rawClass: string | null; name: string }): boolean =>
  /^skull$/i.test(s.rawClass ?? s.name);

/** Each structure's look in 3D: the Anatomy tab's colours and toggles, and its spotlight. */
export function looksFor(snap: AnatomySnapshot, series: number, keys: string[]): SceneLook[] {
  const shownTasks = new Set(
    (snap.series[series]?.tasks ?? []).filter(t => t.visible).map(t => t.task)
  );
  const shown = (key: string) => {
    const s = snap.structures[key];
    return Boolean(s?.visible && shownTasks.has(s.task));
  };
  const lit = snap.hovered ?? snap.selected;
  const spot = lit && keys.includes(lit) && shown(lit) ? lit : null;
  return keys.map(key => {
    const s = snap.structures[key];
    return {
      key,
      visible: shown(key),
      color: s?.color ?? [200, 200, 200],
      opacity:
        spot && key !== spot
          ? OTHERS_OPACITY
          : !spot && s && (isContainerTask(s.task) || wrapsOthers(s))
            ? CONTAINER_OPACITY
            : 1,
    };
  });
}

/** What the view says about its series' surfaces. */
export function surfaceStatusLine(tasks: AnatomyTask[]): string {
  const withFile = tasks.filter(
    t => t.surfaces.status !== 'none' && t.surfaces.status !== 'withheld'
  );
  const reading = withFile.filter(
    t => t.surfaces.status === 'waiting' || t.surfaces.status === 'loading'
  );
  const ready = withFile.filter(t => t.surfaces.status === 'ready');
  const parts: string[] = [];
  if (reading.length) {
    parts.push(`Reading the surfaces: ${ready.length} of ${withFile.length} files`);
  } else if (ready.length) {
    const structures = ready.reduce((n, t) => n + t.surfaces.structures, 0);
    const triangles = ready.reduce((n, t) => n + t.surfaces.triangles, 0);
    parts.push(`${structures} structures, ${triangles.toLocaleString('en-US')} triangles`);
  }
  for (const t of tasks) {
    if ((t.surfaces.status === 'refused' || t.surfaces.status === 'invalid') && t.surfaces.reason) {
      parts.push(`${t.title}: not drawn, ${t.surfaces.reason}`);
    } else if (t.surfaces.status === 'withheld' && t.surfaces.reason) {
      parts.push(`${t.title}: no surfaces (${t.surfaces.reason})`);
    }
  }
  return parts.length ? parts.join(' · ') : 'This series has no surfaces.';
}

// The open view's state, for the harness (counts only).
let harness: Record<string, unknown> | null = null;
export const anatomy3dHarness = (): Record<string, unknown> | null => harness;

export function Anatomy3DView({
  store,
  series,
  enlarged = false,
  inViewport = false,
  onEnlarge,
  onClose,
}: {
  store: AnatomyStore;
  series: number;
  enlarged?: boolean;
  /** In a cell of the viewer's grid (anatomy3dCell), not in the pane. */
  inViewport?: boolean;
  onEnlarge?: () => void;
  onClose?: () => void;
}) {
  const where = inViewport ? 'viewport' : enlarged ? 'enlarged' : 'inline';
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<SurfaceScene | null>(null);
  // 'failed': the scene's code could not be loaded (the network, or an older page after a deploy).
  const [webgl, setWebgl] = useState<'pending' | 'yes' | 'no' | 'failed'>('pending');

  useEffect(() => store.openSurfaces(series), [store, series]);

  useEffect(() => {
    let gone = false;
    const el = box.current;
    if (!el) {
      return;
    }
    sceneFactory(el)
      .then(made => {
        if (gone) {
          made?.dispose();
          return;
        }
        scene.current = made;
        setWebgl(made ? 'yes' : 'no');
      })
      .catch(() => {
        if (!gone) {
          setWebgl('failed');
        }
      });
    return () => {
      gone = true;
      scene.current?.dispose();
      scene.current = null;
      harness = null;
    };
  }, []);

  // Draw what is read so far, as the tab shows it.
  useEffect(() => {
    const sc = scene.current;
    if (webgl !== 'yes' || !sc) {
      harness = {
        open: true,
        enlarged,
        where,
        webgl: webgl === 'pending' ? null : false,
        ...(webgl === 'failed' ? { failed: true } : {}),
      };
      return;
    }
    const entries = store.surfacesFor(series);
    sc.addMeshes(entries);
    sc.setLooks(
      looksFor(
        snap,
        series,
        entries.map(e => e.key)
      )
    );
    harness = { open: true, enlarged, where, webgl: true, ...sc.stats() };
  }, [snap, webgl, store, series, enlarged, where]);

  // The window follows its box's size.
  useEffect(() => {
    const el = box.current;
    const sc = scene.current;
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!el || !sc || typeof RO !== 'function') {
      return;
    }
    const observer = new RO(() => sc.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, [webgl]);

  const status =
    webgl === 'no'
      ? 'The 3D view needs WebGL, which this browser does not give.'
      : webgl === 'failed'
        ? 'The 3D view could not be loaded: reload the page to try again.'
        : surfaceStatusLine(snap.series[series]?.tasks ?? []);
  return (
    <div
      className="prs-3d"
      data-rs-anatomy-3d={where}
    >
      <div className="prs-3d-bar">
        <span
          className="prs-3d-status"
          role="status"
          data-rs-anatomy-3d-status=""
        >
          {status}
        </span>
        <button
          type="button"
          className="prs-btn"
          disabled={webgl !== 'yes'}
          data-rs-anatomy-3d-reset=""
          title="Back to the front view, fitting what is shown"
          onClick={() => scene.current?.resetView()}
        >
          Front view
        </button>
        {onEnlarge ? (
          <button
            type="button"
            className="prs-btn"
            data-rs-anatomy-3d-enlarge=""
            onClick={onEnlarge}
          >
            {enlarged ? 'Back to the pane' : 'Enlarge'}
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            className="prs-btn"
            aria-label={inViewport ? 'Take the 3D model out of the viewports' : 'Close the 3D view'}
            data-rs-anatomy-3d-close=""
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </div>
      <div
        ref={box}
        className="prs-3d-view"
        data-rs-anatomy-3d-view=""
      />
      <div className="prs-3d-foot">
        Drag to turn, scroll to zoom. Display surfaces only: never for measuring.
      </div>
    </div>
  );
}
