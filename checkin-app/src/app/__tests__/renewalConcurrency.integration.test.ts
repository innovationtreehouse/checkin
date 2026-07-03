/**
 * @jest-environment node
 */
/**
 * Concurrency test for renewal opening. runRenewalSweep (cron) and
 * openRenewalsForAllActive (admin button) both check-then-act through the shared
 * createRenewalProcess, and neither serializes the read+create. Across instances
 * two overlapping runs each read zero open processes and both reach the INSERT —
 * which would mint duplicate PENDING_RENEWAL rows (duplicate household reminders +
 * a dangling process beginRenewalForUser never advances). We drive that losing
 * branch directly: two concurrent createRenewalProcess calls (the read-guard
 * already passed). The partial unique index `membership_one_inflight_renewal` is
 * the guarantee — the loser's INSERT hits P2002, which createRenewalProcess
 * catches and turns into a clean no-op (returns null, no second audit row, no
 * second reminder). Drop the index and the second INSERT succeeds → this fails.
 */

import { createRenewalProcess } from '@/lib/membership/renewal';
import prisma from '@/lib/prisma';

const sendEmail = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const TAG = 'renewal-concurrency-test';

async function wipe() {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    if (ids.length) {
        await prisma.orgMembershipProcess.deleteMany({ where: { orgMembership: { householdId: { in: ids } } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
}

describe('renewal opening concurrency', () => {
    let orgMembershipId = 0;
    let householdId = 0;

    beforeAll(async () => {
        await wipe();
        const hh = await prisma.household.create({ data: { name: `Family ${TAG}` } });
        householdId = hh.id;
        const lead = await prisma.person.create({ data: { name: 'Lead', email: `lead-${TAG}@ex.com`, householdId: hh.id } });
        await prisma.householdLead.create({ data: { householdId: hh.id, personId: lead.id } });
        orgMembershipId = (await prisma.orgMembership.create({ data: { householdId: hh.id, status: 'ACTIVE' } })).id;
    });

    afterAll(wipe);

    it('two concurrent createRenewalProcess calls yield exactly one in-flight RENEWAL and one reminder', async () => {
        const now = new Date();
        const boundary = new Date();
        const results = await Promise.all([
            createRenewalProcess(orgMembershipId, householdId, now, { remind: true, boundary }),
            createRenewalProcess(orgMembershipId, householdId, now, { remind: true, boundary }),
        ]);

        // Exactly one create won; the other lost the race and no-op'd (null).
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(results.filter((r) => r === null)).toHaveLength(1);

        const inflight = await prisma.orgMembershipProcess.findMany({
            where: { orgMembershipId, kind: 'RENEWAL', status: { in: ['PENDING_RENEWAL', 'RENEWAL_PENDING_BG', 'PENDING_PAYMENT'] } },
            select: { id: true },
        });
        expect(inflight).toHaveLength(1); // the loser's P2002 no-op'd, not a second process

        // One lead → reminder sent exactly once (the duplicate send is skipped).
        expect(sendEmail).toHaveBeenCalledTimes(1);

        // Exactly one CREATE audit row for the winning process — no orphan from the loser.
        const created = await prisma.auditLog.count({
            where: { tableName: 'OrgMembershipProcess', action: 'CREATE', affectedEntityId: inflight[0].id },
        });
        expect(created).toBe(1);
    });
});
