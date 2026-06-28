/**
 * @jest-environment node
 */
/**
 * Atomicity: every mutating trusted-adult op now writes its state change and its
 * audit row inside ONE prisma.$transaction. If the audit insert fails, the state
 * change must roll back with it — no granted/denied/revoked record left without
 * an audit trail.
 *
 * We force the audit insert to throw by wrapping the interactive transaction's
 * `tx` client so `tx.auditLog.create` blows up. Against the old non-transactional
 * code (state update + separate audit await) the update would already be
 * committed and these assertions would fail.
 */

import {
    createTrustedAdult,
    decideReview,
    withdrawTrustedAdult,
} from '@/lib/trusted-adult/service';
import prisma from '@/lib/prisma';

const sendEmail = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const TAG = 'trustedadult-atomicity-test';

/** Make `tx.auditLog.create` throw inside the real interactive transaction. */
function breakAuditInTransaction() {
    const realTransaction = prisma.$transaction.bind(prisma);
    const impl = (arg: unknown) => {
        if (typeof arg !== 'function') {
            return (realTransaction as (a: unknown) => unknown)(arg);
        }
        const fn = arg as (tx: unknown) => unknown;
        return (realTransaction as (cb: (tx: unknown) => unknown) => unknown)((tx) => {
            const proxy = new Proxy(tx as Record<string, unknown>, {
                get(target, prop) {
                    if (prop === 'auditLog') {
                        return { create: () => { throw new Error('forced audit failure'); } };
                    }
                    return target[prop as string];
                },
            });
            return fn(proxy);
        });
    };
    return jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(impl as unknown as typeof prisma.$transaction);
}

describe('Trusted Adults — mutation + audit are atomic', () => {
    let householdId = 0;
    let leadId = 0;
    let boardId = 0;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.trustedAdultReview.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.trustedAdult.deleteMany({ where: { householdId: { in: ids } } });
        }
        await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }

    beforeAll(async () => {
        await wipe();
        const hh = await prisma.household.create({ data: { name: `Family HH ${TAG}` } });
        householdId = hh.id;
        const lead = await prisma.participant.create({ data: { name: 'Lead', email: `lead-${TAG}@ex.com`, householdId: hh.id } });
        leadId = lead.id;
        await prisma.householdLead.create({ data: { householdId: hh.id, participantId: lead.id } });
        const boardHh = await prisma.household.create({ data: { name: `Board HH ${TAG}` } });
        boardId = (await prisma.participant.create({ data: { name: 'Boardie', boardMember: true, householdId: boardHh.id } })).id;
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    afterEach(() => jest.restoreAllMocks());

    async function discloseOne() {
        return createTrustedAdult({
            householdId,
            counterpartyName: 'Jane External',
            counterpartyContact: 'jane@example.com',
            familyContext: 'Our nanny; may collect the kids on weekdays.',
            disclosedById: leadId,
        });
    }

    it('decideReview: a failing audit rolls back the APPROVE — status stays PENDING_BOARD_REVIEW', async () => {
        const ta = await discloseOne();
        const reviewId = ta.reviews[0].id;

        const spy = breakAuditInTransaction();
        await expect(
            decideReview(reviewId, boardId, { decision: 'APPROVE', sharedNote: 'Grandma may pick up the kids.' }),
        ).rejects.toThrow('forced audit failure');
        spy.mockRestore();

        const after = await prisma.trustedAdultReview.findUnique({ where: { id: reviewId } });
        expect(after!.status).toBe('PENDING_BOARD_REVIEW'); // NOT APPROVED
        expect(after!.decision).toBeNull();
        expect(after!.reviewBy).toBeNull();
    });

    it('withdrawTrustedAdult: a failing audit rolls back the REVOKE — status stays PENDING_BOARD_REVIEW', async () => {
        const ta = await discloseOne();
        const reviewId = ta.reviews[0].id;

        const spy = breakAuditInTransaction();
        await expect(withdrawTrustedAdult(ta.id, leadId)).rejects.toThrow('forced audit failure');
        spy.mockRestore();

        const after = await prisma.trustedAdultReview.findUnique({ where: { id: reviewId } });
        expect(after!.status).toBe('PENDING_BOARD_REVIEW'); // NOT REVOKED
    });
});
