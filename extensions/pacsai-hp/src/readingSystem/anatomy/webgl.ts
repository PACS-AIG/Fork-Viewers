/**
 * RS-36: whether this page can draw WebGL at all (a browser without it gets
 * none). Its own module, so the 3D anatomy cell can ask without loading
 * vtk.js (anatomy3dScene, loaded only when a 3D view opens).
 */
export function webglAvailable(doc: Document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch (_) {
    return false;
  }
}
