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

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: 'include' | 'same-origin' | 'omit';
    cache?: 'no-store';
  }
) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;

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
  };
}
