/**
 * @jest-environment node
 */
/**
 * Integration tests for Trusted Adult management: household-scoped disclosure,
 * single-board-member decision (approve requires the shared note), one-click
 * renewal, the 1-year expiry sweep (warn-then-expire), withdrawal, override, and
 * the household-lead guard.
 */

import {
    createTrustedAdult,
    decideReview,
    renewTrustedAdult,
    withdrawTrustedAdult,
    overrideReview,
    runExpirySweep,
} from '@/lib/trusted-adult/service';
import prisma from '@/lib/prisma';

const sendEmail = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const TAG = 'trustedadult-test';
const SHARED = 'Grandma may pick up the kids.';

describe('Trusted Adults service', () => {
    let householdId = 0;
    let leadId = 0;
    let outsiderId = 0;
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

        const outHh = await prisma.household.create({ data: { name: `Outsider HH ${TAG}` } });
        outsiderId = (await prisma.participant.create({ data: { name: 'Outsider', householdId: outHh.id } })).id;
        const boardHh = await prisma.household.create({ data: { name: `Board HH ${TAG}` } });
        boardId = (await prisma.participant.create({ data: { name: 'Boardie', boardMember: true, householdId: boardHh.id } })).id;
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    beforeEach(() => sendEmail.mockClear());

    async function discloseOne() {
        return createTrustedAdult({
            householdId,
            counterpartyName: 'Jane External',
            counterpartyContact: 'jane@example.com',
            familyContext: 'Our nanny; may collect the kids on weekdays.',
            disclosedById: leadId,
        });
    }

    it('creates a trusted adult with an INITIAL review pending board review and pings the board', async () => {
        const ta = await discloseOne();
        expect(ta.householdId).toBe(householdId);
        expect(ta.reviews).toHaveLength(1);
        expect(ta.reviews[0].kind).toBe('INITIAL');
        expect(ta.reviews[0].status).toBe('PENDING_BOARD_REVIEW');
        expect(sendEmail).toHaveBeenCalled(); // board notified
    });

    it('rejects a disclosure missing name, contact, or family context', async () => {
        await expect(
            createTrustedAdult({ householdId, counterpartyName: '', counterpartyContact: 'x', familyContext: 'x', disclosedById: leadId }),
        ).rejects.toMatchObject({ code: 'bad_input' });
        await expect(
            createTrustedAdult({ householdId, counterpartyName: 'x', counterpartyContact: '', familyContext: 'x', disclosedById: leadId }),
        ).rejects.toMatchObject({ code: 'bad_input' });
        await expect(
            createTrustedAdult({ householdId, counterpartyName: 'x', counterpartyContact: 'x', familyContext: '', disclosedById: leadId }),
        ).rejects.toMatchObject({ code: 'bad_input' });
    });

    it('approve requires a shared note, and stamps a one-year review-by date', async () => {
        const ta = await discloseOne();
        await expect(decideReview(ta.reviews[0].id, boardId, { decision: 'APPROVE' })).rejects.toMatchObject({ code: 'bad_input' });
        const before = Date.now();
        const out = await decideReview(ta.reviews[0].id, boardId, { decision: 'APPROVE', sharedNote: SHARED });
        expect(out.status).toBe('APPROVED');
        expect(out.decidedById).toBe(boardId);
        expect(out.sharedNote).toBe(SHARED);
        const days = (out.reviewBy!.getTime() - before) / 86400000;
        expect(days).toBeGreaterThan(360);
        expect(days).toBeLessThan(370);
    });

    it('REQUEST_INFO moves to PENDING_SUBJECT_ACTION and emails the family', async () => {
        const ta = await discloseOne();
        const out = await decideReview(ta.reviews[0].id, boardId, { decision: 'REQUEST_INFO', note: 'Please clarify dates.' });
        expect(out.status).toBe('PENDING_SUBJECT_ACTION');
        expect(sendEmail).toHaveBeenCalledWith(`lead-${TAG}@ex.com`, expect.stringContaining('more information'), expect.any(String));
    });

    it('renewal opens a fresh review reusing the same trusted adult, and refuses while one is open', async () => {
        const ta = await discloseOne();
        await decideReview(ta.reviews[0].id, boardId, { decision: 'APPROVE', sharedNote: SHARED });
        const review = await renewTrustedAdult(ta.id, leadId);
        expect(review.kind).toBe('RENEWAL');
        expect(review.status).toBe('PENDING_BOARD_REVIEW');
        expect(review.trustedAdultId).toBe(ta.id);
        await expect(renewTrustedAdult(ta.id, leadId)).rejects.toMatchObject({ code: 'already_open' });
    });

    it('only a household lead may renew; an outsider may not', async () => {
        const ta = await discloseOne();
        await decideReview(ta.reviews[0].id, boardId, { decision: 'APPROVE', sharedNote: SHARED });
        await expect(renewTrustedAdult(ta.id, outsiderId)).rejects.toMatchObject({ code: 'forbidden' });
        const review = await renewTrustedAdult(ta.id, leadId);
        expect(review.status).toBe('PENDING_BOARD_REVIEW');
    });

    it('expiry sweep warns the family 30 days out (once), then expires lapsed approvals', async () => {
        const ta = await discloseOne();
        const r = await decideReview(ta.reviews[0].id, boardId, { decision: 'APPROVE', sharedNote: SHARED });

        const soon = new Date(Date.now() + 10 * 86400000);
        await prisma.trustedAdultReview.update({ where: { id: r.id }, data: { reviewBy: soon, expiryWarningSentAt: null } });
        const warnRun = await runExpirySweep(new Date());
        expect(warnRun.warned).toBeGreaterThanOrEqual(1);
        expect(sendEmail).toHaveBeenCalledWith(`lead-${TAG}@ex.com`, expect.stringContaining('expiring'), expect.any(String));

        const again = await prisma.trustedAdultReview.findUnique({ where: { id: r.id } });
        expect(again!.expiryWarningSentAt).not.toBeNull();

        await prisma.trustedAdultReview.update({ where: { id: r.id }, data: { reviewBy: new Date(Date.now() - 86400000) } });
        const expireRun = await runExpirySweep(new Date());
        expect(expireRun.expired).toBeGreaterThanOrEqual(1);
        const expired = await prisma.trustedAdultReview.findUnique({ where: { id: r.id } });
        expect(expired!.status).toBe('EXPIRED');
    });

    it('a lead can withdraw; board override can force-revoke; force-approve needs a note', async () => {
        const ta = await discloseOne();
        await withdrawTrustedAdult(ta.id, leadId);
        const latest = await prisma.trustedAdultReview.findFirst({ where: { trustedAdultId: ta.id }, orderBy: { id: 'desc' } });
        expect(latest!.status).toBe('REVOKED');

        const ta2 = await discloseOne();
        const reviewId = ta2.reviews[0].id;
        await expect(overrideReview(reviewId, boardId, 'approve')).rejects.toMatchObject({ code: 'bad_input' });
        const approved = await overrideReview(reviewId, boardId, 'approve', SHARED);
        expect(approved.status).toBe('APPROVED');
        const revoked = await overrideReview(reviewId, boardId, 'revoke');
        expect(revoked.status).toBe('REVOKED');
    });
});
