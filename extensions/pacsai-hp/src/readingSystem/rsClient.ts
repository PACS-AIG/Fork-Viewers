/**
 * RS-36: the reading system's API, as the viewer calls it.
 *
 * The browser never holds the API's bearer token. The viewer calls a base path
 * on its own origin (`window.PACSAI_READING_SYSTEM_API`) with the page's
 * credentials, and whatever serves that path holds the token and forwards:
 * on dev the app's proxy route (PACS-AIG/app, with the token from the
 * cluster's Secret); locally and in the end-to-end gate the harness in
 * `extensions/pacsai-hp/e2e/readingSystem/harness.mjs`. The routes are the
 * contract's (ct-analysis-system's claimengine/contract/api.py), unchanged
 * under that base:
 *
 *   GET  /studies/{uid}/report?version=published|latest
 *   GET  /studies/{uid}/versions | inbox | evidence_view?version=
 *   GET  /snapshots/{snapshotId}            (the patient key the events carry)
 *   POST /events                            (one intake event; 200, 409, 422)
 *   GET  /studies/{uid}/anatomy             (the anatomy artifact, contract 1.10)
 *   GET  /studies/{uid}/anatomy/{file}      (one of its labelmaps: NIfTI-1, gzip;
 *                                            or, 1.17, a labelmap's surfaces: gzip)
 *   GET  /studies/{uid}/refine_targets      (RS-38: the lesions a reader may refine)
 *   POST /segment                           (RS-38: one refine; 200, 409, 422, 503)
 *
 * Each document read is checked against the contract's rules for a consumer
 * (rsContract.checkDocument): this major, this viewer's mode, the artifact.
 */
import {
  RsRefused,
  checkDocument,
  type ReportVersion,
  type RsEvidenceView,
  type RsInbox,
  type RsIntakeResponse,
  type RsMode,
  type RsReport,
  type RsSnapshotDocument,
  type RsVersions,
} from './rsContract';
import type { RsIntakeEvent } from './rsEvents';
import {
  readRefineTargets,
  readSegmentAnswer,
  type IndexTriple,
  type RefineTargets,
  type SegmentAnswer,
  type SegmentRequest,
} from './refine/refineContract';
import { readAnatomy, type RsAnatomy } from './anatomy/anatomyContract';
import { SURFACES_BASENAME } from './anatomy/anatomySurfaces';

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: 'include' | 'same-origin' | 'omit';
    cache?: 'no-store';
  }
) => Promise<{
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}>;

/** A labelmap's file name under `anatomy/`, as the contract names it. */
export const LABELMAP_BASENAME = /^[0-9]{1,4}\.[a-z0-9_]{1,64}\.labels\.nii\.gz$/;
/** The largest labelmap file read (gzip): far above a thin-slice trunk's. */
export const MAX_LABELMAP_BYTES = 256 * 1024 * 1024;

/** An answer the API gave that is not a document: the HTTP status says which. */
export class RsHttpError extends Error {
  readonly status: number;
  constructor(status: number, what: string) {
    super(`${what}: HTTP ${status}`);
    this.name = 'RsHttpError';
    this.status = status;
  }
}

export interface RsClient {
  readonly base: string;
  readonly mode: RsMode;
  report(study: string, version?: ReportVersion): Promise<RsReport>;
  versions(study: string): Promise<RsVersions>;
  inbox(study: string): Promise<RsInbox>;
  evidenceView(study: string, version?: ReportVersion): Promise<RsEvidenceView>;
  snapshot(snapshotId: string): Promise<RsSnapshotDocument>;
  /** One intake event. 200, 409 and 422 are answers (intake responses); anything else throws. */
  postEvent(doc: RsIntakeEvent): Promise<RsIntakeResponse>;
  /** The study's anatomy artifact (404 when it has none). */
  anatomy(study: string): Promise<RsAnatomy>;
  /** One of its labelmaps' bytes, or a labelmap's surfaces (1.17), by its file name under `anatomy/`. */
  anatomyFile(study: string, basename: string): Promise<Uint8Array>;
  /** RS-38: the lesions a reader may refine (404 when the study has none, or the service no such route). */
  refineTargets(study: string): Promise<RefineTargets>;
  /**
   * RS-38: one refine, its answer read on the target's grid (`shape`). 200, 409,
   * 422 and 503 are answers; anything else throws.
   */
  segment(request: SegmentRequest, shape: IndexTriple): Promise<SegmentAnswer>;
}

/** The base path without a trailing slash; empty when none is configured. */
export const normalizeBase = (base: unknown): string =>
  typeof base === 'string' ? base.trim().replace(/\/+$/, '') : '';

export function createRsClient({
  base,
  mode,
  fetchFn,
}: {
  base: string;
  mode: RsMode;
  fetchFn: FetchLike;
}): RsClient {
  const root = normalizeBase(base);
  const study = (uid: string) => `/studies/${encodeURIComponent(uid)}`;

  async function read<T>(path: string, artifact: string, what: string): Promise<T> {
    const res = await fetchFn(`${root}${path}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new RsHttpError(res.status, what);
    }
    let doc: unknown;
    try {
      doc = await res.json();
    } catch (_) {
      throw new RsRefused(`The CT analysis service sent a ${what} that is not JSON.`);
    }
    return checkDocument(doc, artifact, mode) as T;
  }

  return {
    base: root,
    mode,
    report: (uid, version = 'published') =>
      read<RsReport>(`${study(uid)}/report?version=${version}`, 'report', 'report'),
    versions: uid => read<RsVersions>(`${study(uid)}/versions`, 'versions', 'version list'),
    inbox: uid => read<RsInbox>(`${study(uid)}/inbox`, 'inbox', 'inbox'),
    evidenceView: (uid, version = 'published') =>
      read<RsEvidenceView>(
        `${study(uid)}/evidence_view?version=${version}`,
        'evidence_view',
        'evidence view'
      ),
    snapshot: id =>
      read<RsSnapshotDocument>(`/snapshots/${encodeURIComponent(id)}`, 'snapshot', 'snapshot'),
    async postEvent(doc) {
      const res = await fetchFn(`${root}/events`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(doc),
      });
      if (res.status !== 200 && res.status !== 409 && res.status !== 422) {
        throw new RsHttpError(res.status, 'event');
      }
      const answer = (await res.json().catch(() => null)) as RsIntakeResponse | null;
      if (!answer || answer.artifact !== 'intake_response' || typeof answer.status !== 'string') {
        throw new RsRefused(
          'The CT analysis service answered the event with something that is not an intake response.'
        );
      }
      return answer;
    },
    async anatomy(uid) {
      const res = await fetchFn(`${root}${study(uid)}/anatomy`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new RsHttpError(res.status, 'anatomy');
      }
      let doc: unknown;
      try {
        doc = await res.json();
      } catch (_) {
        throw new RsRefused('The CT analysis service sent an anatomy document that is not JSON.');
      }
      return readAnatomy(doc, mode);
    },
    async anatomyFile(uid, basename) {
      if (!LABELMAP_BASENAME.test(basename) && !SURFACES_BASENAME.test(basename)) {
        throw new RsRefused('A labelmap was named outside the contract’s anatomy files.');
      }
      const res = await fetchFn(`${root}${study(uid)}/anatomy/${basename}`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/gzip, application/octet-stream' },
      });
      if (!res.ok) {
        throw new RsHttpError(res.status, 'labelmap');
      }
      if (typeof res.arrayBuffer !== 'function') {
        throw new RsRefused('This page cannot read a labelmap’s bytes.');
      }
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_LABELMAP_BYTES) {
        throw new RsRefused('A labelmap is larger than the viewer takes.');
      }
      return new Uint8Array(buffer);
    },
    async refineTargets(uid) {
      const res = await fetchFn(`${root}${study(uid)}/refine_targets`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new RsHttpError(res.status, 'refine targets');
      }
      let doc: unknown;
      try {
        doc = await res.json();
      } catch (_) {
        throw new RsRefused('The CT analysis service sent refine targets that are not JSON.');
      }
      return readRefineTargets(doc, mode);
    },
    async segment(request, shape) {
      const res = await fetchFn(`${root}/segment`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
      });
      if (res.status !== 200 && res.status !== 409 && res.status !== 422 && res.status !== 503) {
        throw new RsHttpError(res.status, 'refine');
      }
      const body = await res.json().catch(() => null);
      const answer = readSegmentAnswer(res.status, body, shape);
      if (!answer) {
        throw new RsRefused(
          'The CT analysis service answered the refine with something that is not a refine answer.'
        );
      }
      return answer;
    },
  };
}
