/**
 * RS-36: the parts of vtk.js modules the 3D scene uses that vtk.js ships no
 * declarations for.
 */
declare module '@kitware/vtk.js/Filters/Core/PolyDataNormals' {
  import type vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';

  /** Point normals for smooth shading: its output is the input with normals. */
  export interface vtkPolyDataNormals {
    setInputData(data: vtkPolyData): void;
    getOutputData(): vtkPolyData;
    delete(): void;
  }

  const vtkPolyDataNormals: {
    newInstance(initialValues?: Record<string, unknown>): vtkPolyDataNormals;
  };
  export default vtkPolyDataNormals;
}
