import { nextBoundary, landsNextYear } from '@/lib/programYear';

// Anchor "now" so the rollover branch is deterministic.
const NOW = new Date('2026-07-06T00:00:00Z');
const SEPT1 = '2000-09-01T00:00:00Z'; // stored boundary — only month/day matter

describe('nextBoundary', () => {
    it('picks this year when the boundary month/day is still ahead', () => {
        // Sept 1 2026 is after Jul 6 2026.
        expect(nextBoundary(new Date(SEPT1), NOW).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });

    it('rolls to next year when the boundary month/day has already passed', () => {
        const now = new Date('2026-10-01T00:00:00Z'); // past Sept 1
        expect(nextBoundary(new Date(SEPT1), now).toISOString()).toBe('2027-09-01T00:00:00.000Z');
    });
});

describe('landsNextYear', () => {
    it('true when the program starts on/after the next cutoff', () => {
        expect(landsNextYear('2026-09-15T00:00:00Z', SEPT1, NOW)).toBe(true); // after Sept 1 2026
        expect(landsNextYear('2026-09-01T00:00:00Z', SEPT1, NOW)).toBe(true); // exactly the cutoff
    });

    it('false when the program starts before the next cutoff (current year)', () => {
        expect(landsNextYear('2026-08-01T00:00:00Z', SEPT1, NOW)).toBe(false);
    });

    it('false (unknown) when start date or cutoff is missing', () => {
        expect(landsNextYear(null, SEPT1, NOW)).toBe(false);
        expect(landsNextYear('2026-09-15T00:00:00Z', null, NOW)).toBe(false);
    });
});
