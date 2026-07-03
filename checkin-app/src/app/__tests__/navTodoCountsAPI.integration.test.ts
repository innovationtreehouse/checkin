/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/nav/todo-counts.
 *
 * Verifies the guiding rule of the nav badges: a count only includes items the
 * *viewer can resolve*. Member counts are scoped to the caller's household and
 * exclude reviewer/board states; the admin block appears only for board/isSysadmin
 * and tallies the board's own queue. The board's only actionable membership
 * state is BLOCKED — the background-check review states (PENDING_BG_REVIEW /
 * RENEWAL_PENDING_BG) are reviewer (RBAC) work and must NOT count for the board.
 */

import { GET } from '@/app/api/nav/todo-counts/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { ORG_DOMAIN } from '@/lib/config';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

const TAG = 'nav-todo-counts-test';

describe('Nav todo-counts API', () => {
    let leadId: number;
    let secondMemberId: number;
    let boardId: number;
    let householdAId: number;
    let householdBId: number;
    let orgMembershipId: number;
    let program1Id: number;
    let program2Id: number;
    let ledProgramId: number;
    let pendingEventId: number;
    let confirmedEventId: number;
    let futureEventId: number;
    const trustedAdultIds: number[] = [];

    const daysFromNow = (n: number) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + n);
        return d;
    };

    beforeAll(async () => {
        // Household A: a lead with a full slate of *member-actionable* todos, plus
        // one reviewer-owned membership state that must NOT count for the member.
        const lead = await prisma.person.create({
            data: { email: `lead-${TAG}@example.com`, name: 'Lead A', dateOfBirth: new Date('1985-01-01'), phone: '555-0001', household: { create: {} } },
        });
        leadId = lead.id;
        householdAId = lead.householdId;
        await prisma.householdLead.create({ data: { householdId: householdAId, personId: leadId } });

        const second = await prisma.person.create({
            data: { email: `member2-${TAG}@example.com`, name: 'Member A2', dateOfBirth: new Date('1987-01-01'), householdId: householdAId },
        });
        secondMemberId = second.id;

        // Membership with one member-actionable process (PENDING_PAYMENT) and one
        // reviewer-owned process (PENDING_BG_REVIEW).
        const membership = await prisma.orgMembership.create({
            data: { householdId: householdAId, status: 'ACTIVE' },
        });
        orgMembershipId = membership.id;
        await prisma.orgMembershipProcess.create({ data: { orgMembershipId, kind: 'INITIAL', status: 'PENDING_PAYMENT' } });
        // Reviewer-owned state, kind RENEWAL (not INITIAL) so it doesn't collide with
        // the membership_one_inflight_initial partial unique index above — a
        // membership can hold only one in-flight INITIAL process at a time.
        await prisma.orgMembershipProcess.create({ data: { orgMembershipId, kind: 'RENEWAL', status: 'RENEWAL_PENDING_BG' } });

        // Trusted adults for the lead: one awaiting subject action, one approved and
        // expiring within the warn window.
        const slAction = await prisma.trustedAdult.create({
            data: {
                householdId: householdAId,
                trustedAdultName: 'Counterparty One',
                trustedAdultEmail: 'one@example.com',
                familyContext: 'needs info',
                disclosedById: leadId,
                reviews: { create: { householdId: householdAId, kind: 'INITIAL', status: 'PENDING_SUBJECT_ACTION' } },
            },
        });
        const slExpiring = await prisma.trustedAdult.create({
            data: {
                householdId: householdAId,
                trustedAdultName: 'Counterparty Two',
                trustedAdultEmail: 'two@example.com',
                familyContext: 'expiring soon',
                disclosedById: leadId,
                reviews: { create: { householdId: householdAId, kind: 'INITIAL', status: 'APPROVED', sharedNote: 'note', effectiveFrom: daysFromNow(-355), reviewBy: daysFromNow(10) } },
            },
        });
        // One awaiting board review — the board's own queue item.
        const slPending = await prisma.trustedAdult.create({
            data: {
                householdId: householdAId,
                trustedAdultName: 'Counterparty Three',
                trustedAdultEmail: 'three@example.com',
                familyContext: 'pending board review',
                disclosedById: leadId,
                reviews: { create: { householdId: householdAId, kind: 'INITIAL', status: 'PENDING_BOARD_REVIEW' } },
            },
        });
        trustedAdultIds.push(slAction.id, slExpiring.id, slPending.id);

        // Two pending program enrollments for household members. One has a payment
        // plan requested (the board's approval queue), one does not.
        const program1 = await prisma.program.create({ data: { name: `Prog1 ${TAG}` } });
        const program2 = await prisma.program.create({ data: { name: `Prog2 ${TAG}` } });
        program1Id = program1.id;
        program2Id = program2.id;
        await prisma.programParticipant.create({ data: { programId: program1Id, personId: leadId, status: 'PENDING' } });
        await prisma.programParticipant.create({ data: { programId: program2Id, personId: secondMemberId, status: 'PENDING', isPaymentPlanRequested: true } });

        // The lead also *runs* a program (leadMentorId). Three events: one ended
        // and unconfirmed (the inbox item), one ended but already confirmed, one
        // still in the future. Only the first should surface in the lead bucket.
        const ledProgram = await prisma.program.create({ data: { name: `Led ${TAG}`, leadMentorId: leadId } });
        ledProgramId = ledProgram.id;
        const pendingEvent = await prisma.event.create({
            data: { programId: ledProgramId, name: `Pending ${TAG}`, startAt: daysFromNow(-1), endAt: daysFromNow(-1) },
        });
        pendingEventId = pendingEvent.id;
        const confirmedEvent = await prisma.event.create({
            data: { programId: ledProgramId, name: `Confirmed ${TAG}`, startAt: daysFromNow(-2), endAt: daysFromNow(-2), attendanceConfirmedAt: new Date() },
        });
        confirmedEventId = confirmedEvent.id;
        const futureEvent = await prisma.event.create({
            data: { programId: ledProgramId, name: `Future ${TAG}`, startAt: daysFromNow(3), endAt: daysFromNow(3) },
        });
        futureEventId = futureEvent.id;

        // Household B: a board member with no household todos of their own.
        const board = await prisma.person.create({
            data: { email: `board-${TAG}@example.com`, name: 'Board B', dateOfBirth: new Date('1980-01-01'), phone: '555-0000', isBoardMember: true, household: { create: {} } },
        });
        boardId = board.id;
        householdBId = board.householdId;
    });

    afterAll(async () => {
        await prisma.trustedAdultReview.deleteMany({ where: { trustedAdultId: { in: trustedAdultIds } } });
        await prisma.trustedAdult.deleteMany({ where: { id: { in: trustedAdultIds } } });
        await prisma.programParticipant.deleteMany({ where: { programId: { in: [program1Id, program2Id] } } });
        await prisma.event.deleteMany({ where: { id: { in: [pendingEventId, confirmedEventId, futureEventId] } } });
        await prisma.program.deleteMany({ where: { id: { in: [program1Id, program2Id, ledProgramId] } } });
        await prisma.orgMembershipProcess.deleteMany({ where: { orgMembershipId } });
        await prisma.orgMembership.deleteMany({ where: { id: orgMembershipId } });
        await prisma.householdLead.deleteMany({ where: { householdId: householdAId } });
        await prisma.person.deleteMany({ where: { id: { in: [leadId, secondMemberId, boardId] } } });
        await prisma.household.deleteMany({ where: { id: { in: [householdAId, householdBId] } } });
    });

    const callAs = async (user: object | null) => {
        (getServerSession as jest.Mock).mockResolvedValue(user === null ? null : { user });
        const req = new Request('http://localhost:4000/api/nav/todo-counts', { method: 'GET' });
        return GET(req as unknown as import('next/server').NextRequest);
    };

    it('returns 401 without a session', async () => {
        const res = await callAs(null);
        expect(res.status).toBe(401);
    });

    it('sums only member-actionable household todos and excludes board-owned states', async () => {
        const res = await callAs({ id: leadId, householdId: householdAId });
        expect(res.status).toBe(200);
        const data = await res.json();
        // emergency contact (1) + PENDING_PAYMENT (1) + PENDING_SUBJECT_ACTION (1)
        // + expiring trusted adult (1) = 4. RENEWAL_PENDING_BG is reviewer-owned → excluded.
        expect(data.member.household).toHaveLength(4);
        expect(data.member.programs).toHaveLength(2);
        // Items carry a label + a deep link so the UI can show *what* is due.
        expect(data.member.household).toEqual(
            expect.arrayContaining([expect.objectContaining({ label: 'Pay your membership dues', href: '/membership' })]),
        );
    });

    it('surfaces a lead bucket with only ended-and-unconfirmed attendance', async () => {
        const res = await callAs({ id: leadId, householdId: householdAId });
        const data = await res.json();
        expect(data.lead).toBeDefined();
        const led = data.lead.programs.find((p: { id: number }) => p.id === ledProgramId);
        expect(led).toBeDefined();
        // Only the ended-unconfirmed event — confirmed and future events excluded.
        expect(led.pending).toHaveLength(1);
        expect(led.pending[0]).toEqual(
            expect.objectContaining({ href: `/program-ops/sessions/${pendingEventId}?from=my-programs` }),
        );
    });

    it('omits the lead bucket for a caller who leads no program', async () => {
        const res = await callAs({ id: secondMemberId, householdId: householdAId });
        const data = await res.json();
        expect(data.lead).toBeUndefined();
    });

    it('omits the admin block for a non-admin caller', async () => {
        const res = await callAs({ id: leadId, householdId: householdAId });
        const data = await res.json();
        expect(data.admin).toBeUndefined();
    });

    it('surfaces a household todo for a member with no DoB and no 25+ declaration', async () => {
        const noAge = await prisma.person.create({
            data: { name: 'No Age M', householdId: householdAId },
        });
        try {
            const res = await callAs({ id: leadId, householdId: householdAId });
            const data = await res.json();
            expect(data.member.household).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: `member-age-${noAge.id}`, label: 'Add a date of birth for No Age M', href: '/my-household' }),
                ]),
            );
        } finally {
            await prisma.person.delete({ where: { id: noAge.id } });
        }
    });

    it('returns the board queue for a board member and no false household todos', async () => {
        const res = await callAs({ id: boardId, householdId: householdBId, isBoardMember: true });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.member.household).toHaveLength(0);
        expect(data.member.programs).toHaveLength(0);
        expect(data.admin).toBeDefined();
        // Global queues may hold other rows; assert our injected items are included.
        // membership = BLOCKED only (see delta test below); the seeded PENDING_BG_REVIEW
        // is reviewer work and no longer counts, so just assert it's a number.
        expect(typeof data.admin.membership).toBe('number');
        expect(data.admin.paymentPlanPending).toBeGreaterThanOrEqual(1); // payment-plan requested
        expect(data.admin.trustedAdults).toBeGreaterThanOrEqual(1); // the PENDING_BOARD_REVIEW review
        expect(typeof data.admin.unclaimedHouseholds).toBe('number'); // households with an unclaimed account
    });

    it('counts BLOCKED for the board but not the reviewer-owned review states', async () => {
        const boardMembershipCount = async () => {
            const res = await callAs({ id: boardId, householdId: householdBId, isBoardMember: true });
            const data = await res.json();
            return data.admin.membership as number;
        };
        const before = await boardMembershipCount();

        // Reviewer (RBAC) work — surfaced by the reviewer notifications badge, not the
        // board badge. Adding these must NOT move the board count. Anchored to a fresh
        // membership (householdB's, previously membership-less) rather than the shared
        // `orgMembershipId` — that one already holds an in-flight INITIAL and an in-flight
        // RENEWAL process from beforeAll, and membership_one_inflight_initial /
        // membership_one_inflight_renewal each allow only one per membership.
        const reviewerMembership = await prisma.orgMembership.create({ data: { householdId: householdBId, status: 'ACTIVE' } });
        const reviewerProcs = await prisma.$transaction([
            prisma.orgMembershipProcess.create({ data: { orgMembershipId: reviewerMembership.id, kind: 'INITIAL', status: 'PENDING_BG_REVIEW' } }),
            prisma.orgMembershipProcess.create({ data: { orgMembershipId: reviewerMembership.id, kind: 'RENEWAL', status: 'RENEWAL_PENDING_BG' } }),
        ]);
        expect(await boardMembershipCount()).toBe(before);

        // BLOCKED is the board's one actionable state (override/reset) → +1.
        const blocked = await prisma.orgMembershipProcess.create({ data: { orgMembershipId, kind: 'INITIAL', status: 'BLOCKED' } });
        expect(await boardMembershipCount()).toBe(before + 1);

        await prisma.orgMembershipProcess.deleteMany({ where: { id: { in: [...reviewerProcs.map((p) => p.id), blocked.id] } } });
        await prisma.orgMembership.delete({ where: { id: reviewerMembership.id } });
    });

    it('counts member families but excludes org-email-only (staff) households', async () => {
        const memberFamilies = async () => {
            const res = await callAs({ id: boardId, householdId: householdBId, isBoardMember: true });
            return (await res.json()).admin.memberFamilies as number;
        };
        const before = await memberFamilies();

        // Staff household: only an org-email participant → must NOT count.
        const staff = await prisma.person.create({
            data: { email: `staff-${TAG}@${ORG_DOMAIN}`, name: 'Staff', household: { create: {} } },
        });
        expect(await memberFamilies()).toBe(before);

        // Member family: a non-org email → +1.
        const member = await prisma.person.create({
            data: { email: `family-${TAG}@example.com`, name: 'Family', household: { create: {} } },
        });
        expect(await memberFamilies()).toBe(before + 1);

        await prisma.person.deleteMany({ where: { id: { in: [staff.id, member.id] } } });
        await prisma.household.deleteMany({ where: { id: { in: [staff.householdId, member.householdId] } } });
    });
});
