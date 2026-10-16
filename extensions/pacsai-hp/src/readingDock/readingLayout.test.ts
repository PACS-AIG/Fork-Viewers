import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_REPORT_RATIO,
  SPLIT_MIN_WIDTH_PX,
  frameWidthPx,
  keyboardReportRatio,
  ratioFromPointer,
  resolveLayout,
  splitAllowed,
} from './readingLayout';

/**
 * The SHA-256 of the text between the two "pinned layout rules" lines, the
 * same value the app's src/app/lib/workspaceLayout.pin.test.mjs pins for its
 * own copy (copied from app branch rev11-m6-editor-in-viewer, 16 Oct 2026).
 */
const PINNED_LAYOUT_RULES_SHA256 = '17cb88220fb2b16f6147ab017af2f66e2172462caf056af24c293112fb07459f';

const BEGIN = '// ---- pinned layout rules: begin ----\n';
const END = '// ---- pinned layout rules: end ----\n';

function pinnedRegion(source: string): string | null {
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start < 0 || end < 0 || end < start || source.indexOf(BEGIN, start + 1) >= 0) {
    return null;
  }
  return source.slice(start + BEGIN.length, end);
}

describe('the reading layout rules', () => {
  it("are the app's, byte for byte (pinned by SHA-256)", () => {
    const region = pinnedRegion(readFileSync(join(__dirname, 'readingLayout.ts'), 'utf8'));
    expect(region).not.toBeNull();
    expect(createHash('sha256').update(region as string, 'utf8').digest('hex')).toBe(
      PINNED_LAYOUT_RULES_SHA256
    );
  });

  it('the pin catches a one-character change (negative control)', () => {
    const region = pinnedRegion(readFileSync(join(__dirname, 'readingLayout.ts'), 'utf8')) as string;
    const changed = region.replace('MIN_REPORT_PX = 560', 'MIN_REPORT_PX = 561');
    expect(changed).not.toBe(region);
    expect(createHash('sha256').update(changed, 'utf8').digest('hex')).not.toBe(
      PINNED_LAYOUT_RULES_SHA256
    );
  });

  it('opens at 1920 px as Both with the report on 40 %, floors 560 / 796 px', () => {
    const l = resolveLayout({ requested: 'both', reportRatio: DEFAULT_REPORT_RATIO, widthPx: 1920 });
    expect(l).toMatchObject({ mode: 'both', fits: true, reportPx: Math.round(1912 * 0.4) });
    expect(l.imagesPx + l.reportPx + 8).toBe(1920);
    const tight = resolveLayout({ requested: 'both', reportRatio: 0.9, widthPx: 1920 });
    expect(tight.imagesPx).toBe(796);
    const wide = resolveLayout({ requested: 'both', reportRatio: 0.05, widthPx: 1920 });
    expect(wide.reportPx).toBe(560);
  });

  it('gives one pane below 1364 px and keeps both choices', () => {
    expect(SPLIT_MIN_WIDTH_PX).toBe(1364);
    const narrow = resolveLayout({ requested: 'both', reportRatio: 0.4, widthPx: 1363 });
    expect(narrow).toMatchObject({ mode: 'report', fits: false, reportPx: 1363, imagesPx: 0 });
    expect(
      resolveLayout({ requested: 'both', reportRatio: 0.4, widthPx: 1363, fallback: 'images' }).mode
    ).toBe('images');
    expect(splitAllowed(1364, true)).toBe(true);
    expect(splitAllowed(1364, false)).toBe(false);
  });

  it('parks the images at a real size, and the divider keys move by 2 %', () => {
    const report = resolveLayout({ requested: 'report', reportRatio: 0.4, widthPx: 1920 });
    expect(frameWidthPx(report, 1100, 1920)).toBe(1100);
    expect(frameWidthPx(report, null, 1920)).toBe(1920 - 8 - Math.round(1912 * 0.4));
    expect(keyboardReportRatio('ArrowLeft', 0.4, 1920)).toBe(0.42);
    expect(keyboardReportRatio('ArrowRight', 0.4, 1920)).toBe(0.38);
    expect(keyboardReportRatio('Tab', 0.4, 1920)).toBeNull();
    expect(ratioFromPointer(1920 - 4 - 0.5 * 1912, 1920)).toBeCloseTo(0.5, 6);
  });
});
