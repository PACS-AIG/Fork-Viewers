/**
 * RS-36: the pane's 3D scene of the anatomy's display surfaces, drawn with
 * vtk.js in a render window of its own (its own WebGL context, beside
 * cornerstone's), never through cornerstone's segmentation state: so nothing
 * reaches OHIF's segmentation panel or a SEG.
 *
 * Each structure is one actor: its points and triangles as the reading
 * system built them (LPS mm), smooth-shaded from computed normals. The view
 * opens from the front, the head up and the patient's right on the left, as
 * a radiologist reads; the trackball turns it, the wheel zooms.
 *
 * Loaded on demand (the 3D view imports it when it opens), so neither the
 * pane's first paint nor its tests load vtk.js.
 */
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkPolyDataNormals from '@kitware/vtk.js/Filters/Core/PolyDataNormals';
import type { Rgb } from './anatomyColors';
import { vtkPolys } from './anatomySurfaces';

export interface SceneMesh {
  key: string;
  points: Float32Array;
  triangles: Uint32Array;
}

export interface SceneLook {
  key: string;
  visible: boolean;
  color: Rgb;
  opacity: number;
}

export interface SurfaceScene {
  /** Add the meshes it does not have yet (by key). */
  addMeshes(meshes: SceneMesh[]): void;
  /** Each structure's visibility, colour and opacity. */
  setLooks(looks: SceneLook[]): void;
  /** Back to the front view, fitting what is shown. */
  resetView(): void;
  /** Fit the render window to its container again. */
  resize(): void;
  dispose(): void;
  stats(): { actors: number; visibleActors: number; triangles: number; visibleTriangles: number };
}

const BACKGROUND: [number, number, number] = [10 / 255, 17 / 255, 27 / 255];

/** Whether this page can draw WebGL at all (a browser without it gets none). */
export function webglAvailable(doc: Document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch (_) {
    return false;
  }
}

/** The scene in this container, or null when the page cannot draw WebGL. */
export function createSurfaceScene(container: HTMLElement): SurfaceScene | null {
  if (!webglAvailable(container.ownerDocument)) {
    return null;
  }
  const grw = vtkGenericRenderWindow.newInstance({
    background: BACKGROUND,
    listenWindowResize: false,
  });
  grw.setContainer(container);
  // vtk.js listens for keys on the whole page (r, w, s and v reset the view or redraw it as wires or points),
  // and the report is typed on this page: the 3D view takes no keys.
  const interactor = grw.getInteractor();
  document.removeEventListener('keypress', interactor.handleKeyPress);
  document.removeEventListener('keydown', interactor.handleKeyDown);
  document.removeEventListener('keyup', interactor.handleKeyUp);
  const canvas = container.querySelector('canvas');
  grw.resize();
  const renderer = grw.getRenderer();
  const renderWindow = grw.getRenderWindow();
  const actors = new Map<
    string,
    { actor: ReturnType<typeof vtkActor.newInstance>; triangles: number }
  >();
  let viewed = false;

  const frontView = () => {
    const camera = renderer.getActiveCamera();
    camera.setFocalPoint(0, 0, 0);
    // LPS: the patient's front is -y, the head +z; seen from the front, the patient's left (+x) is on the right.
    camera.setPosition(0, -1, 0);
    camera.setViewUp(0, 0, 1);
    renderer.resetCamera();
  };

  return {
    addMeshes(meshes) {
      let added = 0;
      for (const m of meshes) {
        if (actors.has(m.key)) {
          continue;
        }
        const polyData = vtkPolyData.newInstance();
        polyData.getPoints().setData(m.points, 3);
        polyData.setPolys(vtkCellArray.newInstance({ values: vtkPolys(m.triangles) }));
        const normals = vtkPolyDataNormals.newInstance();
        normals.setInputData(polyData);
        const mapper = vtkMapper.newInstance();
        mapper.setInputData(normals.getOutputData());
        const actor = vtkActor.newInstance();
        actor.setMapper(mapper);
        const property = actor.getProperty();
        property.setInterpolationToPhong();
        property.setAmbient(0.15);
        property.setDiffuse(0.8);
        property.setSpecular(0.25);
        property.setSpecularPower(20);
        actor.setVisibility(false);
        renderer.addActor(actor);
        actors.set(m.key, { actor, triangles: m.triangles.length / 3 });
        added++;
      }
      if (added) {
        renderWindow.render();
      }
    },
    setLooks(looks) {
      for (const l of looks) {
        const entry = actors.get(l.key);
        if (!entry) {
          continue;
        }
        entry.actor.setVisibility(l.visible);
        const p = entry.actor.getProperty();
        p.setColor(l.color[0] / 255, l.color[1] / 255, l.color[2] / 255);
        p.setOpacity(l.opacity);
      }
      // The first time something is shown, the view opens on it from the front.
      if (!viewed && [...actors.values()].some(a => a.actor.getVisibility())) {
        viewed = true;
        frontView();
      }
      renderWindow.render();
    },
    resetView() {
      frontView();
      renderWindow.render();
    },
    resize() {
      grw.resize();
    },
    dispose() {
      actors.clear();
      grw.delete();
      // vtk.js leaves its WebGL context to the garbage collector: give it back now, as the page has few beside
      // cornerstone's.
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      container.innerHTML = '';
    },
    stats() {
      let visibleActors = 0;
      let triangles = 0;
      let visibleTriangles = 0;
      actors.forEach(a => {
        triangles += a.triangles;
        if (a.actor.getVisibility()) {
          visibleActors++;
          visibleTriangles += a.triangles;
        }
      });
      return { actors: actors.size, visibleActors, triangles, visibleTriangles };
    },
  };
}
