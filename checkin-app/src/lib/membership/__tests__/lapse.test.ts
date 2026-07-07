import { isMembershipLapsed, isPastGrace } from "@/lib/membership/lapse";

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const DAY = 24 * 60 * 60 * 1000;

describe("isMembershipLapsed — the lapse derivation", () => {
    // A renewal opened ~2mo before a Jan-1 boundary; the boundary it targets is
    // Jan 1 2024. `now` decides whether that boundary has passed.
    const boundary = D(2020, 0, 1); // Jan 1 (month/day only)
    const renewalOpened = D(2023, 10, 1); // Nov 1 2023 → targets Jan 1 2024

    it("REVOKED is always lapsed (no boundary needed)", () => {
        expect(isMembershipLapsed({ status: "REVOKED", renewalProcesses: [] }, null, D(2024, 5, 1))).toBe(true);
    });

    it("DENIED is always lapsed", () => {
        expect(isMembershipLapsed({ status: "DENIED", renewalProcesses: [] }, boundary, D(2024, 5, 1))).toBe(true);
    });

    it("NONE / never-a-member is never lapsed", () => {
        expect(isMembershipLapsed({ status: "NONE", renewalProcesses: [{ createdAt: renewalOpened }] }, boundary, D(2024, 5, 1))).toBe(false);
    });

    it("ACTIVE with a renewal overdue past the boundary IS lapsed", () => {
        // now = Mar 1 2024 > Jan 1 2024 boundary → overdue.
        expect(isMembershipLapsed({ status: "ACTIVE", renewalProcesses: [{ createdAt: renewalOpened }] }, boundary, D(2024, 2, 1))).toBe(true);
    });

    it("ACTIVE with a renewal still before its boundary is NOT lapsed", () => {
        // now = Dec 15 2023 < Jan 1 2024 boundary → not yet overdue.
        expect(isMembershipLapsed({ status: "ACTIVE", renewalProcesses: [{ createdAt: renewalOpened }] }, boundary, D(2023, 11, 15))).toBe(false);
    });

    it("ACTIVE with no in-flight renewal is NOT lapsed", () => {
        expect(isMembershipLapsed({ status: "ACTIVE", renewalProcesses: [] }, boundary, D(2024, 5, 1))).toBe(false);
    });

    it("ACTIVE + overdue renewal but no boundary configured is NOT lapsed (never guess)", () => {
        expect(isMembershipLapsed({ status: "ACTIVE", renewalProcesses: [{ createdAt: renewalOpened }] }, null, D(2024, 5, 1))).toBe(false);
    });
});

describe("isPastGrace — the grace-window math", () => {
    const now = D(2024, 5, 15);

    it("flagged now with 0 grace days is immediately past grace", () => {
        expect(isPastGrace(now, 0, now)).toBe(true);
    });

    it("flagged now with a positive grace window is NOT yet past", () => {
        expect(isPastGrace(now, 7, now)).toBe(false);
    });

    it("flagged 3 days ago is still inside a 7-day window", () => {
        expect(isPastGrace(new Date(now.getTime() - 3 * DAY), 7, now)).toBe(false);
    });

    it("flagged 10 days ago is past a 7-day window", () => {
        expect(isPastGrace(new Date(now.getTime() - 10 * DAY), 7, now)).toBe(true);
    });

    it("is exact at the boundary (flagged exactly graceDays ago counts as past)", () => {
        expect(isPastGrace(new Date(now.getTime() - 7 * DAY), 7, now)).toBe(true);
    });
});
