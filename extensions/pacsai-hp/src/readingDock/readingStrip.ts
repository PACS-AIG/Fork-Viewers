/**
 * Rev 11 milestone 6, approach C (F55, 28 Oct 2026): the Images strip, the
 * viewer's pure half. With the report hidden (Images mode) the dock shows one
 * line under the images, never over them: whether the report is this study's
 * ("Case linked"), the report's case by its accession and exam (OHIF's chip
 * names the patient: one name line, WeiWei's choice of 28 Oct), the last
 * sentence placed, the one thing to settle first, and Sign (D5: Sign from
 * Images mode is allowed, through this strip, which relays to the editor).
 * After Sign it carries the island's offer of the next case instead.
 *
 * The island decides what the strip says (the app's reportStrip.ts); this
 * module reads what it was told and turns it into the strip's words and
 * actions. Pure: no DOM, no window.
 */

export const STRIP_HEIGHT_PX = 44;
/** The images area gives the strip its height (ViewerLayout's contentHeight). */
export const IMAGES_BOTTOM_VAR = '--pacsai-reading-images-bottom';

export type StripLink = 'linked' | 'not-linked' | 'unknown';
export type StripSign = 'sign' | 'review' | 'waiting' | 'held' | 'signing';
const LINKS: readonly string[] = ['linked', 'not-linked', 'unknown'];
const SIGNS: readonly string[] = ['sign', 'review', 'waiting', 'held', 'signing'];

export interface StripState {
  studyInstanceUid: string;
  accession: string;
  exam: string;
  linked: StripLink;
  lastPlaced: string | null;
  sign: StripSign;
  blocker: { text: string; fix: 'show' | null } | null;
  line: { code: string; text: string; actions: Array<{ id: string; label: string }> } | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const STUDY_UID = /^[0-9]+(\.[0-9]+)*$/;

/** What the island told, when it is a strip; else null (nothing is shown). */
export function readStripState(v: unknown): StripState | null {
  if (!isObject(v)) {
    return null;
  }
  const study = text(v.studyInstanceUid, 64);
  const accession = text(v.accession, 64);
  const exam = text(v.exam, 120);
  const lastPlaced = v.lastPlaced === null ? null : text(v.lastPlaced, 200);
  if (!study || !STUDY_UID.test(study) || accession === null || exam === null) {
    return null;
  }
  if (lastPlaced === null && v.lastPlaced !== null) {
    return null;
  }
  if (!LINKS.includes(v.linked as string) || !SIGNS.includes(v.sign as string)) {
    return null;
  }
  let blocker: StripState['blocker'] = null;
  if (v.blocker !== null) {
    if (!isObject(v.blocker)) {
      return null;
    }
    const b = text(v.blocker.text, 160);
    if (!b || (v.blocker.fix !== 'show' && v.blocker.fix !== null)) {
      return null;
    }
    blocker = { text: b, fix: v.blocker.fix as 'show' | null };
  }
  let line: StripState['line'] = null;
  if (v.line !== null) {
    if (!isObject(v.line) || !Array.isArray(v.line.actions)) {
      return null;
    }
    const code = text(v.line.code, 32);
    const t = text(v.line.text, 240);
    const actions = v.line.actions.flatMap(a =>
      isObject(a) && typeof a.id === 'string' && ID.test(a.id) && text(a.label, 24)
        ? [{ id: a.id, label: a.label as string }]
        : []
    );
    if (!code || !t || actions.length !== v.line.actions.length || actions.length > 3) {
      return null;
    }
    line = { code, text: t, actions };
  }
  return {
    studyInstanceUid: study,
    accession,
    exam,
    linked: v.linked as StripLink,
    lastPlaced,
    sign: v.sign as StripSign,
    blocker,
    line,
  };
}

/** One of the strip's buttons: `sign` (the island's Sign), `review` and `show`
 *  (show the report: Both), or `line:<id>` (an action of the island's line). */
export interface StripAction {
  id: string;
  label: string;
  disabled: boolean;
  primary: boolean;
}

export interface StripView {
  linkText: string;
  caseText: string;
  /** The last sentence placed, or the island's line after Sign. */
  mainText: string;
  blockerText: string;
  actions: StripAction[];
}

export function stripView(state: StripState): StripView {
  const linkText =
    state.linked === 'linked' ? 'Case linked' : state.linked === 'not-linked' ? 'Not linked' : '';
  const caseText = [state.accession ? `ACC ${state.accession}` : '', state.exam]
    .filter(Boolean)
    .join(' · ');
  if (state.line) {
    return {
      linkText,
      caseText,
      mainText: state.line.text,
      blockerText: '',
      actions: state.line.actions.map((a, i) => ({
        id: `line:${a.id}`,
        label: a.label,
        disabled: false,
        primary: i === 0,
      })),
    };
  }
  const sign = (label: string, disabled: boolean): StripAction => ({
    id: 'sign',
    label,
    disabled,
    primary: true,
  });
  let actions: StripAction[];
  switch (state.sign) {
    case 'sign':
      actions = [sign('Sign', false)];
      break;
    case 'review':
      actions = [{ id: 'review', label: 'Review', disabled: false, primary: true }];
      break;
    case 'signing':
      actions = [sign('Signing…', true)];
      break;
    case 'waiting':
      actions =
        state.blocker?.fix === 'show'
          ? [
              { id: 'show', label: 'Show report', disabled: false, primary: false },
              sign('Sign', true),
            ]
          : [sign('Sign', true)];
      break;
    default:
      actions = [sign('Sign', true)];
  }
  return {
    linkText,
    caseText,
    mainText: state.lastPlaced ?? '',
    blockerText:
      state.sign === 'review'
        ? 'Changed since you last saw the report'
        : (state.blocker?.text ?? ''),
    actions,
  };
}

/** What the harness reads of the strip: no report text, no study UID. */
export function stripSnapshot(state: StripState | null, shown: boolean) {
  return state
    ? {
        shown,
        linked: state.linked,
        sign: state.sign,
        blocker: !!state.blocker,
        lastChars: state.lastPlaced?.length ?? 0,
        line: state.line?.code ?? null,
        actions: stripView(state).actions.map(a => (a.disabled ? `${a.id}(off)` : a.id)),
      }
    : null;
}
