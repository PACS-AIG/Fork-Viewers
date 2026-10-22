/**
 * 22 Oct (prod): a Basic Text SR whose report text (UT, 1178 bytes) the archive's
 * metadata sent as a bulk data reference. The DicomWeb data source gives such a
 * value a `retrieveBulkData` method, and the SR viewport rendered the object as
 * the item's text: React error #31, which took the whole viewer route down. The
 * content item (cornerstone-dicom-sr's OHIFCornerstoneSRContentItem, a fork-core
 * change tested here as trackingPrompts.test.tsx tests measurement-tracking's)
 * now fetches such a text once and shows it; a placeholder until then, or if it
 * cannot be fetched.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { TextDecoder, TextEncoder } from 'util';

Object.assign(globalThis, { TextDecoder, TextEncoder });

jest.mock('@ohif/core', () => ({
  utils: { formatPN: (n: string) => n, formatDate: (d: string) => d, formatTime: (t: string) => t },
}));
// The real module loads @cornerstonejs/adapters; the content item needs one code.
jest.mock('../../../cornerstone-dicom-sr/src/enums', () => ({
  CodeNameCodeSequenceValues: { Finding: '121071' },
}));

// eslint-disable-next-line import/first
import { OHIFCornerstoneSRContainer } from '../../../cornerstone-dicom-sr/src/components/OHIFCornerstoneSRContainer';
// eslint-disable-next-line import/first
import formatContentItemValue from '../../../cornerstone-dicom-sr/src/utils/formatContentItem';

const IMPRESSION = { CodeValue: '121073', CodeMeaning: 'Impression' };
const report = (TextValue: unknown) => ({
  ValueType: 'CONTAINER',
  ContinuityOfContent: 'SEPARATE',
  ConceptNameCodeSequence: { CodeValue: '18748-4', CodeMeaning: 'Diagnostic Imaging Report' },
  ContentSequence: [{ ValueType: 'TEXT', ConceptNameCodeSequence: IMPRESSION, TextValue }],
});
const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const bulk = (fields: Record<string, unknown>) => ({
  BulkDataURI: 'https://arc.example/bulk/1',
  ...fields,
});
// Synthetic text: no patient.
const TEXT = 'Chest radiograph: no acute cardiopulmonary process.';

describe('an SR text sent as a bulk data reference', () => {
  it('is fetched once and shown, never rendered as an object', async () => {
    const retrieveBulkData = jest.fn(async () => bytes(`${TEXT} `));
    // The same metadata object across renders, as the viewport has it.
    const sr = report(bulk({ retrieveBulkData }));
    const { rerender } = render(<OHIFCornerstoneSRContainer container={sr} />);
    expect(screen.getByText('[loading…]')).toBeTruthy();
    expect(await screen.findByText(TEXT)).toBeTruthy();
    rerender(<OHIFCornerstoneSRContainer container={sr} />);
    expect(screen.getByText(TEXT)).toBeTruthy();
    expect(retrieveBulkData).toHaveBeenCalledTimes(1);
  });

  it('ISO_IR 100 (Latin-1) bytes read right', async () => {
    const latin1 = new Uint8Array([
      0x52, 0xe9, 0xe9, 0x76, 0x61, 0x6c, 0x75, 0x61, 0x74, 0x69, 0x6f, 0x6e,
    ]).buffer;
    render(
      <OHIFCornerstoneSRContainer
        container={report(bulk({ retrieveBulkData: async () => latin1 }))}
      />
    );
    expect(await screen.findByText('Réévaluation')).toBeTruthy();
  });

  it('already fetched (its Value set): shown without a fetch', async () => {
    const retrieveBulkData = jest.fn();
    render(
      <OHIFCornerstoneSRContainer
        container={report(bulk({ Value: bytes(TEXT), retrieveBulkData }))}
      />
    );
    expect(await screen.findByText(TEXT)).toBeTruthy();
    expect(retrieveBulkData).not.toHaveBeenCalled();
  });

  it('a fetch that fails, or no way to fetch: a placeholder, and the report still shows', async () => {
    render(
      <OHIFCornerstoneSRContainer
        container={report(bulk({ retrieveBulkData: () => Promise.reject(new Error('404')) }))}
      />
    );
    expect(await screen.findByText('[not available]')).toBeTruthy();
    expect(screen.getByText(/Diagnostic Imaging Report/)).toBeTruthy();
    render(<OHIFCornerstoneSRContainer container={report(bulk({}))} />);
    await waitFor(() => expect(screen.getAllByText('[not available]')).toHaveLength(2));
  });

  it('a text sent inline is shown as before, and the formatter never returns an object', () => {
    render(<OHIFCornerstoneSRContainer container={report(TEXT)} />);
    expect(screen.getByText(TEXT)).toBeTruthy();
    expect(formatContentItemValue({ ValueType: 'TEXT', TextValue: TEXT })).toBe(TEXT);
    expect(formatContentItemValue({ ValueType: 'TEXT', TextValue: bulk({}) })).toBeUndefined();
  });
});
