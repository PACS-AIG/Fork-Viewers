/**
 * RS-38: the refine store the toolbar tool talks to. The tool is a cornerstone
 * tool (one instance per tool group, made by cornerstone), the store belongs
 * to the reading-system pane (one per document, made when the pane enters), so
 * they meet here. Whether the tool is active is kept here too: the tool may be
 * made active before the pane has a store, and a new store starts as it is.
 */
import type { RefineStore } from './refineStore';

let current: RefineStore | null = null;
let armed = false;

export function setCurrentRefineStore(store: RefineStore | null): void {
  current = store;
  store?.setArmed(armed);
}

export const currentRefineStore = (): RefineStore | null => current;

/** The tool became the active mouse tool (true) or stopped being it (false). */
export function setRefineToolArmed(on: boolean): void {
  armed = on;
  current?.setArmed(on);
}

export const refineToolArmed = (): boolean => armed;
