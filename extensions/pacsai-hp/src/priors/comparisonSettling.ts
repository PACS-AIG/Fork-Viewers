/**
 * Rev 11 milestone 7: the cases whose comparison is still being set up
 * (loadRelevantPriors: the load, then its re-hang poll), keyed as that loader
 * keys a case (caseKey), so Arrange can wait instead of previewing a layout the
 * load is about to replace. Its own module so Arrange reads it without
 * importing the loader.
 */
import { caseKey } from './pinCase';

const settling = new Set<string>();

/** The loader starts setting up this case's comparison. */
export function markSettling(key: string): void {
  settling.add(key);
}

/** The loader is done with it (shown, dropped, failed or timed out). */
export function clearSettling(key: string): void {
  settling.delete(key);
}

/** Whether the comparison of this study, in the case open now, is still being set up. */
export function comparisonSettling(studyInstanceUID: string | undefined): boolean {
  return !!studyInstanceUID && settling.has(caseKey(studyInstanceUID));
}
