/**
 * Clinical-context data + visibility store for the on-image clinical-context
 * overlay (age · sex · indication).
 *
 * INDICATION SOURCE: the reason-for-exam usually lives in the RIS/HL7 order
 * (OBR-13 "patient history"), not in the DICOM study, so the primary source is
 * the PACS-AI API: POST {apiBase}/api/studydetails {studyInstanceUid} →
 * `patientHistory`. Results are cached per StudyInstanceUID for the session;
 * the overlay falls back to DICOM tags when the API has nothing (see
 * clinicalContextOverlayItem).
 *
 * AUTH + BASE URL: same idiom the deployed app-config already uses for
 * /api/me/aets — `window.PACSAI_API_BASE_URL` is stamped into app-config.js by
 * the deploy's envsubst, and the bearer token comes from
 * userAuthenticationService (falling back to the oidc sessionStorage entry,
 * which is how app-config.js itself does it before services are up).
 *
 * PHI: nothing fetched here is ever written to localStorage or logged —
 * failures log a generic message only. The only persisted value is the
 * show/hide preference.
 */

type IndicationEntry = {
  status: 'loading' | 'done' | 'error';
  indication: string | null;
};

const indicationByStudy = new Map<string, IndicationEntry>();
const listeners = new Set<() => void>();

const VISIBILITY_STORAGE_KEY = 'pacsai.clinicalContextOverlay';
let visible = readPersistedVisibility();

function readPersistedVisibility(): boolean {
  try {
    return window.localStorage.getItem(VISIBILITY_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function notify() {
  listeners.forEach(listener => {
    try {
      listener();
    } catch {
      /* a broken subscriber must not break the rest */
    }
  });
}

/** Subscribe to any store change (indication fetched, visibility toggled). */
export function subscribeClinicalContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isClinicalContextVisible(): boolean {
  return visible;
}

export function toggleClinicalContextVisibility(): boolean {
  visible = !visible;
  try {
    window.localStorage.setItem(VISIBILITY_STORAGE_KEY, visible ? 'on' : 'off');
  } catch {
    /* preference persistence is best-effort */
  }
  notify();
  return visible;
}

function getApiBaseUrl(): string | undefined {
  const base = (window as any)?.PACSAI_API_BASE_URL;
  return typeof base === 'string' && base.length > 0 ? base.replace(/\/$/, '') : undefined;
}

/** Bearer token: UserAuthenticationService first, oidc sessionStorage second. */
function getAuthorizationValue(servicesManager: any): string | undefined {
  try {
    const header = servicesManager?.services?.userAuthenticationService?.getAuthorizationHeader?.();
    if (header?.Authorization) {
      return header.Authorization;
    }
  } catch {
    /* fall through to sessionStorage */
  }
  try {
    const storageKey = Object.keys(window.sessionStorage).find(key => key.startsWith('oidc.user'));
    if (storageKey) {
      const token = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null')?.access_token;
      if (token) {
        return `Bearer ${token}`;
      }
    }
  } catch {
    /* no token available */
  }
  return undefined;
}

/**
 * Return the cached indication entry for a study, kicking off the API fetch on
 * first request. Callers re-read after a store notification.
 */
export function requestClinicalIndication(
  studyInstanceUID: string | undefined,
  servicesManager: any
): IndicationEntry | undefined {
  if (!studyInstanceUID) {
    return undefined;
  }
  const existing = indicationByStudy.get(studyInstanceUID);
  if (existing) {
    return existing;
  }

  const apiBase = getApiBaseUrl();
  if (!apiBase) {
    // No API configured (e.g. local dev against a bare PACS): permanent
    // fallback to DICOM tags, no retry churn.
    const entry: IndicationEntry = { status: 'error', indication: null };
    indicationByStudy.set(studyInstanceUID, entry);
    return entry;
  }

  const entry: IndicationEntry = { status: 'loading', indication: null };
  indicationByStudy.set(studyInstanceUID, entry);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authorization = getAuthorizationValue(servicesManager);
  if (authorization) {
    headers.Authorization = authorization;
  }

  fetch(`${apiBase}/api/studydetails`, {
    method: 'POST',
    mode: 'cors',
    headers,
    body: JSON.stringify({ studyInstanceUid: studyInstanceUID }),
  })
    .then(response => (response.ok ? response.json() : Promise.reject(response.status)))
    .then(details => {
      const history = typeof details?.patientHistory === 'string' ? details.patientHistory.trim() : '';
      indicationByStudy.set(studyInstanceUID, {
        status: 'done',
        indication: history.length > 0 ? history : null,
      });
      notify();
    })
    .catch(() => {
      // Generic only — never log study identifiers or patient data.
      console.warn('[pacsai-hp] clinical-context: studydetails fetch failed; using DICOM fallback');
      indicationByStudy.set(studyInstanceUID, { status: 'error', indication: null });
      notify();
    });

  return entry;
}

/** Test/mode-exit hook: drop cached indications (visibility pref is kept). */
export function resetClinicalContextCache(): void {
  indicationByStudy.clear();
}
