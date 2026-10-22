/**
 * pacsai (22 Oct): a TEXT content item's value as DICOMweb metadata can give it.
 * A long text value (UT) may come as a bulk data reference rather than a string
 * (dcm4chee sends one past its length threshold; a 1178-byte report text did),
 * which the DicomWeb data source gives a `retrieveBulkData` method. React cannot
 * render that object: the SR viewport threw, and with it the whole viewer route.
 */
export type BulkDataValue = {
  BulkDataURI: string;
  /** The bytes, once `retrieveBulkData` has fetched them. */
  Value?: ArrayBuffer;
  retrieveBulkData?: () => Promise<ArrayBuffer | undefined>;
};

export const isBulkDataValue = (value: unknown): value is BulkDataValue =>
  !!value && typeof value === 'object' && typeof (value as BulkDataValue).BulkDataURI === 'string';

/**
 * A fetched text value's bytes as a string: UTF-8 when they are valid UTF-8
 * (ISO_IR 192, and plain ASCII), else ISO 8859-1 (ISO_IR 100); the value's
 * trailing padding (spaces, NULs) removed.
 */
export function decodeTextValue(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('iso-8859-1').decode(bytes);
  }
  return text.replace(/[\0 ]+$/, '');
}
