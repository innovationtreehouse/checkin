import { calendarYearWindow, isReportableYear } from "@/lib/badgePrints";

describe("calendarYearWindow", () => {
    it("returns a half-open UTC year window [Jan 1, next Jan 1)", () => {
        const { start, end } = calendarYearWindow(2026);
        expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    });

    it("boundary is inclusive at start, exclusive at end", () => {
        const { start, end } = calendarYearWindow(2025);
        // A print at the exact start counts for 2025; one at the exact end does not.
        expect(start.getTime()).toBe(Date.UTC(2025, 0, 1));
        const lastMoment = new Date(Date.UTC(2025, 11, 31, 23, 59, 59, 999));
        expect(lastMoment >= start && lastMoment < end).toBe(true);
        const nextYearFirst = new Date(Date.UTC(2026, 0, 1));
        expect(nextYearFirst >= start && nextYearFirst < end).toBe(false);
    });

    it("adjacent years do not overlap (one year's end is the next year's start)", () => {
        expect(calendarYearWindow(2025).end.getTime()).toBe(calendarYearWindow(2026).start.getTime());
    });
});

describe("isReportableYear", () => {
    it("accepts plausible calendar years", () => {
        expect(isReportableYear(2026)).toBe(true);
        expect(isReportableYear(2000)).toBe(true);
        expect(isReportableYear(2100)).toBe(true);
    });
    it("rejects out-of-range, non-integer, and NaN", () => {
        expect(isReportableYear(1999)).toBe(false);
        expect(isReportableYear(2101)).toBe(false);
        expect(isReportableYear(2026.5)).toBe(false);
        expect(isReportableYear(NaN)).toBe(false);
    });
});
