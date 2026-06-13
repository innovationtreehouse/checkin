/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/nav/todo-counts.
 *
 * Verifies the guiding rule of the nav badges: a count only includes items the
 * *viewer can resolve*. Member counts are scoped to the caller's household and
 * exclude board-owned states; the admin block appears only for board/sysadmin
 * and tallies the board's own queue.
 */

import { GET } from '@/app/api/nav/todo-counts/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

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
    const safetyLinkIds: number[] = [];

    const daysFromNow = (n: number) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + n);
        return d;
    };

    beforeAll(async () => {
        // Household A: a lead with a full slate of *member-actionable* todos, plus
        // one board-owned membership state that must NOT count for the member.
        const lead = await prisma.participant.create({
            data: { email: `lead-${TAG}@example.com`, name: 'Lead A', dob: new Date('1985-01-01'), household: { create: {} } },
        });
        leadId = lead.id;
        householdAId = lead.householdId;
        await prisma.householdLead.create({ data: { householdId: householdAId, participantId: leadId } });

        const second = await prisma.participant.create({
            data: { email: `member2-${TAG}@example.com`, name: 'Member A2', dob: new Date('1987-01-01'), householdId: householdAId },
        });
        secondMemberId = second.id;

        // Membership with one member-actionable process (PENDING_PAYMENT) and one
        // board-owned process (PENDING_BG_REVIEW).
        const membership = await prisma.membership.create({
            data: { householdId: householdAId, status: 'ACTIVE' },
        });
        membershipId = membership.id;
        await prisma.membershipProcess.create({ data: { membershipId, kind: 'INITIAL', status: 'PENDING_PAYMENT' } });
        await prisma.membershipProcess.create({ data: { membershipId, kind: 'INITIAL', status: 'PENDING_BG_REVIEW' } });

        // Safety links for the lead: one awaiting subject action, one approved and
        // expiring within the warn window.
        const slAction = await prisma.safetyLink.create({
            data: {
                subjectParticipantId: leadId,
                counterpartyName: 'Counterparty One',
                relationshipType: 'OTHER',
                description: 'needs info',
                disclosedById: leadId,
                reviews: { create: { subjectParticipantId: leadId, kind: 'INITIAL', status: 'PENDING_SUBJECT_ACTION' } },
            },
        });
        const slExpiring = await prisma.safetyLink.create({
            data: {
                subjectParticipantId: leadId,
                counterpartyName: 'Counterparty Two',
                relationshipType: 'OTHER',
                description: 'expiring soon',
                disclosedById: leadId,
                reviews: { create: { subjectParticipantId: leadId, kind: 'INITIAL', status: 'APPROVED', effectiveFrom: daysFromNow(-355), reviewBy: daysFromNow(10) } },
            },
        });
        safetyLinkIds.push(slAction.id, slExpiring.id);

        // Two pending program enrollments for household members. One has a payment
        // plan requested (the board's approval queue), one does not.
        const program1 = await prisma.program.create({ data: { name: `Prog1 ${TAG}` } });
        const program2 = await prisma.program.create({ data: { name: `Prog2 ${TAG}` } });
        program1Id = program1.id;
        program2Id = program2.id;
        await prisma.programParticipant.create({ data: { programId: program1Id, participantId: leadId, status: 'PENDING' } });
        await prisma.programParticipant.create({ data: { programId: program2Id, participantId: secondMemberId, status: 'PENDING', paymentPlanRequested: true } });

        // Household B: a board member with no household todos of their own.
        const board = await prisma.participant.create({
            data: { email: `board-${TAG}@example.com`, name: 'Board B', dob: new Date('1980-01-01'), phone: '555-0000', boardMember: true, household: { create: {} } },
        });
        boardId = board.id;
        householdBId = board.householdId;
    });

    afterAll(async () => {
        await prisma.safetyLinkReview.deleteMany({ where: { safetyLinkId: { in: safetyLinkIds } } });
        await prisma.safetyLink.deleteMany({ where: { id: { in: safetyLinkIds } } });
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
        // + expiring safety link (1) = 4. PENDING_BG_REVIEW is board-owned → excluded.
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
        expect(data.admin.membership).toBeGreaterThanOrEqual(1); // the PENDING_BG_REVIEW
        expect(data.admin.programsPending).toBeGreaterThanOrEqual(1); // payment-plan requested
        expect(data.admin.safetyLinks).toBeGreaterThanOrEqual(1); // the expiring approval
    });
});
