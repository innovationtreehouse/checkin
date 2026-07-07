import { sharesHousehold, hasHouseholdConflict } from "@/lib/conflictOfInterest";
import type { DbClient } from "@/lib/db-client";

describe("sharesHousehold", () => {
    it("true only when both ids are present and equal", () => {
        expect(sharesHousehold(5, 5)).toBe(true);
        expect(sharesHousehold(5, 6)).toBe(false);
    });

    it("false when either side is null/undefined (no household ≠ shared household)", () => {
        expect(sharesHousehold(null, null)).toBe(false); // two people with no household don't conflict
        expect(sharesHousehold(undefined, 5)).toBe(false);
        expect(sharesHousehold(5, null)).toBe(false);
    });
});

describe("hasHouseholdConflict", () => {
    const db = (actorHouseholdId: number | null) =>
        ({ person: { findUnique: jest.fn().mockResolvedValue(actorHouseholdId == null ? null : { householdId: actorHouseholdId }) } }) as unknown as DbClient;

    it("conflict when the actor shares the subject's household", async () => {
        expect(await hasHouseholdConflict(db(3), 1, 3)).toBe(true);
    });

    it("no conflict when the actor is in a different household", async () => {
        expect(await hasHouseholdConflict(db(4), 1, 3)).toBe(false);
    });

    it("sysadmin always bypasses — no conflict, and no DB read", async () => {
        const client = db(3); // same household as subject → would conflict without the bypass
        expect(await hasHouseholdConflict(client, 1, 3, { isSysadmin: true })).toBe(false);
        expect((client.person.findUnique as jest.Mock)).not.toHaveBeenCalled();
    });

    it("no conflict when the subject has no household to conflict with", async () => {
        expect(await hasHouseholdConflict(db(3), 1, null)).toBe(false);
    });
});
