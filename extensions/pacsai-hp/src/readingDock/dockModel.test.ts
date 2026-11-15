import { IMAGES_GONE_LINE_PX, READING_MIC_KEY, VIEWER_HEADER_PX, afterShown, dockView, isMicKey, micLine, noticeText, type DockInput } from './dockModel';

const base: DockInput = {
  requested: 'both',
  reportRatio: 0.4,
  widthPx: 1920,
  heightPx: 1080,
  wasSplit: true,
  fallback: null,
  dictationKnown: true,
  viewerShown: true,
  lastVisibleImagesPx: null,
};

describe('dockView', () => {
  it('Both at 1920: images left, divider, report right on 40 %, below the header', () => {
    const v = dockView(base);
    const reportPx = Math.round(1912 * 0.4);
    expect(v.mode).toBe('both');
    expect(v.imagesWidthPx).toBe(1912 - reportPx);
    expect(v.divider).toEqual({ shown: true, left: 1912 - reportPx, top: VIEWER_HEADER_PX, width: 8, height: 1080 - VIEWER_HEADER_PX });
    expect(v.column).toEqual({ left: 1920 - reportPx, top: VIEWER_HEADER_PX, width: reportPx, height: 1080 - VIEWER_HEADER_PX, shown: true });
    expect(v.parked).toBe(false);
  });

  it('Report covers the parked images, which keep their last width', () => {
    const v = dockView({ ...base, requested: 'report', lastVisibleImagesPx: 1100 });
    expect(v.mode).toBe('report');
    expect(v.column).toMatchObject({ left: 0, width: 1920, shown: true });
    expect(v.divider.shown).toBe(false);
    expect(v.imagesWidthPx).toBe(1100);
    expect(v.parked).toBe(true);
  });

  it('Images parks the report off screen at a real size, inert, and the images take the window', () => {
    const v = dockView({ ...base, requested: 'images' });
    expect(v.mode).toBe('images');
    expect(v.column.shown).toBe(false);
    expect(v.column.left).toBe(1920);
    expect(v.column.width).toBe(Math.round(1912 * 0.4));
    expect(v.imagesWidthPx).toBe(1920);
    expect(v.parked).toBe(false);
  });

  it('holds Images as Both until the report has told its microphone state', () => {
    const v = dockView({ ...base, requested: 'images', dictationKnown: false });
    expect(v.mode).toBe('both');
    expect(v.imagesHeld).toBe(true);
    expect(v.column.shown).toBe(true);
  });

  it("never lets the narrow ladder's one pane be Images before the microphone state is known", () => {
    const known = dockView({ ...base, widthPx: 1300, fallback: 'images' });
    expect(known.mode).toBe('images');
    const unknown = dockView({ ...base, widthPx: 1300, fallback: 'images', dictationKnown: false });
    expect(unknown.mode).toBe('report');
    expect(unknown.imagesHeld).toBe(true);
  });

  it('one pane below 1364 px', () => {
    expect(dockView({ ...base, widthPx: 1363 }).mode).toBe('report');
    expect(dockView({ ...base, widthPx: 1364, wasSplit: true }).mode).toBe('both');
  });

  it('with no viewer route (an error route) the report is alone below the line', () => {
    const v = dockView({ ...base, viewerShown: false, requested: 'images' });
    expect(v.mode).toBe('report');
    expect(v.column).toMatchObject({ left: 0, top: IMAGES_GONE_LINE_PX, width: 1920, shown: true });
    expect(v.parked).toBe(true);
  });

  it('remembers the last images width a parked area keeps', () => {
    const both = dockView(base);
    const next = afterShown(both, { lastVisibleImagesPx: null });
    expect(next).toEqual({ wasSplit: true, lastVisibleImagesPx: both.layout.imagesPx });
    const report = dockView({ ...base, requested: 'report', lastVisibleImagesPx: next.lastVisibleImagesPx });
    expect(afterShown(report, next).lastVisibleImagesPx).toBe(both.layout.imagesPx);
  });
});

describe('the header lines', () => {
  it('says where dictation goes', () => {
    expect(micLine(null)).toBe('Report microphone: waiting');
    expect(micLine({ started: true, busy: false, available: true, pending: 0 })).toBe('Dictating into the report');
    expect(micLine({ started: true, busy: false, available: true, pending: 2 })).toBe('Dictating into the report · 2 to confirm');
    expect(micLine({ started: false, busy: false, available: true, pending: 0 })).toBe('Report microphone off');
    expect(micLine({ started: false, busy: false, available: false, pending: 0 })).toBe('Report microphone unavailable');
  });

  it('has words for every code the island sends, and a line for one it does not know', () => {
    for (const code of ['AUTH_REQUIRED', 'USER_CHANGED', 'CASE_UNAVAILABLE', 'DRAFT_NOT_SAVED', 'DRAFT_STOPPED',
      'DRAFT_OTHER_READER', 'DRAFT_RESTORED_CHANGED', 'DRAFT_CHECK_SECTIONS', 'ISLAND_CSS_FAILED', 'ISLAND_RENDER_FAILED']) {
      expect(noticeText(code)).not.toBe('Report: needs your attention');
    }
    expect(noticeText('SOMETHING_NEW')).toBe('Report: needs your attention');
    expect(noticeText('toString')).toBe('Report: needs your attention');
  });
});

describe('the microphone key', () => {
  const key = (o: Partial<KeyboardEvent> = {}) =>
    ({
      code: 'F4',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...o,
    }) as KeyboardEvent;
  it("is F4 (PowerScribe's dictation on/off), labelled for the shortcut sheet", () => {
    expect(READING_MIC_KEY).toEqual({ label: 'Microphone on/off', keys: ['f4'], code: 'F4' });
  });
  it("only a plain F4: Alt+F4 and Ctrl+F4 stay the system's and the browser's, Shift and Meta too", () => {
    expect(isMicKey(key())).toBe(true);
    expect(isMicKey(key({ altKey: true }))).toBe(false);
    expect(isMicKey(key({ ctrlKey: true }))).toBe(false);
    expect(isMicKey(key({ metaKey: true }))).toBe(false);
    expect(isMicKey(key({ shiftKey: true }))).toBe(false);
    expect(isMicKey(key({ code: 'F3' }))).toBe(false);
    expect(isMicKey(key({ code: 'Digit4' }))).toBe(false);
  });
});

/**
 * Rev 11 milestone 25, PR 6 (F05: one definition per command): the dock's keys
 * from the report's command list, its own until the list answers.
 */
import { DOCK_KEYS, dockCommandOf, dockKeysOf, keyOfEvent } from './dockModel';

describe("the dock's keys from the report's command list (milestone 25, PR 6)", () => {
  const press = (
    code: string,
    mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}
  ) => ({
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });

  it('its own keys are the ones it had: Alt+1/2/3, Alt+H, Alt+B and plain F4, nothing else', () => {
    expect(dockCommandOf(press('Digit1', { altKey: true }), DOCK_KEYS)).toBe('mode-images');
    expect(dockCommandOf(press('Digit3', { altKey: true }), DOCK_KEYS)).toBe('mode-report');
    expect(dockCommandOf(press('KeyH', { altKey: true }), DOCK_KEYS)).toBe('hold');
    expect(dockCommandOf(press('KeyB', { altKey: true }), DOCK_KEYS)).toBe('back');
    expect(dockCommandOf(press('F4'), DOCK_KEYS)).toBe('microphone');
    for (const p of [
      press('F4', { altKey: true }),
      press('F4', { ctrlKey: true }),
      press('KeyH', { altKey: true, shiftKey: true }),
      press('Digit1', { altKey: true, ctrlKey: true }),
      press('Digit1'),
      press('Numpad1', { altKey: true }),
      press('KeyH'),
    ]) {
      expect(dockCommandOf(p, DOCK_KEYS)).toBeNull();
    }
  });

  it('the physical key, as the list writes it (Option+H on a Mac is alt+h)', () => {
    expect(keyOfEvent(press('KeyH', { altKey: true }))).toBe('alt+h');
    expect(keyOfEvent(press('Digit2', { ctrlKey: true, altKey: true }))).toBe('ctrl+alt+2');
    expect(keyOfEvent(press('F12', { shiftKey: true, metaKey: true }))).toBe('shift+meta+f12');
    expect(keyOfEvent(press('ShiftLeft', { shiftKey: true }))).toBeNull();
    expect(keyOfEvent(press('Enter'))).toBeNull();
  });

  it("takes the list's keys for its own commands, the viewer's only; keeps its own for anything else", () => {
    const keys = dockKeysOf([
      { id: 'hold', label: 'Hold', by: 'viewer', keys: ['alt+j'], spoken: true },
      { id: 'sign', label: 'Sign', by: 'report', keys: ['alt+s'], spoken: false },
      { id: 'back', label: 'Back', by: 'report', keys: ['alt+k'], spoken: true },
      { id: 'microphone', label: 'Microphone', by: 'viewer', keys: ['not a key!'], spoken: false },
    ]);
    expect(keys.hold).toEqual(['alt+j']);
    expect(dockCommandOf(press('KeyJ', { altKey: true }), keys)).toBe('hold');
    expect(dockCommandOf(press('KeyH', { altKey: true }), keys)).toBeNull();
    expect(keys.back).toEqual(DOCK_KEYS.back);
    expect(keys.microphone).toEqual(DOCK_KEYS.microphone);
    expect(dockKeysOf(undefined)).toEqual(DOCK_KEYS);
    expect(dockKeysOf({})).toEqual(DOCK_KEYS);
  });
});
