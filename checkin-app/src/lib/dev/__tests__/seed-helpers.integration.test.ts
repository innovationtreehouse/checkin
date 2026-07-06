import prisma from "@/lib/prisma";
import {
    seedBaseline,
    createFamily,
    createProgram,
    createEvent,
    createCheckins,
} from "@/lib/dev/seed-helpers";

/**
 * Integration coverage for the dev seed/macro helpers + the reset truncate-and-reseed flow
 * (DEV_DASHBOARD_DESIGN.md §4–§5). Opt-in (*.integration.test.ts) — needs a live Postgres and is
 * DESTRUCTIVE (it truncates the public schema), so it is excluded from the default CI run. Run with
 * `npm run test:integration` against a throwaway dev database.
 */

// The same drift-proof truncation the reset action performs, factored here so the test exercises
// the real list-from-catalog behavior rather than a hand-written table list.
async function truncateAll() {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('_prisma_migrations', 'DevLedger')
    `;
    const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
    if (tables) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
}

describe("dev seed-helpers (integration)", () => {
    beforeAll(async () => {
        await truncateAll();
        await seedBaseline(prisma);
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it("seedBaseline creates the standard personas + sample program", async () => {
        const personas = await prisma.person.count();
        expect(personas).toBeGreaterThanOrEqual(9);
        expect(await prisma.program.count()).toBeGreaterThanOrEqual(1);
        expect(await prisma.person.findUnique({ where: { email: "boardmember@example.com" } })).not.toBeNull();
    });

    it("+ Family adds a household with a lead, a partner, and a youth", async () => {
        const before = await prisma.person.count();
        const summary = await createFamily(prisma);
        expect(summary).toMatch(/Test Family/);
        expect(await prisma.person.count()).toBe(before + 3);
        // The created household has exactly one lead.
        const household = await prisma.household.findFirst({
            where: { name: { startsWith: "Test Family" } },
            include: { householdMembers: true },
            orderBy: { id: "desc" },
        });
        expect(household?.householdMembers.filter((m) => m.isHouseholdLead).length).toBe(1);
        expect(household?.householdMembers.length).toBe(3);
    });

    it("+ Program adds a program with a fee and two participants", async () => {
        const summary = await createProgram(prisma);
        expect(summary).toMatch(/Test Program/);
        const program = await prisma.program.findFirst({
            where: { name: { startsWith: "Test Program" } },
            include: { fees: true, participants: true },
            orderBy: { id: "desc" },
        });
        expect(program?.fees.length).toBe(1);
        expect(program?.participants.length).toBe(2);
    });

    it("+ Event adds an event with RSVPs", async () => {
        const summary = await createEvent(prisma);
        expect(summary).toMatch(/Test Event/);
        const event = await prisma.event.findFirst({
            where: { name: { startsWith: "Test Event" } },
            include: { rsvps: true },
            orderBy: { id: "desc" },
        });
        expect(event?.rsvps.length).toBe(3);
    });

    it("+ Check-ins adds visits and badge events", async () => {
        const visitsBefore = await prisma.visit.count();
        const summary = await createCheckins(prisma);
        expect(summary).toMatch(/check-ins/);
        expect(await prisma.visit.count()).toBeGreaterThan(visitsBefore);
        expect(await prisma.rawBadgeLog.count()).toBeGreaterThan(0);
    });

    it("reset (truncate + reseed) clears macro data, restores baseline, and preserves the ledger", async () => {
        // A ledger row written before a reset must survive it (it is the cross-tester memory).
        await prisma.devLedger.create({
            data: { action: "login", realActor: "tester@innovationtreehouse.org", detail: "pre-reset" },
        });
        const ledgerBefore = await prisma.devLedger.count();

        await truncateAll();
        await seedBaseline(prisma);

        // Macro fixtures are gone…
        expect(await prisma.program.findFirst({ where: { name: { startsWith: "Test Program" } } })).toBeNull();
        expect(await prisma.household.findFirst({ where: { name: { startsWith: "Test Family" } } })).toBeNull();
        // …baseline is back…
        expect(await prisma.person.findUnique({ where: { email: "boardmember@example.com" } })).not.toBeNull();
        // …and the ledger survived the truncation.
        expect(await prisma.devLedger.count()).toBe(ledgerBefore);

        await prisma.devLedger.deleteMany({ where: { detail: "pre-reset" } });
    });
});
