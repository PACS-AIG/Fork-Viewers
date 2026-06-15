import { cache, eventTarget, EVENTS, imageLoadPoolManager, imageLoader } from '@cornerstonejs/core';
import RequestType from '@cornerstonejs/core/enums/RequestType';

/**
 * Auto-retry for transient image-load failures.
 *
 * On an imperfect connection (VPN / weak wifi) individual frame fetches die with
 * `net::ERR_CONNECTION_RESET` (or a timeout / 5xx). cs3D fires IMAGE_LOAD_FAILED
 * and then simply moves on — the request pool's `startAgain` loop advances to the
 * NEXT queued image, it does not re-attempt the failed one. So a stack fill (the
 * background prefetcher, or stackContextPrefetch) strands on the last slice or two
 * and the loading indicator sticks at e.g. 98% (99/101) until a full reload.
 *
 * This listener re-enqueues a failed imageId through the same request pool, after a
 * short exponential backoff, capped at MAX_RETRIES attempts per imageId:
 *   - TRANSIENT errors only (no/zero HTTP status, 408/429, or 5xx) are retried;
 *     a genuine 4xx (404/410 — frame truly absent) is NOT, so we don't hammer the
 *     server for something that will never arrive. When the status can't be
 *     determined (a connection reset usually carries none) we treat it as transient
 *     and retry — the attempt cap bounds any misclassification.
 *   - attempts are tracked per imageId and CLEARED on a successful IMAGE_LOADED, so
 *     a later independent load of the same image (e.g. reopening the study) starts
 *     fresh.
 *
 * Retries go through the Prefetch pool bucket (a separate maxNumRequests bucket from
 * Interaction — see init.tsx), so re-attempts never compete with the user's active
 * scroll/interaction loads. The dominant symptom is background fill stalling, which
 * is itself prefetch; a foreground slice that failed lands in cache on retry and is
 * shown when the user scrolls back to it.
 */

const REQUEST_TYPE = RequestType.Prefetch;
const MAX_RETRIES = 3;
// Backoff per attempt number (1-based): 1s, 2s, 4s.
const BACKOFF_MS = [1000, 2000, 4000];

// Pull an HTTP status out of the various error shapes cs3D / the dicom image loader
// reject with (the shape is inconsistent — sometimes the raw xhr, sometimes a
// wrapper, sometimes a bare Error/string), without throwing on any of them.
function statusOf(error: any): number | undefined {
  const status =
    error?.status ??
    error?.request?.status ??
    error?.xhr?.status ??
    error?.response?.status ??
    error?.error?.status;
  return typeof status === 'number' ? status : undefined;
}

// Retry transient failures only. A 4xx other than 408 (timeout) / 429 (rate limit)
// is permanent (the frame won't appear by retrying), so skip it. No determinable
// status (connection reset) => transient.
function isTransient(error: any): boolean {
  const status = statusOf(error);
  if (status === undefined || status === 0) {
    return true;
  }
  if (status === 408 || status === 429) {
    return true;
  }
  return status >= 500;
}

function initImageRetry(): void {
  // imageId -> attempts made so far.
  const attempts = new Map<string, number>();
  // imageId -> pending retry timer, so we never schedule two retries for one image.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const clear = (imageId: string) => {
    attempts.delete(imageId);
    const timer = timers.get(imageId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(imageId);
    }
  };

  const onLoaded = ({ detail }: any) => {
    const imageId = detail?.imageId;
    if (imageId) {
      clear(imageId);
    }
  };

  const onFailed = ({ detail }: any) => {
    const imageId = detail?.imageId;
    if (!imageId || timers.has(imageId)) {
      return;
    }
    if (!isTransient(detail?.error)) {
      return;
    }
    const made = attempts.get(imageId) ?? 0;
    if (made >= MAX_RETRIES) {
      // Give up — log once so a persistently-failing frame is visible in the console
      // (the loading-% indicator already shows the stall to the user).
      console.warn(`[pacsai] image load failed after ${MAX_RETRIES} retries: ${imageId}`);
      clear(imageId);
      return;
    }

    const delay = BACKOFF_MS[made] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    const timer = setTimeout(() => {
      timers.delete(imageId);
      // It may have been loaded by another path (cache) or be in-flight in the
      // meantime — don't double-enqueue.
      if (cache.getImageLoadObject(imageId)) {
        return;
      }
      attempts.set(imageId, made + 1);
      imageLoadPoolManager.addRequest(
        () =>
          imageLoader
            .loadAndCacheImage(imageId, { requestType: REQUEST_TYPE, preScale: { enabled: true } })
            // Swallow the rejection here: failure re-fires IMAGE_LOAD_FAILED, which
            // re-enters this handler for the next attempt (or the give-up branch).
            .catch(() => {}),
        REQUEST_TYPE,
        { imageId }
      );
    }, delay);
    timers.set(imageId, timer);
  };

  eventTarget.addEventListener(EVENTS.IMAGE_LOADED, onLoaded);
  eventTarget.addEventListener(EVENTS.IMAGE_LOAD_FAILED, onFailed);
  eventTarget.addEventListener(EVENTS.IMAGE_LOAD_ERROR, onFailed);
}

export default initImageRetry;
