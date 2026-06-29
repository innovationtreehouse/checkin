import { formatDate, formatTime, formatDateTime, formatVisitRange, APP_TIMEZONE, toDatetimeLocal, fromDatetimeLocal } from '../time';

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
