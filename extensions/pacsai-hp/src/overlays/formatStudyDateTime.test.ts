import { formatDicomTimeHM, formatStudyDateTime } from './formatStudyDateTime';

// Stand-in for the overlay framework's `formatters.formatDate` (moment-based),
// so these tests exercise our composition, not moment.
const formatDate = (raw: unknown) => (raw ? `D(${raw})` : '');

describe('formatDicomTimeHM', () => {
  it('formats a full DICOM TM value as 24-hour HH:mm', () => {
    expect(formatDicomTimeHM('143214')).toBe('14:32');
    expect(formatDicomTimeHM('143214.000000')).toBe('14:32');
    expect(formatDicomTimeHM('0930')).toBe('09:30');
    expect(formatDicomTimeHM('000000')).toBe('00:00');
  });

  it('tolerates colon-delimited and hour-only values', () => {
    expect(formatDicomTimeHM('09:30:00')).toBe('09:30');
    expect(formatDicomTimeHM('14')).toBe('14:00');
  });

  it('returns empty for absent or unparseable values instead of a bogus time', () => {
    expect(formatDicomTimeHM(undefined)).toBe('');
    expect(formatDicomTimeHM(null)).toBe('');
    expect(formatDicomTimeHM('')).toBe('');
    expect(formatDicomTimeHM('   ')).toBe('');
    expect(formatDicomTimeHM('abc')).toBe('');
    expect(formatDicomTimeHM('2400')).toBe(''); // out of range hour
    expect(formatDicomTimeHM('1362')).toBe(''); // out of range minute
  });
});

describe('formatStudyDateTime', () => {
  it('appends the time to the formatted date', () => {
    expect(formatStudyDateTime({ StudyDate: '20260601', StudyTime: '143214' }, formatDate)).toBe(
      'D(20260601) 14:32'
    );
  });

  it('degrades to the date alone when StudyTime is missing or unusable', () => {
    expect(formatStudyDateTime({ StudyDate: '20260601' }, formatDate)).toBe('D(20260601)');
    expect(formatStudyDateTime({ StudyDate: '20260601', StudyTime: '' }, formatDate)).toBe(
      'D(20260601)'
    );
  });

  it('falls back to the series stamp when the study stamp is absent', () => {
    expect(formatStudyDateTime({ SeriesDate: '20260601', SeriesTime: '0930' }, formatDate)).toBe(
      'D(20260601) 09:30'
    );
  });

  it('renders nothing without a date (a bare time would be more confusing)', () => {
    expect(formatStudyDateTime({ StudyTime: '143214' }, formatDate)).toBe('');
    expect(formatStudyDateTime(undefined, formatDate)).toBe('');
    expect(formatStudyDateTime({ StudyDate: '20260601' }, undefined)).toBe('');
  });
});
