/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/nav/todo-counts.
 *
 * Verifies the guiding rule of the nav badges: a count only includes items the
 * *viewer can resolve*. Member counts are scoped to the caller's household and
 * exclude reviewer/board states; the admin block appears only for board/sysadmin
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
    let membershipId: number;
    let program1Id: number;
    let program2Id: number;
    const trustedAdultIds: number[] = [];

    const daysFromNow = (n: number) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + n);
        return d;
    };

    beforeAll(async () => {
        // Household A: a lead with a full slate of *member-actionable* todos, plus
        // one reviewer-owned membership state that must NOT count for the member.
        const lead = await prisma.participant.create({
            data: { email: `lead-${TAG}@example.com`, name: 'Lead A', dob: new Date('1985-01-01'), phone: '555-0001', household: { create: {} } },
        });
        leadId = lead.id;
        householdAId = lead.householdId;
        await prisma.householdLead.create({ data: { householdId: householdAId, participantId: leadId } });

        const second = await prisma.participant.create({
            data: { email: `member2-${TAG}@example.com`, name: 'Member A2', dob: new Date('1987-01-01'), householdId: householdAId },
        });
        secondMemberId = second.id;

        // Membership with one member-actionable process (PENDING_PAYMENT) and one
        // reviewer-owned process (PENDING_BG_REVIEW).
        const membership = await prisma.membership.create({
            data: { householdId: householdAId, status: 'ACTIVE' },
        });
        membershipId = membership.id;
        await prisma.membershipProcess.create({ data: { membershipId, kind: 'INITIAL', status: 'PENDING_PAYMENT' } });
        await prisma.membershipProcess.create({ data: { membershipId, kind: 'INITIAL', status: 'PENDING_BG_REVIEW' } });

        // Trusted adults for the lead: one awaiting subject action, one approved and
        // expiring within the warn window.
        const slAction = await prisma.trustedAdult.create({
            data: {
                householdId: householdAId,
                counterpartyName: 'Counterparty One',
                counterpartyEmail: 'one@example.com',
                familyContext: 'needs info',
                disclosedById: leadId,
                reviews: { create: { householdId: householdAId, kind: 'INITIAL', status: 'PENDING_SUBJECT_ACTION' } },
            },
        });
        const slExpiring = await prisma.trustedAdult.create({
            data: {
                householdId: householdAId,
                counterpartyName: 'Counterparty Two',
                counterpartyEmail: 'two@example.com',
                familyContext: 'expiring soon',
                disclosedById: leadId,
                reviews: { create: { householdId: householdAId, kind: 'INITIAL', status: 'APPROVED', sharedNote: 'note', effectiveFrom: daysFromNow(-355), reviewBy: daysFromNow(10) } },
            },
        });
        // One awaiting board review — the board's own queue item.
        const slPending = await prisma.trustedAdult.create({
            data: {
                householdId: householdAId,
                counterpartyName: 'Counterparty Three',
                counterpartyEmail: 'three@example.com',
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
        await prisma.programParticipant.create({ data: { programId: program1Id, participantId: leadId, status: 'PENDING' } });
        await prisma.programParticipant.create({ data: { programId: program2Id, participantId: secondMemberId, status: 'PENDING', isPaymentPlanRequested: true } });

        // Household B: a board member with no household todos of their own.
        const board = await prisma.participant.create({
            data: { email: `board-${TAG}@example.com`, name: 'Board B', dob: new Date('1980-01-01'), phone: '555-0000', boardMember: true, household: { create: {} } },
        });
        boardId = board.id;
        householdBId = board.householdId;
    });

    afterAll(async () => {
        await prisma.trustedAdultReview.deleteMany({ where: { trustedAdultId: { in: trustedAdultIds } } });
        await prisma.trustedAdult.deleteMany({ where: { id: { in: trustedAdultIds } } });
        await prisma.programParticipant.deleteMany({ where: { programId: { in: [program1Id, program2Id] } } });
        await prisma.program.deleteMany({ where: { id: { in: [program1Id, program2Id] } } });
        await prisma.membershipProcess.deleteMany({ where: { membershipId } });
        await prisma.membership.deleteMany({ where: { id: membershipId } });
        await prisma.householdLead.deleteMany({ where: { householdId: householdAId } });
        await prisma.participant.deleteMany({ where: { id: { in: [leadId, secondMemberId, boardId] } } });
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
        // + expiring trusted adult (1) = 4. PENDING_BG_REVIEW is reviewer-owned → excluded.
        expect(data.member.household).toHaveLength(4);
        expect(data.member.programs).toHaveLength(2);
        // Items carry a label + a deep link so the UI can show *what* is due.
        expect(data.member.household).toEqual(
            expect.arrayContaining([expect.objectContaining({ label: 'Pay your membership dues', href: '/membership' })]),
        );
    });

    it('omits the admin block for a non-admin caller', async () => {
        const res = await callAs({ id: leadId, householdId: householdAId });
        const data = await res.json();
        expect(data.admin).toBeUndefined();
    });

    it('returns the board queue for a board member and no false household todos', async () => {
        const res = await callAs({ id: boardId, householdId: householdBId, boardMember: true });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.member.household).toHaveLength(0);
        expect(data.member.programs).toHaveLength(0);
        expect(data.admin).toBeDefined();
        // Global queues may hold other rows; assert our injected items are included.
        // membership = BLOCKED only (see delta test below); the seeded PENDING_BG_REVIEW
        // is reviewer work and no longer counts, so just assert it's a number.
        expect(typeof data.admin.membership).toBe('number');
        expect(data.admin.programsPending).toBeGreaterThanOrEqual(1); // payment-plan requested
        expect(data.admin.trustedAdults).toBeGreaterThanOrEqual(1); // the PENDING_BOARD_REVIEW review
        expect(typeof data.admin.unclaimedHouseholds).toBe('number'); // households with an unclaimed account
    });

    it('counts BLOCKED for the board but not the reviewer-owned review states', async () => {
        const boardMembershipCount = async () => {
            const res = await callAs({ id: boardId, householdId: householdBId, boardMember: true });
            const data = await res.json();
            return data.admin.membership as number;
        };
        const before = await boardMembershipCount();

        // Reviewer (RBAC) work — surfaced by the reviewer notifications badge, not the
        // board badge. Adding these must NOT move the board count.
        const reviewerProcs = await prisma.$transaction([
            prisma.membershipProcess.create({ data: { membershipId, kind: 'INITIAL', status: 'PENDING_BG_REVIEW' } }),
            prisma.membershipProcess.create({ data: { membershipId, kind: 'RENEWAL', status: 'RENEWAL_PENDING_BG' } }),
        ]);
        expect(await boardMembershipCount()).toBe(before);

        // BLOCKED is the board's one actionable state (override/reset) → +1.
        const blocked = await prisma.membershipProcess.create({ data: { membershipId, kind: 'INITIAL', status: 'BLOCKED' } });
        expect(await boardMembershipCount()).toBe(before + 1);

        await prisma.membershipProcess.deleteMany({ where: { id: { in: [...reviewerProcs.map((p) => p.id), blocked.id] } } });
    });

    it('counts member families but excludes org-email-only (staff) households', async () => {
        const memberFamilies = async () => {
            const res = await callAs({ id: boardId, householdId: householdBId, boardMember: true });
            return (await res.json()).admin.memberFamilies as number;
        };
        const before = await memberFamilies();

        // Staff household: only an org-email participant → must NOT count.
        const staff = await prisma.participant.create({
            data: { email: `staff-${TAG}@${ORG_DOMAIN}`, name: 'Staff', household: { create: {} } },
        });
        expect(await memberFamilies()).toBe(before);

        // Member family: a non-org email → +1.
        const member = await prisma.participant.create({
            data: { email: `family-${TAG}@example.com`, name: 'Family', household: { create: {} } },
        });
        expect(await memberFamilies()).toBe(before + 1);

        await prisma.participant.deleteMany({ where: { id: { in: [staff.id, member.id] } } });
        await prisma.household.deleteMany({ where: { id: { in: [staff.householdId, member.householdId] } } });
    });
});
