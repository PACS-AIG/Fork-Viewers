/** Rev 11 milestone 7: Arrange waits while a case's comparison is being set up. */
let mockEpoch = 'e1';
jest.mock('./pinCase', () => ({ caseKey: (uid: string | undefined) => `${mockEpoch}:${uid}` }));

// eslint-disable-next-line import/first
import { clearSettling, comparisonSettling, markSettling } from './comparisonSettling';

describe('comparison settling', () => {
  it('is settling from the mark to the clear, for that case only', () => {
    expect(comparisonSettling('A')).toBe(false);
    markSettling('e1:A');
    expect(comparisonSettling('A')).toBe(true);
    expect(comparisonSettling('B')).toBe(false);
    expect(comparisonSettling(undefined)).toBe(false);
    // Another entry of the same study is another case.
    mockEpoch = 'e2';
    expect(comparisonSettling('A')).toBe(false);
    mockEpoch = 'e1';
    clearSettling('e1:A');
    expect(comparisonSettling('A')).toBe(false);
  });
});
