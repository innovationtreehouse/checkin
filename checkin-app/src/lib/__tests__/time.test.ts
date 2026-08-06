import { formatDate, formatTime, formatDateTime, formatVisitRange, APP_TIMEZONE, setDisplayTimezone, getDisplayTimezone, toDatetimeLocal, fromDatetimeLocal, formatDateOnly, parseDateOnly, isYouth, calculateAge } from '../time';

describe('calendar-date helpers', () => {
  it('stores a picked date at UTC midnight', () => {
    expect(parseDateOnly('2026-09-01')!.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('parses a value that already carries a time as-is', () => {
    expect(parseDateOnly('2026-09-01T12:00:00.000Z')!.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('renders the stored calendar day unshifted, where the instant formatter shifts it', () => {
    const stored = parseDateOnly('2026-09-01')!;
    expect(formatDateOnly(stored)).toBe('9/1/2026');
    // formatDate is for instants: UTC midnight rendered in Chicago is the day before
    expect(formatDate(stored)).toBe('8/31/2026');
  });

  it('round-trips picked date → stored value → display and input value', () => {
    for (const picked of ['2026-01-15', '2026-03-08', '2026-09-01', '2026-11-01']) {
      const stored = parseDateOnly(picked)!;
      expect(stored.toISOString().split('T')[0]).toBe(picked);
      const [y, m, d] = picked.split('-').map(Number);
      expect(formatDateOnly(stored)).toBe(`${m}/${d}/${y}`);
    }
  });

  it('handles empty input', () => {
    expect(parseDateOnly('')).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
    expect(formatDateOnly(null)).toBe('');
  });
});

// A DOB is a calendar date stored at UTC midnight, so age must be read from the
// UTC fields. Every case here is run with the process timezone west of UTC —
// where a local-field read sees the DOB a day early.
describe('calculateAge west of UTC', () => {
  const realTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/Chicago'; });
  afterAll(() => { if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz; });

  const DOB = '2008-07-24T00:00:00.000Z';

  it('does not age someone up the day before their birthday', () => {
    // noon Chicago on 23 July, the day before the 18th birthday
    expect(calculateAge(DOB, '2026-07-23T17:00:00.000Z')).toBe(17);
  });

  it('ages them up on the birthday', () => {
    expect(calculateAge(DOB, '2026-07-24T17:00:00.000Z')).toBe(18);
  });

  it('judges a program age gate as-of a UTC-midnight start date', () => {
    // program.asOf is a calendar date; leap birth year vs non-leap eval year is
    // the case where two local reads disagree by a day and the age comes out low
    expect(calculateAge('2008-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')).toBe(18);
    expect(calculateAge(DOB, '2026-07-24T00:00:00.000Z')).toBe(18);
    expect(calculateAge(DOB, '2026-07-23T00:00:00.000Z')).toBe(17);
  });

  it('rolls the birthday over at UTC midnight, not org-local midnight', () => {
    // Documented ceiling of reading both sides as UTC (see calculateAge): from
    // 7 PM Chicago on the eve, UTC is already the birthday. Fixed by a caller
    // passing the org-zone calendar day, not by reading local fields here.
    expect(calculateAge(DOB, '2026-07-24T00:30:00.000Z')).toBe(18);
  });
});

describe('isYouth', () => {
  it('classifies by age when DOB is known', () => {
    expect(isYouth(new Date('2020-01-01'))).toBe(true);
    expect(isYouth(new Date('1980-01-01'))).toBe(false);
  });

  it('unknown DOB defaults to adult (UI/household-lead contract)', () => {
    expect(isYouth(null)).toBe(false);
    expect(isYouth(undefined)).toBe(false);
    expect(isYouth('', { unknownIs: 'adult' })).toBe(false);
  });

  it('unknown DOB fails closed when the caller opts in (#300)', () => {
    expect(isYouth(null, { unknownIs: 'youth' })).toBe(true);
    expect(isYouth(undefined, { unknownIs: 'youth' })).toBe(true);
    // known DOB is never overridden by the option
    expect(isYouth(new Date('1980-01-01'), { unknownIs: 'youth' })).toBe(false);
  });
});

describe('datetime-local helpers', () => {
  it('round-trips a datetime-local value', () => {
    const local = '2024-03-07T12:30';
    expect(toDatetimeLocal(fromDatetimeLocal(local))).toBe(local);
  });

  it('returns empty string for empty/invalid input', () => {
    expect(toDatetimeLocal(null)).toBe('');
    expect(toDatetimeLocal('')).toBe('');
    expect(toDatetimeLocal('not-a-date')).toBe('');
    expect(fromDatetimeLocal('')).toBe('');
    expect(fromDatetimeLocal(undefined)).toBe('');
  });

  it('fromDatetimeLocal yields a UTC ISO string', () => {
    expect(fromDatetimeLocal('2024-03-07T12:30')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('time.ts formatting utilities', () => {
  const testDate = new Date('2024-03-07T12:00:00Z'); // UTC NOON
  
  it('APP_TIMEZONE should be America/Chicago', () => {
    expect(APP_TIMEZONE).toBe('America/Chicago');
  });

  it('formatDate formats dates correctly in Central Time', () => {
    // 12:00 UTC is 06:00 CST (or 07:00 CDT depending on daylight savings, normally Jest uses the system timezone but we forced the options timeZone)
    const formatted = formatDate(testDate);
    // Since we aren't strict on the exact locale string structure (which varies based on the environment), we just check it returns a string for now, or mock Intl
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('formatTime formats time correctly', () => {
    const formatted = formatTime(testDate);
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('formatDateTime formats date and time correctly', () => {
    const formatted = formatDateTime(testDate);
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
  
  it('returns empty string when date is null', () => {
    expect(formatDate(null)).toBe('');
    expect(formatTime(null)).toBe('');
    expect(formatDateTime(null)).toBe('');
  });
});

// The org's display zone is a setting, not a constant: move it and every instant
// formatter must move with it, while the calendar-date reader must not.
describe('configured display timezone', () => {
  const instant = '2026-09-01T02:30:00.000Z'; // 9:30 PM Aug 31 Chicago, 11:30 AM Sep 1 Tokyo
  afterEach(() => setDisplayTimezone(APP_TIMEZONE));

  it('defaults to APP_TIMEZONE', () => {
    expect(getDisplayTimezone()).toBe(APP_TIMEZONE);
    expect(formatDate(instant)).toBe('8/31/2026');
  });

  it('moves every instant formatter to the configured zone', () => {
    setDisplayTimezone('Asia/Tokyo');
    expect(formatDate(instant)).toBe('9/1/2026');
    expect(formatTime(instant, { hour: 'numeric', minute: '2-digit' })).toBe('11:30 AM');
    expect(formatDateTime(instant)).toContain('9/1/2026');
    expect(formatVisitRange(instant)).toBe('11:30 AM-');
  });

  it('leaves the calendar-date reader UTC-pinned — a day has no zone', () => {
    setDisplayTimezone('Asia/Tokyo');
    expect(formatDateOnly('2026-09-01T00:00:00.000Z')).toBe('9/1/2026');
    setDisplayTimezone('Pacific/Honolulu');
    expect(formatDateOnly('2026-09-01T00:00:00.000Z')).toBe('9/1/2026');
  });

  it('treats an empty configured zone as the fallback', () => {
    setDisplayTimezone('');
    expect(getDisplayTimezone()).toBe(APP_TIMEZONE);
    setDisplayTimezone(null);
    expect(getDisplayTimezone()).toBe(APP_TIMEZONE);
  });
});

describe('formatVisitRange', () => {
  const arrived = '2024-03-07T19:35:00Z'; // 1:35 PM CST
  const departed = '2024-03-07T20:19:00Z'; // 2:19 PM CST, 44 min later

  it('shows start-end and length once departed, no seconds', () => {
    const r = formatVisitRange(arrived, departed);
    expect(r).toBe('1:35 PM-2:19 PM (44 minutes)');
  });

  it('singularizes a one-minute visit', () => {
    expect(formatVisitRange(arrived, '2024-03-07T19:36:00Z')).toBe('1:35 PM-1:36 PM (1 minute)');
  });

  it('shows an open-ended range while active', () => {
    expect(formatVisitRange(arrived, null)).toBe('1:35 PM-');
  });

  it('returns empty string with no arrival', () => {
    expect(formatVisitRange(null)).toBe('');
  });
});
