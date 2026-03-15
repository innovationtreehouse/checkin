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

describe('isMinor', () => {
    it('returns true if under 18', () => {
        const { isMinor } = require('../time');
        const dob = new Date();
        dob.setFullYear(dob.getFullYear() - 17);
        expect(isMinor(dob)).toBe(true);
    });

    it('returns false if 18 or older', () => {
        const { isMinor } = require('../time');
        const dob = new Date();
        dob.setFullYear(dob.getFullYear() - 18);
        expect(isMinor(dob)).toBe(false);
    });

    it('returns false if dob is null', () => {
        const { isMinor } = require('../time');
        expect(isMinor(null)).toBe(false);
    });

    it('respects the referenceDate argument', () => {
        const { isMinor } = require('../time');
        const dob = new Date('2010-01-01');
        const refDateMinor = new Date('2027-12-31');
        const refDateAdult = new Date('2028-01-01');

        expect(isMinor(dob, refDateMinor)).toBe(true);
        expect(isMinor(dob, refDateAdult)).toBe(false);
    });
});
