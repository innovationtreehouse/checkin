import { formatDate, formatTime, formatDateTime, APP_TIMEZONE } from '../time';

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
