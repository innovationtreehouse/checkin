/**
 * @jest-environment node
 */
/**
 * Direct integration test for addHouseholdLead — the atomic household-lead cap
 * enforcer (issue #269).
 *
 * The function counts existing leads then creates, under a Household-row
 * FOR UPDATE lock taken first, so two concurrent promotions for the last slot
 * serialize: the second blocks on the lock, then sees the bumped count and is
 * rejected. Read Committed alone would let both count N and both insert,
 * overfilling past MAX_HOUSEHOLD_LEADS — only the explicit lock closes that
 * TOCTOU race. It's also idempotent (re-adding an existing lead is a no-op that
 * does NOT count against the cap) and dispatches between the prisma singleton
 * (opens its own tx) and an existing tx client (joins it).
 *
 * Production exercises this only transitively via the import + lead routes;
 * nothing hits the race the lock exists for directly. This suite does.
 *
 * (jest.setup.js gives this suite TEST_DB_POOL_MAX=2 so the two transactions
 * run on separate connections; the FOR UPDATE lock is then the only thing
 * serializing them, as in production.)
 */
import prisma from '@/lib/prisma';
import {
    addHouseholdLead,
    HouseholdLeadLimitError,
    MAX_HOUSEHOLD_LEADS,
} from '@/lib/household/leads';

const TAG = 'hh-lead-conc-test';

async function cleanup() {
    const users = await prisma.participant.findMany({
        where: { email: { contains: TAG } },
        select: { id: true, householdId: true },
    });
    const ids = users.map(u => u.id);
    const householdIds = [...new Set(users.map(u => u.householdId))];
    await prisma.householdLead.deleteMany({ where: { participantId: { in: ids } } });
    await prisma.participant.deleteMany({ where: { id: { in: ids } } });
    await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
}

/** Make a household with `existingLeads` leads already in place, plus `spares`
 *  non-lead participants ready to be promoted. Returns the ids. */
async function makeHousehold(label: string, existingLeads: number, spares: number) {
    const household = await prisma.household.create({
        data: { name: `${TAG} ${label}` },
    });
    const leadIds: number[] = [];
    for (let i = 0; i < existingLeads; i++) {
        const p = await prisma.participant.create({
            data: { email: `lead-${i}-${label}-${TAG}@example.com`, name: `Lead ${i}`, householdId: household.id },
        });
        await prisma.householdLead.create({ data: { householdId: household.id, participantId: p.id } });
        leadIds.push(p.id);
    }
    const spareIds: number[] = [];
    for (let i = 0; i < spares; i++) {
        const p = await prisma.participant.create({
            data: { email: `spare-${i}-${label}-${TAG}@example.com`, name: `Spare ${i}`, householdId: household.id },
        });
        spareIds.push(p.id);
    }
    return { householdId: household.id, leadIds, spareIds };
}

describe('addHouseholdLead (cap lock)', () => {
    beforeAll(cleanup);
    afterAll(cleanup);

    it('two concurrent adds for the last slot → exactly one wins, no overfill', async () => {
        // One slot left: MAX-1 leads already, two spares racing for it.
        const { householdId, spareIds } = await makeHousehold('race', MAX_HOUSEHOLD_LEADS - 1, 2);

        const results = await Promise.allSettled([
            addHouseholdLead(prisma, householdId, spareIds[0]),
            addHouseholdLead(prisma, householdId, spareIds[1]),
        ]);

        const fulfilled = results.filter(r => r.status === 'fulfilled');
        const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

        expect(fulfilled).toHaveLength(1);
        expect((fulfilled[0] as PromiseFulfilledResult<{ created: boolean }>).value).toEqual({ created: true });
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toBeInstanceOf(HouseholdLeadLimitError);

        const count = await prisma.householdLead.count({ where: { householdId } });
        expect(count).toBe(MAX_HOUSEHOLD_LEADS);
    });

    it('re-adding an existing lead is a no-op even at the cap', async () => {
        // Household already full; re-promote a participant who is already a lead.
        const { householdId, leadIds } = await makeHousehold('idem', MAX_HOUSEHOLD_LEADS, 0);
        const before = await prisma.householdLead.count({ where: { householdId } });
        expect(before).toBe(MAX_HOUSEHOLD_LEADS);

        const res = await addHouseholdLead(prisma, householdId, leadIds[0]);
        expect(res).toEqual({ created: false });

        const after = await prisma.householdLead.count({ where: { householdId } });
        expect(after).toBe(MAX_HOUSEHOLD_LEADS);
    });

    it('joins an outer transaction (rolled back with it) instead of opening its own', async () => {
        // Room for one more; add inside a tx that then throws. If the function
        // opened its own tx it would commit independently and survive the outer
        // rollback. Joining means the row dies with the outer tx.
        const { householdId, spareIds } = await makeHousehold('tx', MAX_HOUSEHOLD_LEADS - 1, 1);
        const sentinel = new Error('rollback');

        await expect(
            prisma.$transaction(async (tx) => {
                const res = await addHouseholdLead(tx, householdId, spareIds[0]);
                expect(res).toEqual({ created: true });
                // Visible inside the same tx before we bail.
                const inTx = await tx.householdLead.count({ where: { householdId } });
                expect(inTx).toBe(MAX_HOUSEHOLD_LEADS);
                throw sentinel;
            }),
        ).rejects.toBe(sentinel);

        // Rolled back with the outer tx → still at MAX-1, the add did not persist.
        const after = await prisma.householdLead.count({ where: { householdId } });
        expect(after).toBe(MAX_HOUSEHOLD_LEADS - 1);
    });
});
