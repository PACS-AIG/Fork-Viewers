/**
 * pacsai: the words for an error the viewer contained (22 Oct 2026): the one
 * line a toast shows (the page's error reporter, platform/app's
 * utils/errorReporting.ts) and the Details of a RenderErrorCard. They are the
 * error's own message and stack; a thrown value that is not an error is named
 * by its type and keys, never its values.
 */

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
