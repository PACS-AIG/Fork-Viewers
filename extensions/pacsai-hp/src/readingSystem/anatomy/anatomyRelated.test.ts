import {
  ACQUISITION_MARGIN_S,
  acquisitionOf,
  dateSeconds,
  isProjection,
  relatedVerdict,
  seriesFacts,
  timeSeconds,
} from './anatomyRelated';

// Made-up instances (2.25 placeholders), shaped as OHIF naturalizes them.
const FOR = '2.25.7001';
const axial = (k: number, over: Record<string, unknown> = {}) => ({
  FrameOfReferenceUID: FOR,
  Modality: 'CT',
  ImageType: ['ORIGINAL', 'PRIMARY', 'AXIAL', 'CT_SOM5 SPI'],
  AcquisitionDate: '20261124',
  AcquisitionTime: `0930${String(10 + k).padStart(2, '0')}.250`,
  ...over,
});
// The scanner's reformat: one acquisition time, its first source image's.
const reformat = (over: Record<string, unknown> = {}) => ({
  FrameOfReferenceUID: FOR,
  Modality: 'CT',
  ImageType: ['DERIVED', 'PRIMARY', 'AXIAL', 'CT_SOM5 MPR'],
  AcquisitionDate: '20261124',
  AcquisitionTime: '093010.25',
  ...over,
});
const AXIAL = Array.from({ length: 20 }, (_, k) => axial(k));

describe('which other series carry a labelmap, resampled (RS-36)', () => {
  it('reads DICOM times and dates, old and new forms, and refuses what is not one', () => {
    expect(timeSeconds('093015.5')).toBe(9 * 3600 + 30 * 60 + 15.5);
    expect(timeSeconds('09:30:15')).toBe(9 * 3600 + 30 * 60 + 15);
    expect(timeSeconds('0930')).toBe(9 * 3600 + 30 * 60);
    expect(timeSeconds(['093015'])).toBe(9 * 3600 + 30 * 60 + 15);
    // A time written as a number lost its leading zero.
    expect(timeSeconds(93015.5)).toBe(9 * 3600 + 30 * 60 + 15.5);
    expect([
      timeSeconds('256000'),
      timeSeconds('noon'),
      timeSeconds(''),
      timeSeconds(null),
    ]).toEqual([null, null, null, null]);
    expect(dateSeconds('20261124')).toBe(Date.UTC(2026, 10, 24) / 1000);
    expect(dateSeconds('2026.11.24')).toBe(Date.UTC(2026, 10, 24) / 1000);
    expect([dateSeconds('20261324'), dateSeconds('2026-11-24'), dateSeconds(undefined)]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('takes an image’s acquisition from AcquisitionDateTime when it holds a time, else from its date and time', () => {
    expect(acquisitionOf({ AcquisitionDateTime: '20261124093015.123+0100' })).toEqual({
      time: 9 * 3600 + 30 * 60 + 15.123,
      date: Date.UTC(2026, 10, 24) / 1000,
    });
    expect(acquisitionOf({ AcquisitionDateTime: '20261124', AcquisitionTime: '101500' })).toEqual({
      time: 10 * 3600 + 15 * 60,
      date: null,
    });
    expect(acquisitionOf({ AcquisitionDate: '20261124', AcquisitionTime: '101500' })).toEqual({
      time: 10 * 3600 + 15 * 60,
      date: Date.UTC(2026, 10, 24) / 1000,
    });
    expect(acquisitionOf({ ContentTime: '101500' })).toBeNull();
  });

  it('knows a localizer or a projection by its image type', () => {
    expect(isProjection(['ORIGINAL', 'PRIMARY', 'LOCALIZER'])).toBe(true);
    expect(isProjection('DERIVED\\SECONDARY\\AXIAL\\CT_SOM5 MIP')).toBe(true);
    expect(isProjection(['DERIVED', 'SECONDARY', 'VOLUME RENDERING'])).toBe(true);
    expect(isProjection(['DERIVED', 'PRIMARY', 'AXIAL', 'CT_SOM5 MPR'])).toBe(false);
    expect(isProjection(['DERIVED', 'SECONDARY', 'MPR THICK'])).toBe(false);
    expect(isProjection(undefined)).toBe(false);
  });

  it("sums up a series: one frame of reference and modality or none, any projection, its acquisition's span", () => {
    const f = seriesFacts(AXIAL);
    expect(f).toMatchObject({
      images: 20,
      frameOfReferenceUID: FOR,
      modality: 'CT',
      projection: false,
    });
    expect(f.timeOfDay).toEqual([9 * 3600 + 30 * 60 + 10.25, 9 * 3600 + 30 * 60 + 29.25]);
    expect(f.dated![1] - f.dated![0]).toBeCloseTo(19, 6);
    const mixed = seriesFacts([axial(0), axial(1, { FrameOfReferenceUID: '2.25.7002' }), null]);
    expect(mixed).toMatchObject({ images: 2, frameOfReferenceUID: null });
    // One image without a date: compared by time of day only.
    expect(seriesFacts([axial(0), axial(1, { AcquisitionDate: undefined })]).dated).toBeNull();
    expect(seriesFacts([]).timeOfDay).toBeNull();
  });

  it('takes the reformats of the same acquisition, and a second reconstruction of it', () => {
    const native = seriesFacts(AXIAL);
    expect(relatedVerdict(native, seriesFacts([reformat(), reformat()]))).toEqual({
      related: true,
      reason: null,
    });
    // Written to the whole second, a little before the axial's first image.
    expect(
      relatedVerdict(native, seriesFacts([reformat({ AcquisitionTime: '093009' })])).related
    ).toBe(true);
    const bone = Array.from({ length: 20 }, (_, k) =>
      axial(k, { ImageType: ['ORIGINAL', 'PRIMARY', 'AXIAL', 'BONE'] })
    );
    expect(relatedVerdict(native, seriesFacts(bone)).related).toBe(true);
  });

  it('never takes another phase, another frame of reference or modality, a localizer, or a series without times', () => {
    const native = seriesFacts(AXIAL);
    const verdict = (over: Record<string, unknown>) =>
      relatedVerdict(native, seriesFacts([reformat(over)]));
    // The venous phase, a minute later: same patient coordinates, not the same moment.
    expect(verdict({ AcquisitionTime: '093130' })).toEqual({
      related: false,
      reason: 'acquired at another time',
    });
    // Just past the axial's last image and the margin.
    const last = 9 * 3600 + 30 * 60 + 29.25 + ACQUISITION_MARGIN_S + 0.5;
    const hhmmss = `0930${(last - 9 * 3600 - 30 * 60).toFixed(2)}`;
    expect(verdict({ AcquisitionTime: hhmmss }).reason).toBe('acquired at another time');
    // Another day at the same time.
    expect(verdict({ AcquisitionDate: '20261125' }).reason).toBe('acquired at another time');
    expect(verdict({ FrameOfReferenceUID: '2.25.7009' }).reason).toBe('another frame of reference');
    expect(verdict({ Modality: 'PT' }).reason).toBe('another modality');
    expect(verdict({ ImageType: ['ORIGINAL', 'PRIMARY', 'LOCALIZER'] }).reason).toBe(
      'a localizer or projection'
    );
    expect(verdict({ AcquisitionTime: undefined }).reason).toBe('no acquisition time');
    // A labelmap series without a frame of reference takes nothing.
    expect(
      relatedVerdict(
        seriesFacts([axial(0, { FrameOfReferenceUID: undefined })]),
        seriesFacts([reformat()])
      ).reason
    ).toBe('another frame of reference');
  });

  it('compares by time of day when either series has an image without a date', () => {
    const native = seriesFacts(AXIAL.map(i => ({ ...i, AcquisitionDate: undefined })));
    expect(
      relatedVerdict(native, seriesFacts([reformat({ AcquisitionDate: '20261125' })])).related
    ).toBe(true);
  });
});
