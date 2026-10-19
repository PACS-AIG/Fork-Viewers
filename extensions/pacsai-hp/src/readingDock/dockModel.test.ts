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
