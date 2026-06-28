/**
 * @jest-environment node
 */
/**
 * Concurrency test for attest(): two reviewers attesting the same
 * MembershipProcess at the same time must serialize on the FOR UPDATE lock so
 * the process advances to payment exactly once (no double advance / double
 * background-date stamp). Regression guard for the TOCTOU race fixed in
 * lib/membership/review.ts.
 */

import { attest, ReviewError } from '@/lib/membership/review';
import prisma from '@/lib/prisma';

jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'review-concurrency-test';

/** A background-check reviewer in their own (distinct) household. */
async function makeReviewer(label: string): Promise<number> {
    const r = await prisma.participant.create({
        data: {
            email: `${label}-${TAG}@example.com`,
            name: label,
            backgroundCheckReviewer: true,
            household: { create: { name: `${label} HH ${TAG}` } },
        },
    });
    return r.id;
}

/** A fresh applicant household + membership + a process awaiting BG review. */
async function makePendingProcess(): Promise<number> {
    const hh = await prisma.household.create({ data: { name: `Applicant ${TAG}` } });
    const m = await prisma.membership.create({ data: { householdId: hh.id, status: 'NONE' } });
    const proc = await prisma.membershipProcess.create({
        data: { membershipId: m.id, kind: 'INITIAL', status: 'PENDING_BG_REVIEW' },
    });
    return proc.id;
}

async function wipe() {
    const hhs = await prisma.household.findMany({
        where: { OR: [{ name: { contains: TAG } }, { participants: { some: { email: { contains: TAG } } } }] },
        select: { id: true },
    });
    const ids = hhs.map((h) => h.id);
    if (ids.length) {
        await prisma.backgroundCheckAttestation.deleteMany({ where: { process: { membership: { householdId: { in: ids } } } } });
        await prisma.membershipProcess.deleteMany({ where: { membership: { householdId: { in: ids } } } });
        await prisma.membership.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.participant.deleteMany({ where: { email: { contains: TAG } } });
}

describe('attest() concurrency', () => {
    let revA: number, revB: number, revC: number;

    beforeAll(async () => {
        await wipe();
        revA = await makeReviewer('RevA');
        revB = await makeReviewer('RevB');
        revC = await makeReviewer('RevC');
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    it('two concurrent APPROVEs advance the process exactly once', async () => {
        const processId = await makePendingProcess();

        // One approval already on record; two more reviewers attest concurrently.
        // The invariant: regardless of interleaving, the process advances to payment
        // exactly once. Pre-fix, both could read 1 prior APPROVE, both compute
        // approvals === 2, and both call advanceToPayment (double background-date
        // stamp). The FOR UPDATE lock serializes them so the loser re-reads
        // PENDING_PAYMENT and bails with wrong_phase.
        await attest(revA, processId, { result: 'APPROVE' });

        const [b, c] = await Promise.allSettled([
            attest(revB, processId, { result: 'APPROVE' }),
            attest(revC, processId, { result: 'APPROVE' }),
        ]);

        const statuses = [b, c].map((r) => (r.status === 'fulfilled' ? (r.value as { status: string }).status : (r.reason as ReviewError).code));
        // Exactly one wins the advance; the other sees PENDING_PAYMENT and bails.
        expect(statuses.filter((s) => s === 'PENDING_PAYMENT')).toHaveLength(1);
        expect(statuses.filter((s) => s === 'wrong_phase')).toHaveLength(1);

        // The winner is whichever attest returned PENDING_PAYMENT — its id is what the advance audit must carry.
        const winner = b.status === 'fulfilled' && (b.value as { status: string }).status === 'PENDING_PAYMENT' ? revB : revC;

        const proc = await prisma.membershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe('PENDING_PAYMENT');

        // The loser created no attestation (it threw before the create): 2 total, not 3.
        const attestations = await prisma.backgroundCheckAttestation.count({ where: { processId } });
        expect(attestations).toBe(2);

        // advanceToPayment ran exactly once → exactly one PENDING_PAYMENT audit row, stamped with the winner's id.
        const audits = await prisma.auditLog.findMany({ where: { tableName: 'MembershipProcess', affectedEntityId: processId }, select: { newData: true, actorId: true } });
        const advances = audits.filter((a) => String(a.newData).includes('"status":"PENDING_PAYMENT"'));
        expect(advances).toHaveLength(1);
        expect(advances[0].actorId).toBe(winner); // not revA (prior approver) nor the loser
    });

    it('a REJECT audit carries the rejecting reviewer\'s id, not another reviewer\'s', async () => {
        const processId = await makePendingProcess();
        // revB rejects; revA never touches this process.
        await attest(revB, processId, { result: 'REJECT' });

        const blocked = await prisma.auditLog.findFirst({ where: { tableName: 'MembershipProcess', affectedEntityId: processId }, orderBy: { id: 'desc' } });
        expect(String(blocked?.newData)).toContain('"status":"BLOCKED"');
        expect(blocked?.actorId).toBe(revB);
        expect(blocked?.actorId).not.toBe(revA);
    });
});
