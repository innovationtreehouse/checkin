/**
 * @jest-environment node
 */
import { POST } from '@/app/api/membership-ops/participants/[id]/household/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { expectAuditRow, auditJson } from '@/test-helpers/expectAuditRow';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

describe('Admin Participant Household API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testParticipantId: number;
    let testHouseholdId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'household-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Household API Test' } }
        });

        const admin = await prisma.participant.create({
            data: { email: 'admin-household-api-test@example.com', name: 'Admin Test', isSysadmin: true, household: { create: {} } }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-household-api-test@example.com', name: 'User Test', household: { create: {} } }
        });
        testUserId = user.id;

        const household = await prisma.household.create({
            data: { name: 'Household API Test 1' }
        });
        testHouseholdId = household.id;
    });

    afterAll(async () => {
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'household-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Household API Test' } }
        });
    });

    beforeEach(async () => {
        const participant = await prisma.participant.create({
            data: { email: 'subject-household-api-test@example.com', name: 'Subject Test', household: { create: {} } }
        });
        testParticipantId = participant.id;
    });

    afterEach(async () => {
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { name: 'Subject Test' }
        });
    });

    describe('POST /api/membership-ops/participants/[id]/household', () => {
        it('should return 403 Forbidden for non-admin users', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId, isSysadmin: false, isBoardMember: false }
            });

            const req = new Request(`http://localhost:4000/api/membership-ops/participants/${testParticipantId}/household`, {
                method: 'POST',
                body: JSON.stringify({ householdId: testHouseholdId })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testParticipantId) }) });
            expect(res.status).toBe(403);
        });

        it('should successfully add a participant to an existing household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            const subjectBefore = await prisma.participant.findUnique({ where: { id: testParticipantId } });
            const priorHouseholdId = subjectBefore!.householdId;

            const req = new Request(`http://localhost:4000/api/membership-ops/participants/${testParticipantId}/household`, {
                method: 'POST',
                body: JSON.stringify({ householdId: testHouseholdId })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testParticipantId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.participant.householdId).toBe(testHouseholdId);

            const updatedParticipant = await prisma.participant.findUnique({ where: { id: testParticipantId } });
            expect(updatedParticipant?.householdId).toBe(testHouseholdId);

            // The move MUST be audited with the acting admin and the prior→new
            // household — the route's only record of who reassigned the person.
            const log = await expectAuditRow(prisma, { action: 'EDIT', tableName: 'Participant', affectedEntityId: testParticipantId });
            expect(log.actorId).toBe(testAdminId);
            expect(auditJson(log.oldData).householdId).toBe(priorHouseholdId);
            expect(auditJson(log.newData).householdId).toBe(testHouseholdId);
        });

        it('should successfully create a new household for the participant', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            const req = new Request(`http://localhost:4000/api/membership-ops/participants/${testParticipantId}/household`, {
                method: 'POST',
                body: JSON.stringify({ createNew: true })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testParticipantId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.participant.householdId).not.toBeNull();
            expect(data.participant.householdId).not.toBe(testHouseholdId);

            const newHouseholdId = data.participant.householdId;

            // Check if they are a lead
            const lead = await prisma.householdLead.findFirst({
                where: { personId: testParticipantId, householdId: newHouseholdId }
            });
            expect(lead).not.toBeNull();
        });
    });
});
