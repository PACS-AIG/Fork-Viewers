import { classes } from '@ohif/core';
import getImageColor from '../utils/getImageColor';
import getImagePlane from '../utils/getImagePlane';

const { ImageSet } = classes;

/**
 * "All-in-one" composite display sets.
 *
 * A radiologist-convenience view: every diagnostic image series of a study,
 * concatenated into ONE scrollable stack (grouped by plane: axial → coronal →
 * sagittal, SeriesNumber order within each plane), so the whole study can be
 * reviewed in a single scroll instead of opening each series. The plane grouping
 * also lets the current|prior all-in-one compare align planes (see the sync).
 *
 * The composite is a THIN WRAPPER, not fake data: its `images` are the REAL
 * instance objects of the source series — each already carrying its own `.imageId`
 * (assigned at store time), so every image keeps its genuine imageId. That means
 * the same cornerstone cache entries (no duplicated pixels), and tools key on the
 * same imageId as the native series view. Only the wrapping SeriesInstanceUID /
 * displaySetInstanceUID are synthetic.
 *
 * Built per loaded study by `loadRelevantPriors` (current + priors + siblings) so a
 * protocol can hang the current study's all-in-one beside the prior's. Matched in
 * protocols via the `pacsaiAllInOne` custom attribute (see index.tsx); the study's
 * REAL StudyInstanceUID means the existing `pacsaiRole` attribute classifies the
 * composite current/prior automatically.
 */

/** Value the `pacsaiAllInOne` attribute returns for the composite (vs 'series'). */
export const ALL_IN_ONE_MARKER = 'allinone';

// SeriesNumber given to the composite so it sorts AFTER the real series in the
// study browser's series list (a high sentinel, well above any real SeriesNumber).
const ALL_IN_ONE_SERIES_NUMBER = 99999;

// Non-image / non-stack modalities that must never enter the scroll-through:
// structured reports, segmentations, presentation/key-object state, RT objects,
// registration, dose/encapsulated docs, audio. (US is excluded separately — it is
// an image modality, but cine/static ultrasound doesn't belong in a CT/MR scroll.)
const NON_IMAGE_MODALITIES = new Set([
  'SR', 'SEG', 'PR', 'KO', 'RTSTRUCT', 'RTPLAN', 'RTDOSE', 'RTRECORD', 'RWV',
  'REG', 'FID', 'PLAN', 'DOC', 'AU', 'PMAP',
]);

// Non-diagnostic series dropped by SeriesDescription: scouts/topograms/localizers,
// CTA bolus-tracking / monitoring, scanner patient-protocol / dose-report sheets.
const NON_DIAGNOSTIC_RE =
  /(topo|scout|localizer|localiser|monitoring|bolus|patient\s*protocol|dose\s*report)/i;

/**
 * Eligibility for the all-in-one scroll. "Drop junk" policy (rad's call): keep every
 * diagnostic image series — INCLUDING derived reformats / MIPs — but drop:
 *   - ultrasound (US) and non-image objects (SR/SEG/PR/KO/RT/…);
 *   - scouts / localizers / monitoring / protocol & dose sheets (by description);
 *   - confirmed COLOR series (perfusion maps, 3D-spin, RAPID summary — derived, and
 *     they trip cornerstone's RGB render path);
 *   - the 1-image junk series paired with CT/MR reformats. A lone CR/DX/MG/XA image
 *     IS the diagnostic projection, so single-image sets are KEPT for those modalities.
 */
function isEligible(ds: any): boolean {
  if (!ds || ds.isAllInOne || ds.unsupported) {
    return false;
  }
  // SEG / RTSTRUCT / parametric-map overlays.
  if (ds.isDerivedDisplaySet || ds.isOverlayDisplaySet) {
    return false;
  }
  const images = ds.images ?? ds.instances ?? [];
  if (!images.length) {
    return false;
  }
  const mod = String(ds.Modality ?? '').toUpperCase();
  if (mod === 'US' || NON_IMAGE_MODALITIES.has(mod)) {
    return false;
  }
  if (NON_DIAGNOSTIC_RE.test(String(ds.SeriesDescription ?? ''))) {
    return false;
  }
  const frames = ds.numImageFrames ?? images.length;
  if ((mod === 'CT' || mod === 'MR') && frames <= 1) {
    return false; // 1-image junk paired with cross-sectional reformats
  }
  if (getImageColor(ds) === 'rgb') {
    return false; // derived color (perfusion maps / 3D-spin / RAPID summary)
  }
  return true;
}

// Plane group order for the scroll-through: axial, then coronal, then sagittal, then
// anything whose plane can't be determined (kept last, in series order).
const PLANE_ORDER: Record<string, number> = { axial: 0, coronal: 1, sagittal: 2 };
function planeRank(plane: string | undefined): number {
  return plane && plane in PLANE_ORDER ? PLANE_ORDER[plane] : 3;
}

/** SeriesNumber sort (asc), tie-broken by SeriesTime then SeriesInstanceUID. */
function bySeries(a: any, b: any): number {
  const an = Number(a?.SeriesNumber ?? 0);
  const bn = Number(b?.SeriesNumber ?? 0);
  if (an !== bn) {
    return an - bn;
  }
  const at = String(a?.SeriesTime ?? '');
  const bt = String(b?.SeriesTime ?? '');
  if (at !== bt) {
    return at < bt ? -1 : 1;
  }
  return String(a?.SeriesInstanceUID ?? '').localeCompare(String(b?.SeriesInstanceUID ?? ''));
}

/** Deterministic composite UID for a study, so a rebuild replaces (never duplicates). */
function compositeUID(studyUID: string): string {
  return `${studyUID}.pacsai-allinone`;
}

/** Outcome of a per-study build, so callers know whether to re-hang. */
type BuildStatus = 'created' | 'updated' | 'unchanged' | 'skipped';

/**
 * Build (or refresh) the all-in-one composite for one study from its eligible
 * source display sets. Idempotent: 'unchanged' when an up-to-date composite already
 * exists; 'updated' (grown IN PLACE — see below) when more source series have streamed
 * in since last build (tracked via `allInOneSourceCount`); 'created' on first build;
 * 'skipped' when the study has no eligible series (e.g. a pure-US study).
 */
function buildForStudy(
  studyUID: string,
  sources: any[],
  displaySetService: any,
  dataSource: any,
  cornerstoneCacheService: any
): BuildStatus {
  // Group by plane (axial→coronal→sagittal), then SeriesNumber within each plane, so
  // the composite scrolls one plane at a time. This is what lets the current|prior
  // compare align planes: both stacks lay their planes out in the same contiguous
  // order, so the within-plane sync keeps axial opposite axial, etc. (a plain
  // SeriesNumber concatenation interleaves planes differently per study — the prior's
  // axials can sit where the current's coronals are). Plane is computed ONCE per source
  // here (not inside the comparator, which runs O(n log n) times); siblings = all
  // sources, needed to disambiguate oblique coronal/sagittal reformats.
  const planeRankOf = new Map<any, number>();
  for (const ds of sources) {
    planeRankOf.set(ds, planeRank(getImagePlane(ds, sources)));
  }
  const sorted = [...sources].sort((a, b) => {
    const pr = (planeRankOf.get(a) ?? 3) - (planeRankOf.get(b) ?? 3);
    return pr !== 0 ? pr : bySeries(a, b);
  });
  // Concatenate the REAL instances in plane-then-series order; each source's images are
  // already InstanceNumber-sorted by its SOP class handler, so we preserve that order.
  const instances = sorted.flatMap(ds => Array.from(ds.images ?? ds.instances ?? []));
  if (!instances.length) {
    return 'skipped';
  }

  const uid = compositeUID(studyUID);
  const existing = displaySetService.getDisplaySetByUID(uid);
  if (existing) {
    if (existing.allInOneSourceCount === instances.length) {
      return 'unchanged'; // up to date — nothing streamed in since last build
    }
    // More series streamed in — GROW IN PLACE. Do NOT delete + re-add: that blanks the
    // pane whenever the all-in-one is on screen as a study streams in (always the case
    // in "all-in-one only" mode, where it leads). Mutate the SAME displaySet object the
    // viewport holds — its `images` array stays mutable even though the property is
    // read-only — then refresh imageIds/count, drop the stale cornerstone stack-imageId
    // cache, and invalidate so a live viewport recomputes its stack in place.
    existing.images.length = 0;
    existing.images.push(...instances);
    if (existing.instances && existing.instances !== existing.images) {
      existing.instances.length = 0;
      existing.instances.push(...instances);
    }
    existing.instance = instances[0];
    existing.imageIds = dataSource.getImageIdsForDisplaySet(existing);
    existing.numImageFrames = existing.imageIds.length;
    existing.allInOneSourceCount = instances.length;
    existing.SeriesDescription = `All-in-one (${sorted.length} series)`;
    cornerstoneCacheService?.stackImageIds?.delete?.(uid);
    displaySetService.setDisplaySetMetadataInvalidated?.(uid, true);
    return 'updated';
  }

  const first: any = instances[0];
  const imageSet: any = new ImageSet(instances);
  // Resolve imageIds through the data source so multi-frame instances expand into
  // per-frame imageIds correctly, and thumbnails/prefetch have them immediately (the
  // stack render path would otherwise set them lazily on first view).
  const imageIds = dataSource.getImageIdsForDisplaySet(imageSet);
  imageSet.setAttributes({
    displaySetInstanceUID: uid,
    SeriesInstanceUID: uid,
    StudyInstanceUID: studyUID,
    SeriesDate: first.SeriesDate,
    SeriesTime: first.SeriesTime,
    SeriesNumber: ALL_IN_ONE_SERIES_NUMBER,
    Modality: first.Modality,
    SOPClassUID: first.SOPClassUID,
    SOPClassHandlerId: '@ohif/extension-default.sopClassHandlerModule.stack',
    SeriesDescription: `All-in-one (${sorted.length} series)`,
    numImageFrames: imageIds.length,
    // Mixed geometry/modality => stack, never a volume. (The all-in-one stage also
    // forces viewportType 'stack', so this is belt-and-suspenders.)
    isReconstructable: false,
    // Marker read by the `pacsaiAllInOne` attribute + the refresh check above.
    isAllInOne: true,
    allInOneSourceCount: instances.length,
    // FALSE so the tracked study-browser panel does not treat this background-built
    // set as a user "jump-to" (which would self-scroll the panel + auto-expand it).
    madeInClient: false,
  });
  imageSet.imageIds = imageIds;
  displaySetService.addDisplaySets(imageSet);
  return 'created';
}

/**
 * Build/refresh the all-in-one composite for EVERY loaded study (current, priors,
 * siblings). Call before re-hanging so the all-in-one stage can match the current
 * study's composite beside the prior's. Cheap + idempotent — safe to call on each
 * re-hang and from the DISPLAY_SETS_ADDED auto-refresh.
 *
 * Returns how many composites were newly CREATED vs grown (UPDATED) this pass, so the
 * auto-refresh can re-hang only when a composite first appears (its stage needs
 * enabling) and stay silent when one merely grew (stage already enabled).
 */
export function syncAllInOneDisplaySets({
  servicesManager,
  extensionManager,
}: withAppTypes): { created: number; updated: number } {
  const result = { created: 0, updated: 0 };
  const { displaySetService, cornerstoneCacheService } = servicesManager?.services ?? {};
  const [dataSource] = extensionManager?.getActiveDataSource?.() ?? [];
  if (!displaySetService || typeof dataSource?.getImageIdsForDisplaySet !== 'function') {
    return result;
  }

  const byStudy = new Map<string, any[]>();
  for (const ds of displaySetService.getActiveDisplaySets()) {
    if (!isEligible(ds)) {
      continue;
    }
    const uid = ds.StudyInstanceUID;
    if (!uid) {
      continue;
    }
    const list = byStudy.get(uid);
    if (list) {
      list.push(ds);
    } else {
      byStudy.set(uid, [ds]);
    }
  }

  byStudy.forEach((sources, studyUID) => {
    try {
      const status = buildForStudy(studyUID, sources, displaySetService, dataSource, cornerstoneCacheService);
      if (status === 'created') {
        result.created++;
      } else if (status === 'updated') {
        result.updated++;
      }
    } catch (error) {
      console.warn('[pacsai-hp] failed to build all-in-one for study', studyUID, error);
    }
  });

  return result;
}

export default syncAllInOneDisplaySets;
