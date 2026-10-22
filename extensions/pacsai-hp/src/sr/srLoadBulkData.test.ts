/**
 * 22 Oct (prod), the SR's loader (cornerstone-dicom-sr getSopClassHandlerModule
 * `_load`, run when an SR is hung): it fetched every bulk data reference in the
 * content tree and made each a Float32Array, which is right for graphic data and
 * wrong for a report text (TextValue, UT). A 1178-byte text threw (not a multiple
 * of 4); the rejection reached the route's error boundary, which listens for
 * unhandled rejections, and the viewer went blank. A text reference now stays a
 * reference: the content item fetches and decodes it (textBulkData.test.tsx).
 */
jest.mock('@ohif/core', () => ({
  utils: {
    sopClassDictionary: {
      BasicTextSR: '1.2.840.10008.5.1.4.1.1.88.11',
      EnhancedSR: '1.2.840.10008.5.1.4.1.1.88.22',
      ComprehensiveSR: '1.2.840.10008.5.1.4.1.1.88.33',
      Comprehensive3DSR: '1.2.840.10008.5.1.4.1.1.88.34',
    },
    sortStudyInstances: () => undefined,
    guid: () => 'ds-sr',
  },
  classes: { ImageSet: class {}, MetadataProvider: {} },
  DisplaySetService: {},
}));
jest.mock('@ohif/extension-cornerstone', () => ({
  Enums: {
    CORNERSTONE_3D_TOOLS_SOURCE_NAME: 'Cornerstone3DTools',
    CORNERSTONE_3D_TOOLS_SOURCE_VERSION: '0.1',
  },
}));
// ESM-only (its exports have no require condition), so jest cannot resolve it: virtual.
jest.mock(
  '@cornerstonejs/adapters',
  () => ({ adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: '99dcmjs' } } } }),
  { virtual: true }
);
jest.mock('../../../cornerstone-dicom-sr/src/utils/addSRAnnotation', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../../cornerstone-dicom-sr/src/utils/isRehydratable', () => ({
  __esModule: true,
  default: () => false,
}));

// eslint-disable-next-line import/first
import getSopClassHandlerModule from '../../../cornerstone-dicom-sr/src/getSopClassHandlerModule';

// The text's bytes as prod's: 1178, not a multiple of 4.
const bulkDataURI = jest.fn(async ({ BulkDataURI }: { BulkDataURI: string }) =>
  BulkDataURI.endsWith('/text') ? new ArrayBuffer(1178) : new Float32Array([1, 2, 3, 4]).buffer
);
const servicesManager = {
  services: {
    displaySetService: {
      activeDisplaySets: [],
      subscribe: jest.fn(),
      EVENTS: { DISPLAY_SETS_ADDED: 'added' },
    },
    measurementService: { getSourceMappings: () => [] },
  },
};
const extensionManager = { getDataSources: () => [{ retrieve: { bulkDataURI } }] };

const textReference = { BulkDataURI: 'https://arc.example/bulk/text', retrieveBulkData: jest.fn() };
const graphicReference = { BulkDataURI: 'https://arc.example/bulk/graphic' };
const report = {
  StudyInstanceUID: '1.2.3',
  SeriesInstanceUID: '1.2.3.4',
  SOPInstanceUID: '1.2.3.4.5',
  SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.11',
  Modality: 'SR',
  ConceptNameCodeSequence: { CodeValue: '18748-4', CodeMeaning: 'Diagnostic Imaging Report' },
  ContentSequence: [
    {
      ValueType: 'TEXT',
      ConceptNameCodeSequence: { CodeValue: '121073', CodeMeaning: 'Impression' },
      TextValue: textReference,
    },
    {
      ValueType: 'SCOORD',
      ConceptNameCodeSequence: { CodeValue: '111030', CodeMeaning: 'Image Region' },
      GraphicData: graphicReference,
    },
  ],
};

describe("the SR's loader and bulk data in its content tree", () => {
  it('leaves a text reference alone, and still makes graphic data a Float32Array', async () => {
    const handler = getSopClassHandlerModule({ servicesManager, extensionManager } as never)[0];
    const [displaySet] = handler.getDisplaySetsFromSeries([report]);
    await displaySet.load();
    expect(report.ContentSequence[0].TextValue).toBe(textReference);
    expect(bulkDataURI).toHaveBeenCalledTimes(1);
    expect(bulkDataURI).toHaveBeenCalledWith(
      expect.objectContaining({ BulkDataURI: 'https://arc.example/bulk/graphic' })
    );
    expect(report.ContentSequence[1].GraphicData).toBeInstanceOf(Float32Array);
    expect(displaySet.isLoaded).toBe(true);
  });
});
