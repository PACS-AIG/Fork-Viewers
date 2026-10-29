import {
  NOTHING_HELD_LINE,
  arrivedSince,
  backLine,
  heldLine,
  reportReturnOf,
  seriesLabel,
} from './placeModel';

describe('F58: Hold / Back, the pure half (29 Oct)', () => {
  it('names a series by its number, never by anything else', () => {
    expect(seriesLabel(4)).toBe('series 4');
    expect(seriesLabel('12')).toBe('series 12');
    expect(seriesLabel(undefined)).toBe('a series');
    expect(seriesLabel('AX T1')).toBe('a series');
    expect(seriesLabel(-1)).toBe('a series');
  });

  it('finds the series that arrived since the hold', () => {
    const atHold = [
      { uid: 'a', label: 'series 1' },
      { uid: 'b', label: 'series 2' },
    ];
    expect(arrivedSince(atHold, [...atHold, { uid: 'c', label: 'series 5' }])).toEqual([
      { uid: 'c', label: 'series 5' },
    ]);
    expect(arrivedSince(atHold, atHold)).toEqual([]);
    expect(arrivedSince(atHold, [atHold[0]])).toEqual([]);
  });

  it("takes the island's return only as it should be, counts and a section name", () => {
    expect(
      reportReturnOf({ caret: 'restored', section: 'FINDINGS', placedSince: 2, waiting: 1 })
    ).toEqual({ caret: 'restored', section: 'FINDINGS', placedSince: 2, waiting: 1 });
    expect(reportReturnOf({ caret: 'gone' })).toBeNull();
    expect(reportReturnOf(null)).toBeNull();
    expect(
      reportReturnOf({
        caret: 'section-gone',
        section: 'Patient Smith was seen',
        placedSince: -3,
        waiting: 1.5,
      })
    ).toEqual({ caret: 'section-gone', section: null, placedSince: 0, waiting: 0 });
  });

  it('says what a hold kept', () => {
    expect(heldLine(null)).toBe('Place held: the images. Say "back" or press Alt+B to return');
    expect(heldLine({ section: null })).toBe(
      'Place held: the images and the report. Say "back" or press Alt+B to return'
    );
    expect(NOTHING_HELD_LINE).toMatch(/Nothing held/);
  });

  it('says what Back put back, what it could not, and what arrived meanwhile', () => {
    expect(backLine({ missing: [], arrived: [], report: null })).toBe(
      'Back to your place. Nothing new arrived.'
    );
    expect(
      backLine({
        missing: [],
        arrived: [
          { uid: 'c', label: 'series 5' },
          { uid: 'd', label: 'series 6' },
        ],
        report: { caret: 'restored', section: 'FINDINGS', placedSince: 2, waiting: 1 },
      })
    ).toBe(
      'Back to your place. Since then: 2 new series (series 5 and series 6), 2 sentences placed, 1 waiting to be placed.'
    );
    expect(
      backLine({
        missing: ['series 3'],
        arrived: [],
        report: { caret: 'section-gone', section: 'IMPRESSION', placedSince: 1, waiting: 0 },
      })
    ).toBe(
      'Back to your place. Since then: 1 sentence placed. Series 3 is no longer available; its viewport is left as it is. IMPRESSION is no longer in the report; the caret stays where it is.'
    );
    expect(backLine({ missing: ['series 3', 'series 4'], arrived: [], report: null })).toBe(
      'Back to your place. Nothing new arrived. Series 3 and series 4 are no longer available; their viewports are left as they are.'
    );
  });
});
