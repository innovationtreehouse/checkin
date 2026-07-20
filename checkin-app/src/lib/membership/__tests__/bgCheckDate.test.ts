import { attestedDay, sameAttestedDay, parseCheckDate } from "@/lib/membership/bgCheckDate";

describe("bgCheckDate", () => {
    describe("attestedDay", () => {
        it("null/undefined → null (as of today)", () => {
            expect(attestedDay(null)).toBeNull();
            expect(attestedDay(undefined)).toBeNull();
        });
        it("a date → its UTC calendar day", () => {
            expect(attestedDay(new Date("2026-03-14T00:00:00.000Z"))).toBe("2026-03-14");
            // time-of-day is dropped
            expect(attestedDay(new Date("2026-03-14T23:59:59.000Z"))).toBe("2026-03-14");
        });
    });

    describe("sameAttestedDay", () => {
        it("both null agree (both attest as of today)", () => {
            expect(sameAttestedDay(null, null)).toBe(true);
        });
        it("null vs a date disagree — the second reviewer can't add a date the first didn't", () => {
            expect(sameAttestedDay(null, new Date("2026-03-14T00:00:00Z"))).toBe(false);
            expect(sameAttestedDay(new Date("2026-03-14T00:00:00Z"), null)).toBe(false);
        });
        it("same calendar day agrees regardless of time-of-day", () => {
            expect(sameAttestedDay(new Date("2026-03-14T00:00:00Z"), new Date("2026-03-14T18:30:00Z"))).toBe(true);
        });
        it("different days disagree", () => {
            expect(sameAttestedDay(new Date("2026-03-14T00:00:00Z"), new Date("2026-03-15T00:00:00Z"))).toBe(false);
        });
    });

    describe("parseCheckDate", () => {
        const now = new Date("2026-07-20T12:00:00.000Z");
        it("absent → null (default, as of today)", () => {
            expect(parseCheckDate(undefined, now)).toEqual({ date: null });
            expect(parseCheckDate(null, now)).toEqual({ date: null });
            expect(parseCheckDate("", now)).toEqual({ date: null });
        });
        it("a valid past date → UTC-midnight Date", () => {
            const r = parseCheckDate("2026-03-14", now);
            expect("date" in r && r.date?.toISOString()).toBe("2026-03-14T00:00:00.000Z");
        });
        it("today is allowed", () => {
            const r = parseCheckDate("2026-07-20", now);
            expect("date" in r && r.date?.toISOString()).toBe("2026-07-20T00:00:00.000Z");
        });
        it("a future date is rejected", () => {
            expect(parseCheckDate("2026-07-21", now)).toEqual({ error: "The check date cannot be in the future" });
        });
        it("malformed input is rejected", () => {
            expect("error" in parseCheckDate("03/14/2026", now)).toBe(true);
            expect("error" in parseCheckDate("2026-3-4", now)).toBe(true);
            expect("error" in parseCheckDate(20260314, now)).toBe(true);
        });
        it("a well-formed but impossible date is rejected (V8 would silently roll it over)", () => {
            expect("error" in parseCheckDate("2026-02-30", now)).toBe(true); // → Mar 2 without the round-trip guard
            expect("error" in parseCheckDate("2026-13-01", now)).toBe(true);
            expect("error" in parseCheckDate("2026-07-00", now)).toBe(true);
        });
    });
});
