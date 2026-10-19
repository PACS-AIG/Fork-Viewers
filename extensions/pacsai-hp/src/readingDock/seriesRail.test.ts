/**
 * Rev 11 milestone 6, approach C, phase 1 PR 4: the series rail's layout props
 * and the reader's close, remembered in this browser.
 */
import {
  RAIL_CLOSED_KEY,
  READING_RAIL_PX,
  SERIES_RAIL_PANEL,
  railLayoutProps,
  readRailClosed,
  writeRailClosed,
} from './seriesRail';

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    map,
  };
};

describe('the series rail', () => {
  it('is the measurement-tracking seriesRail panel, 112 px, not resizable, open by default', () => {
    const storage = memoryStorage();
    const props = railLayoutProps(storage);
    expect(SERIES_RAIL_PANEL).toBe('@ohif/extension-measurement-tracking.panelModule.seriesRail');
    expect(READING_RAIL_PX).toBe(112);
    expect(props).toMatchObject({
      leftPanels: [SERIES_RAIL_PANEL],
      leftPanelResizable: false,
      leftPanelWidth: 112,
      leftPanelClosed: false,
    });
    // one callback for every render: the layout's effect does not re-run for a new function
    expect(railLayoutProps(storage).onLeftPanelClosedChange).toBe(props.onLeftPanelClosedChange);
  });

  it('remembers a close and an open; nothing stored reads as open', () => {
    const storage = memoryStorage();
    expect(readRailClosed(storage)).toBe(false);
    writeRailClosed(true, storage);
    expect(storage.map.get(RAIL_CLOSED_KEY)).toBe('1');
    expect(readRailClosed(storage)).toBe(true);
    expect(railLayoutProps(storage).leftPanelClosed).toBe(true);
    writeRailClosed(false, storage);
    expect(readRailClosed(storage)).toBe(false);
  });

  it('a storage that throws (private mode, blocked) leaves the rail open and breaks nothing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readRailClosed(broken)).toBe(false);
    expect(() => writeRailClosed(true, broken)).not.toThrow();
    expect(readRailClosed(null)).toBe(false);
  });
});
