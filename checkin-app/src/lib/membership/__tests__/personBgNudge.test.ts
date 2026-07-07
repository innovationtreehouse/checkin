/**
 * @jest-environment node
 */
/**
 * Unit test for the escalating-nudge threshold math (dueThresholdDay). The DB dedup
 * (the unique(processId, thresholdDay) index blocking re-sends) is exercised by the
 * integration test; here we only pin the pure schedule: 0, +14d, +30d, then monthly.
 */
import { dueThresholdDay } from '@/lib/membership/personBgNudge';

describe('dueThresholdDay — open, +14d, +30d, then monthly', () => {
    it('is null before the obligation exists (negative age)', () => {
        expect(dueThresholdDay(-1)).toBeNull();
    });

    it('stage 0 from open through day 13', () => {
        expect(dueThresholdDay(0)).toBe(0);
        expect(dueThresholdDay(13)).toBe(0);
    });

    it('stage 14 on day 14 through day 29', () => {
        expect(dueThresholdDay(14)).toBe(14);
        expect(dueThresholdDay(29)).toBe(14);
    });

    it('stage 30 on day 30 through day 59', () => {
        expect(dueThresholdDay(30)).toBe(30);
        expect(dueThresholdDay(45)).toBe(30);
        expect(dueThresholdDay(59)).toBe(30);
    });

    it('then monthly: 60, 90, 120 ...', () => {
        expect(dueThresholdDay(60)).toBe(60);
        expect(dueThresholdDay(89)).toBe(60);
        expect(dueThresholdDay(90)).toBe(90);
        expect(dueThresholdDay(120)).toBe(120);
    });

    it('is monotonic — a later age never yields a smaller threshold', () => {
        let prev = -1;
        for (let age = 0; age <= 400; age++) {
            const t = dueThresholdDay(age)!;
            expect(t).toBeGreaterThanOrEqual(prev);
            prev = t;
        }
    });
});
