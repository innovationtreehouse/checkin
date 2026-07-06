/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Households API
 * Tests GET and POST /api/membership-ops/households for fetching and updating memberships
 */

import { GET, POST } from '@/app/api/membership-ops/households/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

describe('Admin Households API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testHousehold1Id: number;
    let testHousehold2Id: number;
    let testProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.programParticipant.deleteMany({
            where: { program: { name: { contains: 'Households API Test' } } }
        });
        await prisma.program.deleteMany({
            where: { name: { contains: 'Households API Test' } }
        });
        await prisma.orgMembership.deleteMany({});
        await prisma.person.deleteMany({
            where: { email: { contains: 'households-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Households API Test' } }
        });

        // Setup mock database records
        const admin = await prisma.person.create({
            data: { email: 'admin-households-api-test@example.com', name: 'Admin Households Test', isSysadmin: true, household: { create: {} } }
        });
        testAdminId = admin.id;

        const household1 = await prisma.household.create({
            data: { name: 'Households API Test 1' }
        });
        testHousehold1Id = household1.id;

        const household2 = await prisma.household.create({
            data: { name: 'Households API Test 2' }
        });
        testHousehold2Id = household2.id;

        // Add user to household 2 for search testing
        const user = await prisma.person.create({
            data: { email: 'user-households-api-test@example.com', name: 'User Households Test', householdId: testHousehold2Id }
        });
        testUserId = user.id;

        // Create an existing active membership for household 2
        await prisma.orgMembership.create({
            data: {
                householdId: testHousehold2Id,
                status: 'ACTIVE'
            }
        });

        // Enroll the household-2 member in a program so the single-household
        // (?id=) branch has an enrollment to surface for the detail view.
        const program = await prisma.program.create({
            data: { name: 'Households API Test Program' }
        });
        testProgramId = program.id;
        await prisma.programParticipant.create({
            data: { programId: testProgramId, personId: testUserId, status: 'ACTIVE' }
        });
    });

    afterAll(async () => {
        // Clean up — scope membership deletes to this test's households
        await prisma.programParticipant.deleteMany({
            where: { programId: testProgramId }
        });
        await prisma.program.deleteMany({
            where: { id: testProgramId }
        });
        await prisma.orgMembership.deleteMany({
            where: { householdId: { in: [testHousehold1Id, testHousehold2Id] } }
        });
        await prisma.person.deleteMany({
            where: { id: { in: [testAdminId, testUserId] } }
        });
        await prisma.household.deleteMany({
            where: { id: { in: [testHousehold1Id, testHousehold2Id] } }
        });
    });

    describe('GET /api/membership-ops/households', () => {
        it('should return 403 Forbidden without session or admin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, isSysadmin: false, isBoardMember: false }
             });

             const req = new Request('http://localhost:4000/api/membership-ops/households', { method: 'GET' });

             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(403);
        });

        it('should return all households when no query is provided', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/households', { method: 'GET' });

            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.households).toBeDefined();
            expect(Array.isArray(data.households)).toBe(true);
            
            const h1 = data.households.find((h: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => h.id === testHousehold1Id);
            const h2 = data.households.find((h: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => h.id === testHousehold2Id);
            expect(h1).toBeDefined();
            expect(h2).toBeDefined();
        });

        it('should filter households based on query', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            // Search by user email in household 2
            const req = new Request('http://localhost:4000/api/membership-ops/households?q=user-households-api-test', { method: 'GET' });

            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            const h2 = data.households.find((h: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => h.id === testHousehold2Id);
            const h1 = data.households.find((h: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => h.id === testHousehold1Id);
            
            expect(h2).toBeDefined();
            expect(h1).toBeUndefined(); // Should be filtered out
        });
    });

    describe('GET /api/membership-ops/households?id= (single household detail)', () => {
        it('returns each member with their program enrollments (name + status)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request(`http://localhost:4000/api/membership-ops/households?id=${testHousehold2Id}`, { method: 'GET' });

            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.household).toBeDefined();
            expect(data.household.id).toBe(testHousehold2Id);

            const member = data.household.householdMembers.find((m: { id: number }) => m.id === testUserId);
            expect(member).toBeDefined();
            expect(member.programParticipants).toHaveLength(1);
            expect(member.programParticipants[0].status).toBe('ACTIVE');
            expect(member.programParticipants[0].program.name).toBe('Households API Test Program');
        });

        it('returns an empty enrollment list for a member in no programs', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            // Household 1 has no members; add a bare person to assert the empty case.
            const loner = await prisma.person.create({
                data: { email: 'loner-households-api-test@example.com', name: 'Loner Households Test', householdId: testHousehold1Id }
            });

            const req = new Request(`http://localhost:4000/api/membership-ops/households?id=${testHousehold1Id}`, { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            const member = data.household.householdMembers.find((m: { id: number }) => m.id === loner.id);
            expect(member).toBeDefined();
            expect(member.programParticipants).toEqual([]);

            await prisma.person.deleteMany({ where: { id: loner.id } });
        });
    });

    describe('POST /api/membership-ops/households', () => {
        it('should return 403 Forbidden without session or admin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, isSysadmin: false }
             });

             const req = new Request('http://localhost:4000/api/membership-ops/households', {
                 method: 'POST',
                 body: JSON.stringify({ householdId: testHousehold1Id, active: true })
             });

             const res = await POST(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if householdId is missing', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/households', {
                method: 'POST',
                body: JSON.stringify({ active: true })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
        });

        it('should successfully activate membership for a household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/households', {
                method: 'POST',
                body: JSON.stringify({ householdId: testHousehold1Id, active: true })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.membership.status).toBe('ACTIVE');

            const membership = await prisma.orgMembership.findFirst({
                where: { householdId: testHousehold1Id, status: 'ACTIVE' }
            });
            expect(membership).toBeDefined();
        });

        it('should successfully deactivate membership for a household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/households', {
                method: 'POST',
                body: JSON.stringify({ householdId: testHousehold2Id, active: false })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);

            const activeMembership = await prisma.orgMembership.findFirst({
                where: { householdId: testHousehold2Id, status: 'ACTIVE' }
            });
            expect(activeMembership).toBeNull(); // Should be deactivated
        });
    });
});
