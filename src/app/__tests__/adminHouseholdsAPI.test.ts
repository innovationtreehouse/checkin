/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Households API
 * Tests GET and POST /api/admin/households for fetching and updating memberships
 */

import { GET, POST } from '@/app/api/admin/households/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Admin Households API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testHousehold1Id: number;
    let testHousehold2Id: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.membership.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'households-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Households API Test' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-households-api-test@example.com', name: 'Admin Households Test', sysadmin: true }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-households-api-test@example.com', name: 'User Households Test' }
        });
        testUserId = user.id;

        const household1 = await prisma.household.create({
            data: { name: 'Households API Test 1' }
        });
        testHousehold1Id = household1.id;

        const household2 = await prisma.household.create({
            data: { name: 'Households API Test 2' }
        });
        testHousehold2Id = household2.id;
        
        // Add user to household 2 for search testing
        await prisma.participant.update({
            where: { id: testUserId },
            data: { householdId: testHousehold2Id }
        });

        // Create an existing membership for household 2
        await prisma.membership.create({
            data: {
                householdId: testHousehold2Id,
                type: 'HOUSEHOLD',
                active: true
            }
        });
    });

    afterAll(async () => {
        // Clean up
        await prisma.membership.deleteMany({});
        await prisma.participant.deleteMany({
            where: { id: { in: [testAdminId, testUserId] } }
        });
        await prisma.household.deleteMany({
            where: { id: { in: [testHousehold1Id, testHousehold2Id] } }
        });
    });

    describe('GET /api/admin/households', () => {
        it('should return 403 Forbidden without session or admin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, sysadmin: false, boardMember: false }
             });

             const req = new Request('http://localhost:4000/api/admin/households', { method: 'GET' });

             const res = await GET(req as any);
             expect(res.status).toBe(403);
        });

        it('should return all households when no query is provided', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/admin/households', { method: 'GET' });

            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.households).toBeDefined();
            expect(Array.isArray(data.households)).toBe(true);
            
            const h1 = data.households.find((h: any) => h.id === testHousehold1Id);
            const h2 = data.households.find((h: any) => h.id === testHousehold2Id);
            expect(h1).toBeDefined();
            expect(h2).toBeDefined();
        });

        it('should filter households based on query', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            // Search by user email in household 2
            const req = new Request('http://localhost:4000/api/admin/households?q=user-households-api-test', { method: 'GET' });

            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            const h2 = data.households.find((h: any) => h.id === testHousehold2Id);
            const h1 = data.households.find((h: any) => h.id === testHousehold1Id);
            
            expect(h2).toBeDefined();
            expect(h1).toBeUndefined(); // Should be filtered out
        });
    });

    describe('POST /api/admin/households', () => {
        it('should return 403 Forbidden without session or admin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, sysadmin: false }
             });

             const req = new Request('http://localhost:4000/api/admin/households', {
                 method: 'POST',
                 body: JSON.stringify({ householdId: testHousehold1Id, active: true })
             });

             const res = await POST(req as any);
             expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if householdId is missing', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/admin/households', {
                method: 'POST',
                body: JSON.stringify({ active: true })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(400);
        });

        it('should successfully activate membership for a household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/admin/households', {
                method: 'POST',
                body: JSON.stringify({ householdId: testHousehold1Id, active: true })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.membership.active).toBe(true);

            const membership = await prisma.membership.findFirst({
                where: { householdId: testHousehold1Id, active: true }
            });
            expect(membership).toBeDefined();
        });

        it('should successfully deactivate membership for a household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/admin/households', {
                method: 'POST',
                body: JSON.stringify({ householdId: testHousehold2Id, active: false })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);

            const activeMembership = await prisma.membership.findFirst({
                where: { householdId: testHousehold2Id, active: true }
            });
            expect(activeMembership).toBeNull(); // Should be deactivated
        });
    });
});
