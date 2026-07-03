/**
 * @jest-environment node
 */
/**
 * Integration Tests for User Household API
 * Tests GET, POST, and PATCH /api/household for regular users managing their household
 */

import { GET, PATCH } from '@/app/api/household/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));
describe('Household API Integration Tests', () => {
    let testUserId: number;
    let testMemberId: number;
    let testOtherHouseUserId: number;
    let householdId: number;
    let otherHouseholdId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.person.findMany({
            where: { email: { contains: 'household-api-test' } },
            select: { id: true, householdId: true }
        });
        
        const existingUserIds = existingUsers.map(u => u.id);
        const existingHouseholdIds = existingUsers.map(u => u.householdId).filter(id => id !== null) as number[];
        
        await prisma.householdLead.deleteMany({
            where: { personId: { in: existingUserIds } }
        });
        
        await prisma.orgMembership.deleteMany({
            where: { householdId: { in: existingHouseholdIds } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });

        // RESTRICT: delete participants before their households
        await prisma.person.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        await prisma.household.deleteMany({
            where: { id: { in: existingHouseholdIds } }
        });

        // Setup mock database records
        const household = await prisma.household.create({
            data: { name: 'Lead User Household', line1: '123 Main' }
        });
        householdId = household.id;

        const leadUser = await prisma.person.create({
            data: { email: 'lead-user-household-api-test@example.com', name: 'Lead User', householdId: household.id }
        });
        testUserId = leadUser.id;

        await prisma.householdLead.create({
            data: { householdId: household.id, personId: leadUser.id }
        });

        const memberUser = await prisma.person.create({
            data: { email: 'member-user-household-api-test@example.com', name: 'Member User', householdId: household.id }
        });
        testMemberId = memberUser.id;

        const otherHousehold = await prisma.household.create({
            data: { name: 'Other Household' }
        });
        otherHouseholdId = otherHousehold.id;

        const otherUser = await prisma.person.create({
            data: { email: 'other-household-api-test@example.com', name: 'Other User', householdId: otherHousehold.id }
        });
        testOtherHouseUserId = otherUser.id;
    });

    afterAll(async () => {
        // Find trailing records created during test
        const newDobs = await prisma.person.findMany({
            where: { email: { contains: 'child-household-api-test' } },
            select: { id: true, householdId: true }
        });
        const currentIds = [testUserId, testMemberId, testOtherHouseUserId, ...(newDobs.map(u => u.id))];

        // Collect every household referenced by the test participants (incl. the no-house user's own household)
        const participants = await prisma.person.findMany({
            where: { id: { in: currentIds } },
            select: { householdId: true }
        });
        const validHouseholdIds = [...new Set([
            householdId,
            otherHouseholdId,
            ...participants.map(p => p.householdId)
        ])].filter((id): id is number => id !== undefined && id !== null);

        await prisma.householdLead.deleteMany({
            where: { personId: { in: currentIds } }
        });

        await prisma.orgMembership.deleteMany({
            where: { householdId: { in: validHouseholdIds } }
        });

        await prisma.auditLog.deleteMany({
            where: { actorId: { in: currentIds } }
        });

        // RESTRICT: delete participants before their households. Sweep by household
        // too, so members the API created without a tracked id/email (e.g. a 25+
        // member with no email) don't leave a dangling FK to a household below.
        await prisma.person.deleteMany({
            where: { OR: [{ id: { in: currentIds } }, { householdId: { in: validHouseholdIds } }] }
        });

        if (validHouseholdIds.length > 0) {
            await prisma.household.deleteMany({
                where: { id: { in: validHouseholdIds } }
            });
        }
    });

    describe('GET /api/household', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/household', { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(401);
        });

        it('should return household info if the user belongs to one', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request('http://localhost:4000/api/household', { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.household).toBeDefined();
            expect(data.household.id).toBe(householdId);
            expect(data.household.householdMembers.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('PATCH /api/household', () => {
        it('should return 401 without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'Child' })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(401);
        });

        it('should reject if the submitting user is not a lead', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testMemberId } });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'Child' })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe('Only household leads can add members');
        });

        it('should reject if trying to link an account already in another household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'T', memberEmail: 'other-household-api-test@example.com' })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('A user with this email already belongs to a household.');
        });

        it('should successfully add a new child record', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'New Child', memberEmail: 'new-child-household-api-test@example.com', memberDob: '2015-01-01' })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.member).toBeDefined();
            expect(data.member.name).toBe('New Child');

            // householdId is deliberately not on the wire (HOUSEHOLD_PEER_SELECT, M2
            // PII minimization) — verify the attachment directly against the DB instead.
            const created = await prisma.person.findUnique({ where: { id: data.member.id } });
            expect(created?.householdId).toBe(householdId);
        });

        it('should reject a new member with neither a DoB nor a 25+ declaration (400)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'No Age Given' })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toMatch(/Date of birth is required/);
        });

        it('should create a 25+ member without a DoB as a declared adult', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'Adult NoDob', memberOver25: true })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.member.isDeclaredAdult).toBe(true);
            expect(data.member.dateOfBirth).toBeNull();
        });

        it('should reject a staff (@innovationtreehouse.org) account adding a member (403)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId, hd: 'innovationtreehouse.org' }
            });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'Staff Cannot Add' })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toMatch(/Staff accounts cannot add household members/);
        });

        it('should allow a non-staff account to add a member', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId, email: 'lead-household-api-test@example.com' }
            });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'Non Staff Child', memberEmail: 'nonstaff-child-household-api-test@example.com', memberDob: '2015-01-01' })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.member.name).toBe('Non Staff Child');
        });
    });
});
