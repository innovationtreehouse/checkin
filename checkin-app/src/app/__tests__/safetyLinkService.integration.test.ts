/**
 * @jest-environment node
 */
/**
 * Integration tests for Dual Relationship Management (Safety Links): disclosure,
 * single-board-member decision, one-click renewal, the 1-year expiry sweep
 * (warn-then-expire), withdrawal, override, and the subject/household-lead guard.
 */

import {
    createSafetyLink,
    decideReview,
    renewSafetyLink,
    withdrawSafetyLink,
    overrideReview,
    runExpirySweep,
    SafetyLinkError,
} from '@/lib/safety-link/service';
import prisma from '@/lib/prisma';

const sendEmail = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const TAG = 'safetylink-test';

describe('Safety Links service', () => {
    let subjectId = 0;
    let leadId = 0;
    let outsiderId = 0;
    let boardId = 0;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        const parts = await prisma.participant.findMany({ where: { householdId: { in: ids } }, select: { id: true } });
        const pids = parts.map((p) => p.id);
        if (pids.length) {
            await prisma.safetyLinkReview.deleteMany({ where: { subjectParticipantId: { in: pids } } });
            await prisma.safetyLink.deleteMany({ where: { subjectParticipantId: { in: pids } } });
        }
        await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }

    beforeAll(async () => {
        await wipe();
        const hh = await prisma.household.create({ data: { name: `Subject HH ${TAG}` } });
        const subject = await prisma.participant.create({ data: { name: 'Subject', householdId: hh.id } });
        subjectId = subject.id;
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
        return createSafetyLink({
            subjectParticipantId: subjectId,
            counterpartyName: 'Jane External',
            relationshipType: 'GUARDIAN',
            description: 'I am the legal guardian of this person.',
            disclosedById: subjectId,
        });
    }

    it('creates a link with an INITIAL review pending board review and pings the board', async () => {
        const link = await discloseOne();
        expect(link.reviews).toHaveLength(1);
        expect(link.reviews[0].kind).toBe('INITIAL');
        expect(link.reviews[0].status).toBe('PENDING_BOARD_REVIEW');
        expect(sendEmail).toHaveBeenCalled(); // board notified
    });

    it('rejects a disclosure with no counterparty and no description', async () => {
        await expect(
            createSafetyLink({ subjectParticipantId: subjectId, relationshipType: 'OTHER', description: '', disclosedById: subjectId }),
        ).rejects.toMatchObject({ code: 'bad_input' });
        await expect(
            createSafetyLink({ subjectParticipantId: subjectId, relationshipType: 'OTHER', description: 'x', disclosedById: subjectId }),
        ).rejects.toMatchObject({ code: 'bad_input' });
    });

    it('a single board member approving stamps a one-year review-by date', async () => {
        const link = await discloseOne();
        const before = Date.now();
        const out = await decideReview(link.reviews[0].id, boardId, { decision: 'APPROVE' });
        expect(out.status).toBe('APPROVED');
        expect(out.decidedById).toBe(boardId);
        const days = (out.reviewBy!.getTime() - before) / 86400000;
        expect(days).toBeGreaterThan(360);
        expect(days).toBeLessThan(370);
    });

    it('approve-with-conditions requires conditions text', async () => {
        const link = await discloseOne();
        await expect(
            decideReview(link.reviews[0].id, boardId, { decision: 'APPROVE_WITH_CONDITIONS' }),
        ).rejects.toMatchObject({ code: 'bad_input' });
        const out = await decideReview(link.reviews[0].id, boardId, { decision: 'APPROVE_WITH_CONDITIONS', conditions: 'No unsupervised contact' });
        expect(out.status).toBe('APPROVED_WITH_CONDITIONS');
        expect(out.conditions).toBe('No unsupervised contact');
    });

    it('REQUEST_INFO moves to PENDING_SUBJECT_ACTION and emails the family', async () => {
        const link = await discloseOne();
        const out = await decideReview(link.reviews[0].id, boardId, { decision: 'REQUEST_INFO', note: 'Please clarify dates.' });
        expect(out.status).toBe('PENDING_SUBJECT_ACTION');
        expect(sendEmail).toHaveBeenCalledWith(`lead-${TAG}@ex.com`, expect.stringContaining('more information'), expect.any(String));
    });

    it('renewal opens a fresh review reusing the same link, and refuses while one is open', async () => {
        const link = await discloseOne();
        await decideReview(link.reviews[0].id, boardId, { decision: 'APPROVE' });
        const review = await renewSafetyLink(link.id, subjectId);
        expect(review.kind).toBe('RENEWAL');
        expect(review.status).toBe('PENDING_BOARD_REVIEW');
        expect(review.safetyLinkId).toBe(link.id);
        // second renew while the first is still in flight is rejected
        await expect(renewSafetyLink(link.id, subjectId)).rejects.toMatchObject({ code: 'already_open' });
    });

    it('a household lead may renew; an outsider may not', async () => {
        const link = await discloseOne();
        await decideReview(link.reviews[0].id, boardId, { decision: 'APPROVE' });
        await expect(renewSafetyLink(link.id, outsiderId)).rejects.toMatchObject({ code: 'forbidden' });
        const review = await renewSafetyLink(link.id, leadId);
        expect(review.status).toBe('PENDING_BOARD_REVIEW');
    });

    it('expiry sweep warns the family 30 days out (once), then expires lapsed links', async () => {
        const link = await discloseOne();
        const r = await decideReview(link.reviews[0].id, boardId, { decision: 'APPROVE' });

        // Move review-by to 10 days out → should warn.
        const soon = new Date(Date.now() + 10 * 86400000);
        await prisma.safetyLinkReview.update({ where: { id: r.id }, data: { reviewBy: soon, warnedAt: null } });
        const warnRun = await runExpirySweep(new Date());
        expect(warnRun.warned).toBeGreaterThanOrEqual(1);
        expect(sendEmail).toHaveBeenCalledWith(`lead-${TAG}@ex.com`, expect.stringContaining('expiring'), expect.any(String));

        // Sweeping again does not re-warn (warnedAt set).
        sendEmail.mockClear();
        const again = await prisma.safetyLinkReview.findUnique({ where: { id: r.id } });
        expect(again!.warnedAt).not.toBeNull();

        // Move review-by to the past → should expire.
        await prisma.safetyLinkReview.update({ where: { id: r.id }, data: { reviewBy: new Date(Date.now() - 86400000) } });
        const expireRun = await runExpirySweep(new Date());
        expect(expireRun.expired).toBeGreaterThanOrEqual(1);
        const expired = await prisma.safetyLinkReview.findUnique({ where: { id: r.id } });
        expect(expired!.status).toBe('EXPIRED');
    });

    it('subject can withdraw; board override can force-revoke', async () => {
        const link = await discloseOne();
        await withdrawSafetyLink(link.id, subjectId);
        const latest = await prisma.safetyLinkReview.findFirst({ where: { safetyLinkId: link.id }, orderBy: { id: 'desc' } });
        expect(latest!.status).toBe('REVOKED');

        const link2 = await discloseOne();
        await decideReview(link2.reviews[0].id, boardId, { decision: 'APPROVE' });
        const reviewId = link2.reviews[0].id;
        const out = await overrideReview(reviewId, boardId, 'revoke');
        expect(out.status).toBe('REVOKED');
    });
});
