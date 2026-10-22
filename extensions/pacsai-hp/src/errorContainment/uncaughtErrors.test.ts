/**
 * The page's one reporter for errors no error boundary can catch (thrown from
 * an event handler or a timer, a rejected promise nobody handled):
 * platform/app/src/utils/errorReporting.ts, installed once by App. Each is
 * marked handled, logged and toasted, a repeat or a burst toasted once; the
 * page is left as it is. And the texts a toast and a Details toggle show.
 */
import {
  ANY_ERROR_QUIET_MS,
  ERROR_TOAST_MS,
  SAME_ERROR_QUIET_MS,
  describeError,
  errorSummary,
  installUncaughtErrorReporting,
} from '../../../../platform/app/src/utils/errorReporting';

const rejectionOf = (reason: unknown) =>
  Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason });
const errorEventOf = (error: unknown, message = 'Script error.') =>
  new ErrorEvent('error', { cancelable: true, error, message });

let clock = 0;
let notify: jest.Mock;
let uninstall: () => void;
let consoleError: jest.SpyInstance;
beforeEach(() => {
  clock = 1_000_000;
  notify = jest.fn();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  uninstall = installUncaughtErrorReporting({ notify, now: () => clock });
});
afterEach(() => {
  uninstall();
  consoleError.mockRestore();
});

const toastMessages = () => notify.mock.calls.map(([toast]) => toast.message);

describe('installUncaughtErrorReporting', () => {
  it('an unhandled rejection: marked handled, logged, toasted with its summary', () => {
    const reason = new RangeError('byte length of Float32Array should be a multiple of 4');
    const event = rejectionOf(reason);
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled promise rejection'),
      reason
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      title: 'Something went wrong',
      message: 'RangeError: byte length of Float32Array should be a multiple of 4',
      type: 'error',
      duration: ERROR_TOAST_MS,
    });
  });

  it('an uncaught error: marked handled, logged, toasted', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'imageId')");
    const event = errorEventOf(error, error.message);
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Uncaught error'), error);
    expect(toastMessages()).toEqual([
      "TypeError: Cannot read properties of undefined (reading 'imageId')",
    ]);
  });

  it('the same error again within 30 s: logged, not toasted again', () => {
    window.dispatchEvent(rejectionOf(new Error('archive timeout')));
    clock += SAME_ERROR_QUIET_MS - 1;
    window.dispatchEvent(rejectionOf(new Error('archive timeout')));
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);

    clock += 1;
    window.dispatchEvent(rejectionOf(new Error('archive timeout')));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('a burst of different errors: one toast, every one logged', () => {
    window.dispatchEvent(rejectionOf(new Error('first')));
    clock += ANY_ERROR_QUIET_MS - 1;
    window.dispatchEvent(rejectionOf(new Error('second')));
    window.dispatchEvent(errorEventOf(new Error('third')));
    expect(consoleError).toHaveBeenCalledTimes(3);
    expect(toastMessages()).toEqual(['Error: first']);

    clock += 1;
    window.dispatchEvent(rejectionOf(new Error('fourth')));
    expect(toastMessages()).toEqual(['Error: first', 'Error: fourth']);
  });

  it('an error event without an error object (a ResizeObserver loop notice): only silenced', () => {
    const event = errorEventOf(
      null,
      'ResizeObserver loop completed with undelivered notifications.'
    );
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('a cancelled request (AbortError): logged, not toasted', () => {
    const abort = new DOMException('The user aborted a request.', 'AbortError');
    window.dispatchEvent(rejectionOf(abort));
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('a toast that fails leaves the next errors reported', () => {
    notify.mockImplementationOnce(() => {
      throw new Error('no toaster yet');
    });
    window.dispatchEvent(rejectionOf(new Error('one')));
    clock += ANY_ERROR_QUIET_MS;
    window.dispatchEvent(rejectionOf(new Error('two')));
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('uninstalled, it no longer handles anything', () => {
    uninstall();
    const event = rejectionOf(new Error('after'));
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    uninstall = () => undefined;
  });
});

describe('the texts', () => {
  it('errorSummary: "Name: message" on one line, at most 200 characters', () => {
    expect(errorSummary(new SyntaxError('bad token'))).toBe('SyntaxError: bad token');
    expect(errorSummary(new Error('first line\nsecond line'))).toBe('Error: first line');
    expect(errorSummary('a string reason')).toBe('a string reason');
    expect(errorSummary(undefined)).toBe('undefined');
    const long = errorSummary(new Error('x'.repeat(500)));
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });

  it('a value that is not an error is named by its type and keys, never its values', () => {
    // Synthetic: no real patient.
    const summary = errorSummary({ PatientName: 'DOE^JANE', status: 404 });
    expect(summary).toBe('[object Object] with keys {PatientName, status}');
    expect(summary).not.toContain('DOE');
    expect(describeError({ PatientName: 'DOE^JANE' })).not.toContain('DOE');
  });

  it('never throws, whatever was thrown', () => {
    const hostile = {
      get message() {
        throw new Error('getter');
      },
    };
    expect(errorSummary(hostile)).toBe('Unknown error');
    expect(describeError(hostile)).toBe('Unknown error');
  });

  it('describeError: the whole message once, then the stack frames', () => {
    const v8 = new Error('Objects are not valid as a React child');
    v8.stack =
      'Error: Objects are not valid as a React child\n    at throwOnInvalidObjectType (react-dom.js:1:2)';
    expect(describeError(v8)).toBe(
      'Error: Objects are not valid as a React child\n    at throwOnInvalidObjectType (react-dom.js:1:2)'
    );

    // Firefox and Safari: frames only.
    const gecko = new TypeError('x is undefined');
    gecko.stack = 'render@app.bundle.js:1:2\n';
    expect(describeError(gecko)).toBe('TypeError: x is undefined\nrender@app.bundle.js:1:2\n');

    const huge = new Error('y'.repeat(9000));
    huge.stack = '';
    expect(describeError(huge)).toHaveLength(4000);
  });
});
