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
    let boardLeadId = 0; // board member who is ALSO a lead of householdId — the self-conflict actor

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

        // A board member who is also a lead of the disclosing household: overriding this
        // household's own review is a conflict of interest (force-approve Grandma for their kids).
        const boardLead = await prisma.participant.create({
            data: { name: 'BoardLead', email: `boardlead-${TAG}@ex.com`, boardMember: true, householdId: hh.id },
        });
        boardLeadId = boardLead.id;
        await prisma.householdLead.create({ data: { householdId: hh.id, participantId: boardLead.id } });

        const outHh = await prisma.household.create({ data: { name: `Outsider HH ${TAG}` } });
        outsiderId = (await prisma.participant.create({ data: { name: 'Outsider', householdId: outHh.id } })).id;
        const boardHh = await prisma.household.create({ data: { name: `Board HH ${TAG}` } });
        boardId = (await prisma.participant.create({ data: { name: 'Boardie', email: `board-${TAG}@ex.com`, boardMember: true, householdId: boardHh.id } })).id;
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    beforeEach(() => sendEmail.mockClear());

    // Newest audit row for a trusted adult. Each action appends one row keyed by the
    // TrustedAdult id, so "newest" is the row the just-run action wrote. Queries
    // prisma.auditLog directly so it survives the audit() write becoming transactional.
    const latestAudit = (taId: number) =>
        prisma.auditLog.findFirst({ where: { tableName: 'TrustedAdult', affectedEntityId: taId }, orderBy: { id: 'desc' } });

    async function discloseOne() {
        return createTrustedAdult({
            householdId,
            counterpartyName: 'Jane External',
            counterpartyEmail: 'jane@example.com',
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

        const audit = await latestAudit(ta.id);
        expect(audit?.actorId).toBe(leadId); // the disclosing lead, not SYSTEM_ACTOR
        expect(audit?.action).toBe('CREATE');
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ created: true, status: 'PENDING_BOARD_REVIEW' });
    });

    it('rejects a disclosure missing name, contact, or family context', async () => {
        await expect(
            createTrustedAdult({ householdId, counterpartyName: '', counterpartyEmail: 'x@y.com', familyContext: 'x', disclosedById: leadId }),
        ).rejects.toMatchObject({ code: 'bad_input' });
        await expect( // neither phone nor email
            createTrustedAdult({ householdId, counterpartyName: 'x', familyContext: 'x', disclosedById: leadId }),
        ).rejects.toMatchObject({ code: 'bad_input' });
        await expect( // malformed email
            createTrustedAdult({ householdId, counterpartyName: 'x', counterpartyEmail: 'nope', familyContext: 'x', disclosedById: leadId }),
        ).rejects.toMatchObject({ code: 'bad_input' });
        await expect(
            createTrustedAdult({ householdId, counterpartyName: 'x', counterpartyEmail: 'x@y.com', familyContext: '', disclosedById: leadId }),
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

        const audit = await latestAudit(ta.id);
        expect(audit?.actorId).toBe(boardId); // the deciding board member
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ status: 'APPROVED', decision: 'APPROVE' });
    });

    it('refuses a decider with a conflict of interest: own household, or being the counterparty', async () => {
        // Same household as the disclosure (the lead) — can't decide their own household's review.
        const ta = await discloseOne();
        await expect(decideReview(ta.reviews[0].id, leadId, { decision: 'APPROVE', sharedNote: SHARED }))
            .rejects.toMatchObject({ code: 'forbidden' });

        // Board member is the counterparty (the trusted adult themselves) — also blocked,
        // even though they live in a different household.
        const selfTa = await createTrustedAdult({
            householdId,
            counterpartyParticipantId: boardId,
            counterpartyName: 'Boardie',
            counterpartyEmail: 'boardie@example.com',
            familyContext: 'A board member who is also our trusted adult.',
            disclosedById: leadId,
        });
        await expect(decideReview(selfTa.reviews[0].id, boardId, { decision: 'DENY' }))
            .rejects.toMatchObject({ code: 'forbidden' });
    });

    it('REQUEST_INFO moves to PENDING_SUBJECT_ACTION and emails the family', async () => {
        const ta = await discloseOne();
        const out = await decideReview(ta.reviews[0].id, boardId, { decision: 'REQUEST_INFO', note: 'Please clarify dates.' });
        expect(out.status).toBe('PENDING_SUBJECT_ACTION');
        expect(sendEmail).toHaveBeenCalledWith(`lead-${TAG}@ex.com`, expect.stringContaining('more information'), expect.any(String));

        const audit = await latestAudit(ta.id);
        expect(audit?.actorId).toBe(boardId);
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ status: 'PENDING_SUBJECT_ACTION', decision: 'REQUEST_INFO' });
    });

    it('audit records the deciding/overriding board member on DENY and override-deny', async () => {
        const ta = await discloseOne();
        await decideReview(ta.reviews[0].id, boardId, { decision: 'DENY' });
        const denyAudit = await latestAudit(ta.id);
        expect(denyAudit?.actorId).toBe(boardId);
        expect(JSON.parse(String(denyAudit?.newData))).toMatchObject({ status: 'DENIED', decision: 'DENY' });

        const ta2 = await discloseOne();
        await overrideReview(ta2.reviews[0].id, boardId, 'deny');
        const overrideAudit = await latestAudit(ta2.id);
        expect(overrideAudit?.actorId).toBe(boardId);
        expect(JSON.parse(String(overrideAudit?.newData))).toMatchObject({ status: 'DENIED', override: 'deny' });
    });

    it('renewal opens a fresh review reusing the same trusted adult, and refuses while one is open', async () => {
        const ta = await discloseOne();
        await decideReview(ta.reviews[0].id, boardId, { decision: 'APPROVE', sharedNote: SHARED });
        const review = await renewTrustedAdult(ta.id, leadId);
        expect(review.kind).toBe('RENEWAL');
        expect(review.status).toBe('PENDING_BOARD_REVIEW');
        expect(review.trustedAdultId).toBe(ta.id);

        const audit = await latestAudit(ta.id);
        expect(audit?.actorId).toBe(leadId); // the renewing lead
        expect(audit?.action).toBe('CREATE');
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ renewal: review.id, status: 'PENDING_BOARD_REVIEW' });

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

        // The system, not a person, drives the nightly expiry transition.
        const audit = await latestAudit(ta.id);
        expect(audit?.actorId).toBe(0); // SYSTEM_ACTOR
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ status: 'EXPIRED' });
    });

    it('a lead can withdraw; board override can force-revoke; force-approve needs a note', async () => {
        const ta = await discloseOne();
        await withdrawTrustedAdult(ta.id, leadId);
        const latest = await prisma.trustedAdultReview.findFirst({ where: { trustedAdultId: ta.id }, orderBy: { id: 'desc' } });
        expect(latest!.status).toBe('REVOKED');

        const withdrawAudit = await latestAudit(ta.id);
        expect(withdrawAudit?.actorId).toBe(leadId); // the withdrawing lead
        expect(JSON.parse(String(withdrawAudit?.newData))).toMatchObject({ status: 'REVOKED' });

        const ta2 = await discloseOne();
        const reviewId = ta2.reviews[0].id;
        await expect(overrideReview(reviewId, boardId, 'approve')).rejects.toMatchObject({ code: 'bad_input' });
        const approved = await overrideReview(reviewId, boardId, 'approve', SHARED);
        expect(approved.status).toBe('APPROVED');
        const approveAudit = await latestAudit(ta2.id);
        expect(approveAudit?.actorId).toBe(boardId); // the overriding board member
        expect(JSON.parse(String(approveAudit?.newData))).toMatchObject({ status: 'APPROVED', override: 'approve' });

        const revoked = await overrideReview(reviewId, boardId, 'revoke');
        expect(revoked.status).toBe('REVOKED');
        const revokeAudit = await latestAudit(ta2.id);
        expect(revokeAudit?.actorId).toBe(boardId);
        expect(JSON.parse(String(revokeAudit?.newData))).toMatchObject({ status: 'REVOKED', override: 'revoke' });
    });

    // overrideReview's defining job: force a terminal state regardless of the review's
    // CURRENT phase (no phase guard, unlike decideReview). These pin that contract by
    // overriding reviews that are ALREADY terminal, and assert the audit oldData.status
    // reflects the prior terminal state — not a fresh PENDING one.

    it('override-revokes a LIVE APPROVED review and audits the prior APPROVED state', async () => {
        const ta = await discloseOne();
        await decideReview(ta.reviews[0].id, boardId, { decision: 'APPROVE', sharedNote: SHARED });

        const revoked = await overrideReview(ta.reviews[0].id, boardId, 'revoke');
        expect(revoked.status).toBe('REVOKED');

        const audit = await latestAudit(ta.id);
        expect(JSON.parse(String(audit?.oldData))).toMatchObject({ status: 'APPROVED' });
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ status: 'REVOKED', override: 'revoke' });
    });

    it('override-approves an already DENIED review and audits the prior DENIED state', async () => {
        const ta = await discloseOne();
        await decideReview(ta.reviews[0].id, boardId, { decision: 'DENY' });

        const approved = await overrideReview(ta.reviews[0].id, boardId, 'approve', SHARED);
        expect(approved.status).toBe('APPROVED');

        const audit = await latestAudit(ta.id);
        expect(JSON.parse(String(audit?.oldData))).toMatchObject({ status: 'DENIED' });
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ status: 'APPROVED', override: 'approve' });
    });

    it('re-overrides an already-overridden terminal review with no phase guard', async () => {
        const ta = await discloseOne();
        await overrideReview(ta.reviews[0].id, boardId, 'revoke'); // terminal: REVOKED

        // No wrong_phase / throw — board can flip a terminal review again.
        const reapproved = await overrideReview(ta.reviews[0].id, boardId, 'approve', SHARED);
        expect(reapproved.status).toBe('APPROVED');

        const audit = await latestAudit(ta.id);
        expect(JSON.parse(String(audit?.oldData))).toMatchObject({ status: 'REVOKED' });
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ status: 'APPROVED', override: 'approve' });
    });

    // Conflict of interest on the OVERRIDE path — mirrors decideReview's rule. A board
    // member who leads the disclosing household must not override its own review (they'd
    // force-approve their own trusted adult). Only a sysadmin is the remedy that bypasses.
    it('refuses a board member overriding their OWN household review, leaving DB + audit untouched', async () => {
        const ta = await discloseOne();
        const reviewId = ta.reviews[0].id;
        const before = await prisma.trustedAdultReview.findUnique({ where: { id: reviewId } });
        const auditBefore = await latestAudit(ta.id);

        await expect(overrideReview(reviewId, boardLeadId, 'approve', SHARED)).rejects.toMatchObject({ code: 'forbidden' });

        // State machine and audit log both unchanged — the rejected override wrote nothing.
        const after = await prisma.trustedAdultReview.findUnique({ where: { id: reviewId } });
        expect(after!.status).toBe(before!.status);
        expect(after!.decidedById).toBeNull();
        const auditAfter = await latestAudit(ta.id);
        expect(auditAfter?.id).toBe(auditBefore?.id); // no new audit row appended
    });

    it('allows a sysadmin to override their own household review (the deliberate remedy)', async () => {
        const ta = await discloseOne();
        // Same actor whose board role is conflicted, but acting AS sysadmin → bypass.
        const approved = await overrideReview(ta.reviews[0].id, boardLeadId, 'approve', SHARED, { isSysadmin: true });
        expect(approved.status).toBe('APPROVED');

        const audit = await latestAudit(ta.id);
        expect(audit?.actorId).toBe(boardLeadId);
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ status: 'APPROVED', override: 'approve' });
    });

    it('allows a cross-household board member to override (no conflict)', async () => {
        const ta = await discloseOne(); // householdId; boardId lives in a different household
        const revoked = await overrideReview(ta.reviews[0].id, boardId, 'revoke');
        expect(revoked.status).toBe('REVOKED');
    });
});

// Edge cases for the nightly expiry sweep. runExpirySweep returns DB-wide
// warned/expired counts, so these use exact === assertions — a loose >= would hide
// a sweep that double-counts or mis-targets. That exactness is safe only because no
// other APPROVED rows qualify during a run: this describe runs after the block
// above (whose afterAll already wiped its rows) and the seed creates no trusted
// adults, so the only qualifiers are the rows each test crafts under SWEEP_TAG.
describe('runExpirySweep edge cases', () => {
    const SWEEP_TAG = 'trustedadult-sweep-test';
    const DAY = 86400000;
    let householdId = 0;
    let leadId = 0;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: SWEEP_TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.trustedAdultReview.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.trustedAdult.deleteMany({ where: { householdId: { in: ids } } });
        }
        await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }

    // Create a review in any status with a chosen reviewBy — bypasses the service so
    // we can seed DENIED/REVOKED/PENDING rows the public API never produces directly.
    async function seedReview(
        status: 'APPROVED' | 'PENDING_BOARD_REVIEW' | 'DENIED' | 'REVOKED',
        reviewBy: Date | null,
        expiryWarningSentAt: Date | null = null,
    ) {
        const ta = await prisma.trustedAdult.create({
            data: {
                householdId,
                counterpartyName: `Sweep ${SWEEP_TAG}`,
                counterpartyEmail: 'sweep@example.com',
                familyContext: 'ctx',
                disclosedById: leadId,
            },
        });
        return prisma.trustedAdultReview.create({
            data: { householdId, trustedAdultId: ta.id, kind: 'INITIAL', status, reviewBy, expiryWarningSentAt },
        });
    }

    beforeAll(async () => {
        await wipe();
        const hh = await prisma.household.create({ data: { name: `Sweep HH ${SWEEP_TAG}` } });
        householdId = hh.id;
        const lead = await prisma.participant.create({ data: { name: 'SweepLead', email: `sweeplead-${SWEEP_TAG}@ex.com`, householdId: hh.id } });
        leadId = lead.id;
        await prisma.householdLead.create({ data: { householdId: hh.id, participantId: lead.id } });
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    // Each test crafts its own rows, so clear them (and the email spy) between tests.
    beforeEach(async () => {
        await prisma.trustedAdultReview.deleteMany({ where: { householdId } });
        await prisma.trustedAdult.deleteMany({ where: { householdId } });
        sendEmail.mockClear();
    });

    it('ignores non-APPROVED reviews even when reviewBy has passed', async () => {
        const now = new Date();
        const past = new Date(now.getTime() - 5 * DAY);
        const pending = await seedReview('PENDING_BOARD_REVIEW', past);
        const denied = await seedReview('DENIED', past);
        const revoked = await seedReview('REVOKED', past);

        const run = await runExpirySweep(now);
        expect(run.warned).toBe(0);
        expect(run.expired).toBe(0);
        expect(sendEmail).not.toHaveBeenCalled();

        for (const r of [pending, denied, revoked]) {
            const after = await prisma.trustedAdultReview.findUnique({ where: { id: r.id } });
            expect(after!.status).toBe(r.status); // untouched
            expect(after!.expiryWarningSentAt).toBeNull(); // no warn stamp
        }
    });

    it('warns once: a second sweep returns warned 0 and sends no second email', async () => {
        const now = new Date();
        const soon = new Date(now.getTime() + 10 * DAY); // inside the 30-day warn window, still future
        const r = await seedReview('APPROVED', soon);

        const first = await runExpirySweep(now);
        expect(first.warned).toBe(1);
        expect(first.expired).toBe(0);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(sendEmail).toHaveBeenCalledWith(`sweeplead-${SWEEP_TAG}@ex.com`, expect.stringContaining('expiring'), expect.any(String));
        const warned = await prisma.trustedAdultReview.findUnique({ where: { id: r.id } });
        expect(warned!.expiryWarningSentAt).not.toBeNull();

        sendEmail.mockClear();
        const second = await runExpirySweep(now);
        expect(second.warned).toBe(0); // guard holds
        expect(second.expired).toBe(0);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('expires at the boundary: reviewBy == now and reviewBy in the past both EXPIRE, never warn', async () => {
        const now = new Date();
        const atNow = await seedReview('APPROVED', new Date(now.getTime())); // reviewBy === now → lte:now, not gt:now
        const past = await seedReview('APPROVED', new Date(now.getTime() - 1 * DAY)); // already lapsed

        const run = await runExpirySweep(now);
        expect(run.warned).toBe(0); // boundary row expires, it does not get a fresh warning
        expect(run.expired).toBe(2);
        expect(sendEmail).not.toHaveBeenCalled();

        for (const r of [atNow, past]) {
            const after = await prisma.trustedAdultReview.findUnique({ where: { id: r.id } });
            expect(after!.status).toBe('EXPIRED');
            expect(after!.expiryWarningSentAt).toBeNull(); // expired, never warned
        }
    });
});
