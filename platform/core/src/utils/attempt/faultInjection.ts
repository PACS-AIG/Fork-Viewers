/**
 * Fault injection for the viewer's recovery paths (Rev 11 milestone 2, B02
 * part 4). A failed engine construction or viewport load is rare on a real
 * workstation and impossible to provoke from a probe, yet V05/V06 need the
 * Retry card driven end to end. A probe sets
 *   localStorage['pacsai.faultInjection'] = '<kind>'
 * before the document loads; the first code path that asks for that kind
 * consumes the flag and fails once. Nothing happens unless the flag is set.
 */
const KEY = 'pacsai.faultInjection';

export type InjectedFaultKind = 'engine_construct_once' | 'viewport_load_once';

export function takeInjectedFault(kind: InjectedFaultKind): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    if (localStorage.getItem(KEY) === kind) {
      localStorage.removeItem(KEY);
      return true;
    }
  } catch (_) {
    /* storage unavailable */
  }
  return false;
}

export function injectedFault(message: string): Error {
  const err = new Error(message);
  err.name = 'InjectedFault';
  return err;
}

export function isInjectedFault(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'InjectedFault';
}
