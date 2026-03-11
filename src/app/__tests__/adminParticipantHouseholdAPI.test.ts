/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
import { POST } from '@/app/api/admin/participants/[id]/household/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
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
            data: { email: 'admin-household-api-test@example.com', name: 'Admin Test', sysadmin: true }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-household-api-test@example.com', name: 'User Test' }
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
            data: { email: 'subject-household-api-test@example.com', name: 'Subject Test' }
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

    describe('POST /api/admin/participants/[id]/household', () => {
        it('should return 403 Forbidden for non-admin users', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId, sysadmin: false, boardMember: false }
            });

            const req = new Request(`http://localhost:4000/api/admin/participants/${testParticipantId}/household`, {
                method: 'POST',
                body: JSON.stringify({ householdId: testHouseholdId })
            });

            const res = await POST(req as any, { params: Promise.resolve({ id: String(testParticipantId) }) });
            expect(res.status).toBe(403);
        });

        it('should successfully add a participant to an existing household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false }
            });

            const req = new Request(`http://localhost:4000/api/admin/participants/${testParticipantId}/household`, {
                method: 'POST',
                body: JSON.stringify({ householdId: testHouseholdId })
            });

            const res = await POST(req as any, { params: Promise.resolve({ id: String(testParticipantId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.participant.householdId).toBe(testHouseholdId);

            const updatedParticipant = await prisma.participant.findUnique({ where: { id: testParticipantId } });
            expect(updatedParticipant?.householdId).toBe(testHouseholdId);
        });

        it('should successfully create a new household for the participant', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false }
            });

            const req = new Request(`http://localhost:4000/api/admin/participants/${testParticipantId}/household`, {
                method: 'POST',
                body: JSON.stringify({ createNew: true })
            });

            const res = await POST(req as any, { params: Promise.resolve({ id: String(testParticipantId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.participant.householdId).not.toBeNull();
            expect(data.participant.householdId).not.toBe(testHouseholdId);

            const newHouseholdId = data.participant.householdId;

            // Check if they are a lead
            const lead = await prisma.householdLead.findFirst({
                where: { participantId: testParticipantId, householdId: newHouseholdId }
            });
            expect(lead).not.toBeNull();
        });
    });
});
