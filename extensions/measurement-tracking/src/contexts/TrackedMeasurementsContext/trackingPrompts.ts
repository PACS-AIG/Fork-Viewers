/**
 * pacsai (Rev 11 milestone 6, approach C, phase 1 PR 2): a mode can keep the
 * measurement-tracking machine from asking anything.
 *
 * Every prompt the machine shows serves OHIF's own report, a DICOM SR: "Track
 * measurements for this series?", "Do you want to add this measurement to the
 * existing report?", the save-or-discard question and the SR save dialog they
 * lead to (a store to the archive), and "Do you want to continue tracking
 * measurements for this study?" for an SR hung in a viewport. The radcopilot
 * mode, whose report is the app's editor beside the images, sets the mode
 * customization below to false, and the events that start those prompts are
 * then not sent to the machine. A mode that leaves it unset (every upstream
 * mode, longitudinal included) gets the machine exactly as before.
 *
 * Not held back: an SR viewport's own LOAD button (HYDRATE_SR, the reader's
 * explicit choice, with no prompt), and the events that only move the
 * machine's state (UNTRACK_SERIES, SET_DIRTY, UPDATE_ACTIVE_VIEWPORT_ID, …).
 *
 * Read when an event is sent, never at render: a mode sets its customizations
 * in onModeEnter, after the context's provider has mounted.
 */
export const TRACKING_PROMPTS_CUSTOMIZATION = 'measurementTracking.prompts';

/** The events that start a prompt (measurementTrackingMachine.js). */
export const PROMPTING_EVENTS: ReadonlySet<string> = new Set([
  'TRACK_SERIES',
  'SAVE_REPORT',
  'PROMPT_HYDRATE_SR',
  'RESTORE_PROMPT_HYDRATE_SR',
]);

interface CustomizationReader {
  getCustomization: (customizationId: string) => unknown;
}

/** True while the active mode has the machine's prompts off. */
export function trackingPromptsOff(customizationService?: CustomizationReader | null): boolean {
  try {
    return customizationService?.getCustomization(TRACKING_PROMPTS_CUSTOMIZATION) === false;
  } catch (_) {
    return false; // as upstream: the prompts stay on
  }
}

const eventType = (event: unknown): unknown =>
  typeof event === 'string' ? event : (event as { type?: unknown } | null)?.type;

/**
 * The machine's send, holding back the prompting events while the active mode
 * has the prompts off; otherwise the very same call, with the same answer.
 */
export function gateTrackingSend<Send extends (...args: never[]) => unknown>(
  send: Send,
  customizationService?: CustomizationReader | null
): Send {
  const gated = (...args: Parameters<Send>) => {
    const type = eventType(args[0]);
    if (
      typeof type === 'string' &&
      PROMPTING_EVENTS.has(type) &&
      trackingPromptsOff(customizationService)
    ) {
      return undefined;
    }
    return send(...args);
  };
  return gated as unknown as Send;
}
