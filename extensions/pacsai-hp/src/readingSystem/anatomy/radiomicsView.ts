/**
 * RS-36: the Anatomy tab's research features (contract 1.15's radiomics) as a
 * reader reads them (WeiWei, 27 Nov 2026: "Yes, send it" to the Tau case
 * session's design). Pure: the families in the registry's order, readable
 * names, units, values to about three significant digits, search and sort, and
 * the study table's CSV with its file's name. Never a finding, a measurement or
 * report content.
 *
 * The features and their settings are ct-analysis-system's
 * registry/features/radiomics_v1.yaml (main 85e2a914): pyradiomics 3.0.1 on
 * the CT resampled to 1 mm, bin width 25 HU, voxelArrayShift 1000 (Energy and
 * RootMeanSquared square x + 1000 HU).
 */

/** pyradiomics' feature classes, in the order the tab lists them, with their titles. */
export const RADIOMICS_FAMILIES: ReadonlyArray<readonly [string, string]> = [
  ['firstorder', 'First order'],
  ['shape', 'Shape'],
  ['glcm', 'GLCM (co-occurrence)'],
  ['glrlm', 'GLRLM (run length)'],
  ['glszm', 'GLSZM (size zone)'],
  ['gldm', 'GLDM (dependence)'],
  ['ngtdm', 'NGTDM (neighbourhood tone difference)'],
];

/** A family's title (a class the tab does not know keeps its own name). */
export const familyTitle = (cls: string): string =>
  RADIOMICS_FAMILIES.find(([c]) => c === cls)?.[1] ?? cls;

/** The first-order features a structure's section shows before "Show all". */
export const KEY_FIRST_ORDER: readonly string[] = [
  'Median',
  'Mean',
  'InterquartileRange',
  '10Percentile',
  '90Percentile',
];

/** Names that splitting the words would not make readable. */
const NAMES: Record<string, string> = {
  '10Percentile': '10th percentile',
  '90Percentile': '90th percentile',
  Id: 'Inverse difference',
  Idm: 'Inverse difference moment',
  Idmn: 'Inverse difference moment normalized',
  Idn: 'Inverse difference normalized',
  Imc1: 'Informational measure of correlation 1',
  Imc2: 'Informational measure of correlation 2',
  MCC: 'Maximal correlation coefficient',
  SumSquares: 'Sum of squares',
  SurfaceVolumeRatio: 'Surface to volume ratio',
  Maximum3DDiameter: 'Maximum 3D diameter',
  Maximum2DDiameterSlice: 'Maximum 2D diameter (slice)',
  Maximum2DDiameterColumn: 'Maximum 2D diameter (column)',
  Maximum2DDiameterRow: 'Maximum 2D diameter (row)',
};

/** A feature's readable name: pyradiomics' CamelCase as words ("Least axis length"). */
export function featureLabel(name: string): string {
  const known = NAMES[name];
  if (known) {
    return known;
  }
  const words = name
    .replace(/NonUniformity/g, 'Non-uniformity')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean);
  return words.map((w, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
}

/** First-order features in HU (an intensity, or a spread of them). */
const HU_FEATURES = new Set([
  '10Percentile',
  '90Percentile',
  'InterquartileRange',
  'Maximum',
  'Mean',
  'MeanAbsoluteDeviation',
  'Median',
  'Minimum',
  'Range',
  'RobustMeanAbsoluteDeviation',
  'RootMeanSquared',
]);
/** First-order features in HU². */
const HU2_FEATURES = new Set(['Variance', 'Energy']);
/** First-order features of HU + 1000 (the registry's voxelArrayShift). */
const SHIFTED = new Set(['Energy', 'RootMeanSquared']);
const SHAPE_UNITS: Record<string, string> = {
  LeastAxisLength: 'mm',
  MajorAxisLength: 'mm',
  MinorAxisLength: 'mm',
  Maximum3DDiameter: 'mm',
  Maximum2DDiameterSlice: 'mm',
  Maximum2DDiameterColumn: 'mm',
  Maximum2DDiameterRow: 'mm',
  SurfaceArea: 'mm²',
  MeshVolume: 'mm³',
  VoxelVolume: 'mm³',
  SurfaceVolumeRatio: 'mm⁻¹',
};

/** A feature's unit, or null where it has none (every texture feature, and the shape ratios). */
export function featureUnit(cls: string, name: string): string | null {
  if (cls === 'firstorder') {
    return HU_FEATURES.has(name) ? 'HU' : HU2_FEATURES.has(name) ? 'HU²' : null;
  }
  if (cls === 'shape') {
    return SHAPE_UNITS[name] ?? null;
  }
  return null;
}

/** What a feature's value is of, when that is not the CT's own HU. */
export function featureNote(cls: string, name: string): string | null {
  return cls === 'firstorder' && SHIFTED.has(name)
    ? 'of HU + 1000 (the registry’s voxelArrayShift)'
    : null;
}

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/**
 * A feature's value as the tab shows it: about three significant digits;
 * whole numbers from 1,000 to 9,999; "1.23 × 10⁴" from 10,000 or under 0.001;
 * "—" for none.
 */
export function formatFeature(v: number | null): string {
  if (v === null || !Number.isFinite(v)) {
    return '—';
  }
  if (v === 0) {
    return '0';
  }
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) {
    const [mantissa, exponent] = v.toExponential(2).split('e');
    const power = String(Number(exponent))
      .split('')
      .map(c => SUPERSCRIPT[c] ?? c)
      .join('');
    return `${mantissa} × 10${power}`;
  }
  if (a >= 1000) {
    return Math.round(v).toLocaleString('en-US');
  }
  const r = Number(v.toPrecision(3));
  return Math.abs(r) >= 1000 ? r.toLocaleString('en-US') : String(r);
}

/** A feature value's tooltip: the unrounded value with its unit, or why there is none. */
export function exactValue(v: number | null, unit: string | null, note: string | null): string {
  if (v === null || !Number.isFinite(v)) {
    return 'No finite value.';
  }
  return `${String(v)}${unit ? ` ${unit}` : ''}${note ? `, ${note}` : ''}`;
}

/** One feature as the tab lists it. */
export interface RadiomicsFeature {
  /** pyradiomics' key, `<class>_<Feature>`. */
  key: string;
  cls: string;
  /** pyradiomics' feature name. */
  name: string;
  label: string;
  unit: string | null;
  note: string | null;
}

export const featureOf = (cls: string, name: string): RadiomicsFeature => ({
  key: `${cls}_${name}`,
  cls,
  name,
  label: featureLabel(name),
  unit: featureUnit(cls, name),
  note: featureNote(cls, name),
});

/** Whether a feature answers a search: its readable name, pyradiomics' name or key. */
export function featureMatches(f: RadiomicsFeature, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q);
}

/** How many of a structure's features have a finite value. */
export function finiteCount(groups: Array<{ features: Array<[string, number | null]> }>): number {
  return groups.reduce(
    (n, g) => n + g.features.filter(([, v]) => v !== null && Number.isFinite(v)).length,
    0
  );
}

/** The study table's input: one structure with computed research features. */
export interface RadiomicsColumnInput {
  key: string;
  name: string;
  featureSet: string;
  engine: string | null;
  groups: Array<{ cls: string; features: Array<[string, number | null]> }>;
}

export interface RadiomicsTable {
  families: Array<{ cls: string; title: string; features: RadiomicsFeature[] }>;
  /** One per structure: its key, its column's name (unique) and its values by feature key. */
  columns: Array<{ key: string; name: string; values: Map<string, number | null> }>;
  featureSet: string;
  engine: string | null;
}

/**
 * The study table: every feature any structure has, by family in the
 * registry's order (each family's features as the first structure to have
 * them lists them), and one column per structure.
 */
export function radiomicsTable(inputs: RadiomicsColumnInput[]): RadiomicsTable {
  const byFamily = new Map<string, Map<string, RadiomicsFeature>>();
  const columns: RadiomicsTable['columns'] = [];
  const seen = new Map<string, number>();
  for (const s of inputs) {
    const values = new Map<string, number | null>();
    for (const g of s.groups) {
      if (!byFamily.has(g.cls)) {
        byFamily.set(g.cls, new Map());
      }
      const fam = byFamily.get(g.cls)!;
      for (const [name, value] of g.features) {
        const f = fam.get(name) ?? featureOf(g.cls, name);
        fam.set(name, f);
        values.set(f.key, value);
      }
    }
    const n = (seen.get(s.name) ?? 0) + 1;
    seen.set(s.name, n);
    columns.push({ key: s.key, name: n > 1 ? `${s.name} (${n})` : s.name, values });
  }
  const known = RADIOMICS_FAMILIES.map(([cls]) => cls);
  const order = [
    ...known.filter(cls => byFamily.has(cls)),
    ...[...byFamily.keys()].filter(cls => !known.includes(cls)).sort(),
  ];
  return {
    families: order.map(cls => ({
      cls,
      title: familyTitle(cls),
      features: [...byFamily.get(cls)!.values()],
    })),
    columns,
    featureSet: inputs[0]?.featureSet ?? 'radiomics',
    engine: inputs[0]?.engine ?? null,
  };
}

/** How the study table is sorted: by the feature's name, or by one column's values; none keeps the registry's order. */
export type RadiomicsSort = { by: 'name' | string; dir: 1 | -1 } | null;

/** The next sort after a click on a header: ascending, descending, then none. */
export function nextSort(current: RadiomicsSort, by: string): RadiomicsSort {
  if (!current || current.by !== by) {
    return { by, dir: 1 };
  }
  return current.dir === 1 ? { by, dir: -1 } : null;
}

/** A family's features in the table's sort (a column's nulls last, whichever way). */
export function sortFeatures(
  features: RadiomicsFeature[],
  sort: RadiomicsSort,
  columns: RadiomicsTable['columns']
): RadiomicsFeature[] {
  if (!sort) {
    return features;
  }
  if (sort.by === 'name') {
    return [...features].sort((a, b) => sort.dir * a.label.localeCompare(b.label));
  }
  const col = columns.find(c => c.key === sort.by);
  if (!col) {
    return features;
  }
  const valueOf = (f: RadiomicsFeature) => {
    const v = col.values.get(f.key);
    return v === null || v === undefined || !Number.isFinite(v) ? null : v;
  };
  return [...features].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va === null || vb === null) {
      return va === vb ? 0 : va === null ? 1 : -1;
    }
    return sort.dir * (va - vb);
  });
}

/** The CSV's first line: what the file is for, with no comma or semicolon to split it. */
export const CSV_NOTE = '# Research use only: not part of the report.';

const csvCell = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * The study table as CSV: its note, then family, feature key, name, unit and
 * one column per structure; unrounded values, empty for none.
 */
export function radiomicsCsv(table: RadiomicsTable): string {
  const lines = [
    `${CSV_NOTE} ${table.featureSet}${table.engine ? ` by ${table.engine}` : ''}`,
    ['family', 'feature', 'name', 'unit', ...table.columns.map(c => c.name)].map(csvCell).join(','),
  ];
  for (const fam of table.families) {
    for (const f of fam.features) {
      lines.push(
        [
          fam.cls,
          f.key,
          f.label,
          f.unit ?? '',
          ...table.columns.map(c => {
            const v = c.values.get(f.key);
            return v === null || v === undefined || !Number.isFinite(v) ? '' : String(v);
          }),
        ]
          .map(csvCell)
          .join(',')
      );
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The study's name for a file: the CT side's own study ref, "study-" and the
 * first 12 hex of the UID's SHA-256 (claimengine/serve/bases.py), so no file
 * ever carries the UID. Without Web Crypto, the viewer's own ref, made safe for
 * a file name.
 */
export async function studyFileRef(
  uid: string,
  options: { subtle?: SubtleCrypto | null; fallback?: (uid: string) => string } = {}
): Promise<string> {
  const subtle =
    options.subtle === undefined ? (globalThis.crypto?.subtle ?? null) : options.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      // A UID is ASCII (digits and dots), so its bytes are its characters' codes.
      const bytes =
        typeof TextEncoder === 'function'
          ? new TextEncoder().encode(uid)
          : Uint8Array.from(uid, c => c.charCodeAt(0) & 0xff);
      const digest = await subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(digest).slice(0, 6))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      return `study-${hex}`;
    } catch (_) {
      // fall through to the viewer's own ref
    }
  }
  const ref = options.fallback ? options.fallback(uid) : 'study';
  return ref.replace(/[^A-Za-z0-9_-]+/g, '-');
}
