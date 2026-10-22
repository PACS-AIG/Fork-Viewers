/**
 * The viewer's errors stay where they happen (22 Oct 2026).
 *
 * A render error inside a React subtree is caught by the nearest error
 * boundary: one per viewport pane and one around the viewport grid
 * (components/ViewportGrid.tsx); the route's boundary only gets what is past
 * those. An error no boundary can catch (thrown from an event handler or a
 * timer, or a promise rejected with no handler) is the window's: this
 * reporter, installed once by App, logs it and raises one toast, and leaves
 * the page as it is. Before, every ErrorBoundary instance listened for these
 * itself, silenced them in the console and logged them at debug level only.
 *
 * The texts below are the error's own words and stack. A thrown value that is
 * not an error is named by its type and keys, never its values.
 */

export type ErrorToast = {
  title: string;
  message: string;
  type: 'error';
  duration: number;
};

/** How long a toast stays. */
export const ERROR_TOAST_MS = 8000;
/** The same summary again within this is logged, not toasted again. */
export const SAME_ERROR_QUIET_MS = 30_000;
/** At most one toast this often, whatever the error (a burst is logged in full). */
export const ANY_ERROR_QUIET_MS = 3000;

const SUMMARY_MAX = 200;
const DETAILS_MAX = 4000;
const KEYS_MAX = 8;

type ErrorLike = { name?: unknown; message?: unknown; stack?: unknown };

const isErrorLike = (value: unknown): value is ErrorLike =>
  !!value && typeof value === 'object' && 'message' in value;

const capped = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** A value that is not an error: a string as it is, an object by its type and keys. */
const named = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return String(value);
  }
  const keys = Object.keys(value);
  const shownKeys = keys.slice(0, KEYS_MAX).join(', ') + (keys.length > KEYS_MAX ? ', …' : '');
  return `${Object.prototype.toString.call(value)} with keys {${shownKeys}}`;
};

const headOf = (error: ErrorLike) => `${String(error.name || 'Error')}: ${String(error.message)}`;

/** One line, "Name: message" (or the value named), at most 200 characters. Never throws. */
export function errorSummary(error: unknown): string {
  try {
    const text = isErrorLike(error) ? headOf(error) : named(error);
    return capped(text.split('\n')[0].trim() || 'Unknown error', SUMMARY_MAX);
  } catch (_) {
    return 'Unknown error';
  }
}

/** The whole message and the stack, for a Details toggle. Never throws. */
export function describeError(error: unknown): string {
  try {
    if (!isErrorLike(error)) {
      return capped(named(error), DETAILS_MAX);
    }
    const head = headOf(error);
    const stack = typeof error.stack === 'string' ? error.stack : '';
    // V8's stack starts with that same head; Firefox's and Safari's are frames only.
    const frames = stack.startsWith(head) ? stack.slice(head.length).replace(/^\n/, '') : stack;
    return capped(frames ? `${head}\n${frames}` : head, DETAILS_MAX);
  } catch (_) {
    return 'Unknown error';
  }
}

const isAbort = (error: unknown) => isErrorLike(error) && error.name === 'AbortError';

/**
 * Listen for the window's uncaught errors and unhandled rejections: each is
 * marked handled (as the boundaries did, so the browser does not report it a
 * second time), logged (console.error) and toasted, unless the same summary
 * was toasted in the last 30 s or any toast in the last 3 s. Logged, not
 * toasted: a cancelled request (AbortError). Only silenced, as before: an
 * `error` event without an error object (the browser's ResizeObserver loop
 * notice, a cross-origin "Script error."). Returns the uninstall.
 */
export function installUncaughtErrorReporting({
  notify,
  target = window,
  now = () => Date.now(),
}: {
  notify: (toast: ErrorToast) => void;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
}): () => void {
  const toastedAt = new Map<string, number>();
  let lastToastAt = -Infinity;

  const report = (label: string, error: unknown) => {
    console.error(`[viewer] ${label}; the viewer kept running:`, error);
    if (isAbort(error)) {
      return;
    }
    const message = errorSummary(error);
    const at = now();
    if (at - (toastedAt.get(message) ?? -Infinity) < SAME_ERROR_QUIET_MS) {
      return;
    }
    if (at - lastToastAt < ANY_ERROR_QUIET_MS) {
      return;
    }
    toastedAt.set(message, at);
    lastToastAt = at;
    try {
      notify({ title: 'Something went wrong', message, type: 'error', duration: ERROR_TOAST_MS });
    } catch (_) {
      /* no toast: the console has it */
    }
  };

  const onError = (event: ErrorEvent) => {
    event.preventDefault();
    if (event.error === undefined || event.error === null) {
      return;
    }
    report('Uncaught error', event.error);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    report('Unhandled promise rejection', event.reason);
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
