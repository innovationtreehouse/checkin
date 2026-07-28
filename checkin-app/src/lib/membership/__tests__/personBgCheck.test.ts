import { bgFreshThreshold, personBgVerdict } from "@/lib/membership/personBgCheck";

// Boundary = Sept 1 2026. 12-month recheck → fresh cutoff Sept 1 2025.
const BOUNDARY = new Date(Date.UTC(2026, 8, 1));
const THRESHOLD = bgFreshThreshold(BOUNDARY, 12);

function verdict(person: Partial<{ dateOfBirth: Date | null; isDeclaredAdult: boolean; lastBackgroundCheck: Date | null }>) {
    return personBgVerdict(
        { dateOfBirth: null, isDeclaredAdult: false, lastBackgroundCheck: null, ...person },
        BOUNDARY,
        THRESHOLD,
    );
}

describe("bgFreshThreshold", () => {
    it("subtracts recheckMonths from the boundary", () => {
        expect(bgFreshThreshold(BOUNDARY, 12).toISOString()).toBe("2025-09-01T00:00:00.000Z");
    });
});

describe("personBgVerdict age gate (inclusive boundary)", () => {
    // Turns 18 the day before the boundary → ≥18 → NEEDED.
    it("Aug 31 birthday is in scope", () => {
        expect(verdict({ dateOfBirth: new Date(Date.UTC(2008, 7, 31)) })).toBe("NEEDED");
    });
    // Turns 18 exactly on the boundary → inclusive → in scope.
    it("Sept 1 birthday (exactly 18 on the boundary) is in scope", () => {
        expect(verdict({ dateOfBirth: new Date(Date.UTC(2008, 8, 1)) })).toBe("NEEDED");
    });
    // Turns 18 the day after the boundary → 17 as of boundary → out.
    it("Sept 2 birthday is out of scope (still 17 at the boundary)", () => {
        expect(verdict({ dateOfBirth: new Date(Date.UTC(2008, 8, 2)) })).toBe("MINOR");
    });
    it("a young child is a MINOR", () => {
        expect(verdict({ dateOfBirth: new Date(Date.UTC(2015, 0, 1)) })).toBe("MINOR");
    });
});

describe("personBgVerdict adult/freshness/data-hygiene", () => {
    it("isDeclaredAdult with no DOB is in scope (≥18)", () => {
        expect(verdict({ isDeclaredAdult: true })).toBe("NEEDED");
    });
    it("missing DOB and not declared adult → DOB_MISSING, never cleared or needed", () => {
        expect(verdict({})).toBe("DOB_MISSING");
    });
    it("adult with a check newer than the cutoff is FRESH", () => {
        expect(verdict({ isDeclaredAdult: true, lastBackgroundCheck: new Date(Date.UTC(2025, 9, 1)) })).toBe("FRESH");
    });
    it("adult with a check older than the cutoff is NEEDED", () => {
        expect(verdict({ isDeclaredAdult: true, lastBackgroundCheck: new Date(Date.UTC(2025, 7, 1)) })).toBe("NEEDED");
    });
    it("a fresh check does not rescue a MINOR (age gate wins)", () => {
        expect(verdict({ dateOfBirth: new Date(Date.UTC(2015, 0, 1)), lastBackgroundCheck: new Date(Date.UTC(2026, 0, 1)) })).toBe("MINOR");
    });
});

describe("as-of date drives the trigger (Trigger A boundary vs Trigger C activation)", () => {
    // Worked example: turns 18 on Nov 1 2026, takes a role Nov 15. The Sept-1-2026
    // annual boundary run (Trigger A) still sees a 17-year-old → MINOR, opens
    // nothing. A later new-member activation as-of Nov 20 (Trigger C) sees ≥18 →
    // NEEDED. Same person, opposite verdict, decided purely by the as-of date —
    // which is why role-assignment is NOT a trigger.
    const turns18Nov1 = { dateOfBirth: new Date(Date.UTC(2008, 10, 1)), isDeclaredAdult: false, lastBackgroundCheck: null };
    it("MINOR as of the annual boundary (Trigger A)", () => {
        const boundary = new Date(Date.UTC(2026, 8, 1));
        expect(personBgVerdict(turns18Nov1, boundary, bgFreshThreshold(boundary, 12))).toBe("MINOR");
    });
    it("NEEDED as of a later activation date (Trigger C)", () => {
        const activation = new Date(Date.UTC(2026, 10, 20));
        expect(personBgVerdict(turns18Nov1, activation, bgFreshThreshold(activation, 12))).toBe("NEEDED");
    });
});
