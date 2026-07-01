/**
 * Split a diffusion (DWI) MR series into one group per b-value plus a separate
 * ADC group, so each is its own selectable displaySet/thumbnail instead of one
 * mixed stack the reader has to cine through to reach the high-b image / ADC.
 *
 * Used by the default stack SOP-class handler (getDisplaySetsFromSeries): it is
 * applied ONLY to the leftover "stackable" MR instances, and only actually
 * splits when it can key EVERY instance into >= 2 distinct groups — otherwise it
 * returns null and the caller falls back to the normal single displaySet (so
 * non-diffusion MR and anything we can't confidently key is unchanged).
 *
 * b-value source (best effort, vendor-dependent — tune against a live case):
 *   - Standard  DiffusionBValue          (0018,9087)
 *   - Siemens   (0019,100C)
 *   - GE        (0043,1039)  [first element; strips the +1e9 direction offset]
 *   - Philips   (2001,1003) / (2005,1413)
 * ADC is detected from ImageType (0008,0008) containing 'ADC' (covers eADC), or
 * an 'ADC' token in the SeriesDescription.
 */

export interface DwiGroup {
  key: string;
  /** Numeric b-value, or undefined for the ADC group. */
  bValue?: number;
  isADC: boolean;
  /** Suffix appended to the series description, e.g. "b1000" or "ADC". */
  labelSuffix: string;
  instances: any[];
}

/** Pull a usable primitive out of a DICOM value (scalar, array, or {Value:[...]}). */
function firstDefined(value: any): any {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.length ? firstDefined(value[0]) : undefined;
  }
  // DICOMweb JSON element form { vr, Value: [...] }
  if (typeof value === 'object' && Array.isArray(value.Value)) {
    return value.Value.length ? firstDefined(value.Value[0]) : undefined;
  }
  return value;
}

function toNumber(value: any): number | undefined {
  const v = firstDefined(value);
  if (v === undefined) {
    return undefined;
  }
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

/** Read the first present tag among keyword and raw-hex aliases. */
function readTag(instance: any, keys: string[]): any {
  for (const k of keys) {
    const v = instance?.[k];
    if (v !== undefined && v !== null && v !== '') {
      return v;
    }
  }
  return undefined;
}

function getBValue(instance: any): number | undefined {
  // Standard tag first.
  const std = toNumber(readTag(instance, ['DiffusionBValue', '00189087']));
  if (std !== undefined) {
    return Math.round(std);
  }
  // Siemens private (0019,100C) — DS/IS string.
  const siemens = toNumber(readTag(instance, ['0019100C', '00191100C']));
  if (siemens !== undefined) {
    return Math.round(siemens);
  }
  // GE private (0043,1039) — first element; a direction offset of +1e9 is added
  // for some sequences, so strip it with a modulo.
  const geRaw = toNumber(readTag(instance, ['00431039']));
  if (geRaw !== undefined) {
    return Math.round(geRaw % 1_000_000_000);
  }
  // Philips private (2001,1003) FD, or (2005,1413).
  const philips = toNumber(readTag(instance, ['20011003', '20051413']));
  if (philips !== undefined) {
    return Math.round(philips);
  }
  return undefined;
}

function isADCInstance(instance: any): boolean {
  const imageType = readTag(instance, ['ImageType', '00080008']);
  const typeStr = Array.isArray(imageType) ? imageType.join('\\') : String(imageType ?? '');
  // Matches ADC and eADC in ImageType, or an ADC token in the description.
  return /ADC/i.test(typeStr) || /\badc\b/i.test(String(instance?.SeriesDescription ?? ''));
}

/**
 * Diagnostic for a series that LOOKS like diffusion but did not split — dumps the
 * raw candidate b-value tags + ImageType of a sample instance and the distinct
 * b-values/ADC seen, so we can confirm which tag carries the b-value on a given
 * scanner (or that it's absent from the fetched metadata) and tune the fallbacks.
 */
export function describeDwiDetection(instances: any[]): Record<string, unknown> {
  const sample = instances?.[0] ?? {};
  const bValues = new Set<number>();
  let adcCount = 0;
  let unkeyed = 0;
  (instances ?? []).forEach(inst => {
    if (isADCInstance(inst)) {
      adcCount += 1;
      return;
    }
    const b = getBValue(inst);
    if (b === undefined) {
      unkeyed += 1;
    } else {
      bValues.add(b);
    }
  });
  return {
    count: instances?.length ?? 0,
    distinctBValues: Array.from(bValues).sort((a, b) => a - b),
    adcCount,
    unkeyedCount: unkeyed,
    raw: {
      DiffusionBValue: sample.DiffusionBValue ?? sample['00189087'],
      siemens_0019100C: sample['0019100C'] ?? sample['00191100C'],
      ge_00431039: sample['00431039'],
      philips_20011003: sample['20011003'],
      philips_20051413: sample['20051413'],
      ImageType: sample.ImageType ?? sample['00080008'],
    },
  };
}

/**
 * @returns groups (>=2) sorted b0..bN ascending with ADC last, or null when the
 *   series should not be split (not MR, unkeyable instances, or <2 groups).
 */
export default function splitDwiInstances(instances: any[]): DwiGroup[] | null {
  if (!instances || instances.length < 2) {
    return null;
  }
  // Diffusion is MR-only; bail on anything else so no other modality is touched.
  if (instances[0]?.Modality !== 'MR') {
    return null;
  }

  const groups = new Map<string, DwiGroup>();

  for (const instance of instances) {
    let key: string;
    let bValue: number | undefined;
    let isADC = false;
    let labelSuffix: string;

    if (isADCInstance(instance)) {
      key = 'adc';
      isADC = true;
      labelSuffix = 'ADC';
    } else {
      bValue = getBValue(instance);
      if (bValue === undefined) {
        // An instance we can't key → don't split (avoid dropping/duplicating).
        return null;
      }
      key = `b${bValue}`;
      labelSuffix = `b${bValue}`;
    }

    let group = groups.get(key);
    if (!group) {
      group = { key, bValue, isADC, labelSuffix, instances: [] };
      groups.set(key, group);
    }
    group.instances.push(instance);
  }

  if (groups.size < 2) {
    return null;
  }

  // b0 -> bN ascending, ADC last.
  return Array.from(groups.values()).sort((a, b) => {
    if (a.isADC !== b.isADC) {
      return a.isADC ? 1 : -1;
    }
    return (a.bValue ?? 0) - (b.bValue ?? 0);
  });
}
