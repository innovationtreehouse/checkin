import { inAgreementAgeBand, hasKnownAdultAge, agreementCycleFloor } from "@/lib/membership/personAgreementTriggers";

/**
 * The two pure rules behind PERSON_AGREEMENT (#1224): who the automatic pass picks, and
 * when a prior agreement stops covering the current cycle. Both are the parts that decide
 * whether a real person is asked to sign, so they're pinned here rather than left to the
 * DB-backed trigger test.
 */

const BOUNDARY = new Date("2000-09-01"); // anchor day-of-year; the year is irrelevant
const yearsAgo = (n: number, from = new Date("2026-08-02")) =>
    new Date(Date.UTC(from.getUTCFullYear() - n, from.getUTCMonth(), from.getUTCDate()));

describe("inAgreementAgeBand — the automatic population", () => {
    const now = new Date("2026-08-02");

    it("takes 18 through 25 with a DOB on file", () => {
        expect(inAgreementAgeBand({ dateOfBirth: yearsAgo(18), isDeclaredAdult: false }, now)).toBe(true);
        expect(inAgreementAgeBand({ dateOfBirth: yearsAgo(22), isDeclaredAdult: false }, now)).toBe(true);
        expect(inAgreementAgeBand({ dateOfBirth: yearsAgo(25), isDeclaredAdult: false }, now)).toBe(true);
    });

    it("refuses a minor — the whole point is that a parent's signature stops binding at 18", () => {
        expect(inAgreementAgeBand({ dateOfBirth: yearsAgo(17), isDeclaredAdult: false }, now)).toBe(false);
        // One day short of 18.
        const almost = new Date(Date.UTC(2008, 7, 3));
        expect(inAgreementAgeBand({ dateOfBirth: almost, isDeclaredAdult: false }, now)).toBe(false);
    });

    it("refuses over 25 — a non-lead adult that old is a spouse, not an adult child", () => {
        expect(inAgreementAgeBand({ dateOfBirth: yearsAgo(26), isDeclaredAdult: false }, now)).toBe(false);
        // The ceiling is explicit, not inherited from #1165's DOB purge: a 30-year-old
        // spouse added with a DOB is refused immediately, not merely by the next purge.
        expect(inAgreementAgeBand({ dateOfBirth: yearsAgo(30), isDeclaredAdult: false }, now)).toBe(false);
    });

    it("refuses an unknown age, declared-adult included (that flag MEANS over 25)", () => {
        expect(inAgreementAgeBand({ dateOfBirth: null, isDeclaredAdult: true }, now)).toBe(false);
        expect(inAgreementAgeBand({ dateOfBirth: null, isDeclaredAdult: false }, now)).toBe(false);
    });
});

describe("hasKnownAdultAge — the looser manual (board) rule", () => {
    const now = new Date("2026-08-02");

    it("accepts the over-25s the automatic band refuses — the board judges those itself", () => {
        expect(hasKnownAdultAge({ dateOfBirth: null, isDeclaredAdult: true }, now)).toBe(true);
        expect(hasKnownAdultAge({ dateOfBirth: yearsAgo(30), isDeclaredAdult: false }, now)).toBe(true);
    });

    it("still refuses a minor and an unknown age", () => {
        expect(hasKnownAdultAge({ dateOfBirth: yearsAgo(17), isDeclaredAdult: false }, now)).toBe(false);
        expect(hasKnownAdultAge({ dateOfBirth: null, isDeclaredAdult: false }, now)).toBe(false);
    });
});

describe("agreementCycleFloor — one agreement per cycle, no double-ask", () => {
    it("covers everything signed since the current cycle opened", () => {
        // Mid-cycle: boundary Sept 1, so the live cycle started 2025-09-01.
        const floor = agreementCycleFloor(BOUNDARY, new Date("2026-03-15"));
        expect(new Date("2026-01-10") >= floor).toBe(true); // signed in January — still covers
        expect(new Date("2025-03-01") >= floor).toBe(false); // last cycle — needs a fresh one
    });

    it("does not re-ask someone who signed during the run-up to the boundary", () => {
        // The regression this exists for: sign Aug 20, boundary rolls Sept 1, and a floor
        // set AT the boundary would ask them again two weeks later. Backing the floor off
        // by the renewal lead window (as runRenewalSweep does) keeps them covered.
        const signedAt = new Date("2026-08-20");
        const before = agreementCycleFloor(BOUNDARY, new Date("2026-08-25"));
        const after = agreementCycleFloor(BOUNDARY, new Date("2026-09-02"));
        expect(signedAt >= before).toBe(true);
        expect(signedAt >= after).toBe(true);
    });

    it("does ask again a year later", () => {
        const signedAt = new Date("2026-08-20");
        const nextCycle = agreementCycleFloor(BOUNDARY, new Date("2027-09-02"));
        expect(signedAt >= nextCycle).toBe(false);
    });

    it("advances by exactly one year across a boundary", () => {
        const before = agreementCycleFloor(BOUNDARY, new Date("2026-08-25"));
        const after = agreementCycleFloor(BOUNDARY, new Date("2026-09-02"));
        expect(after.getUTCFullYear() - before.getUTCFullYear()).toBe(1);
        expect(after.getUTCMonth()).toBe(before.getUTCMonth());
        expect(after.getUTCDate()).toBe(before.getUTCDate());
    });
});
