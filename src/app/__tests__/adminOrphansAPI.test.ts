/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Orphans API
 * Tests GET /api/admin/orphans for identifying minors without signed-up adults
 */

import { GET } from '@/app/api/admin/orphans/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Admin Orphans API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testMinorNoHouseholdId: number;
    let testMinorHouseholdNoAdultsId: number;
    let testMinorHouseholdAdultNoGoogleIdId: number;
    let testMinorHouseholdAdultHasGoogleIdId: number;
    let testHousehold1Id: number;
    let testHousehold2Id: number;
    let testHousehold3Id: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.membership.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'orphans-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Orphans API Test' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-orphans-api-test@example.com', name: 'Admin Orphans Test', sysadmin: true }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-orphans-api-test@example.com', name: 'User Orphans Test', sysadmin: false }
        });
        testUserId = user.id;

        const now = new Date();
        const tenYearsAgo = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
        const twentyYearsAgo = new Date(now.getFullYear() - 20, now.getMonth(), now.getDate());

        // 1. Minor with no household
        const minor1 = await prisma.participant.create({
            data: { email: 'minor1-orphans-api-test@example.com', name: 'Minor No Household Test', dob: tenYearsAgo }
        });
        testMinorNoHouseholdId = minor1.id;

        // 2. Minor in a household with no adults
        const household1 = await prisma.household.create({ data: { name: 'Orphans API Test HH 1' } });
        testHousehold1Id = household1.id;
        const minor2 = await prisma.participant.create({
            data: { email: 'minor2-orphans-api-test@example.com', name: 'Minor HH No Adults Test', dob: tenYearsAgo, householdId: testHousehold1Id }
        });
        testMinorHouseholdNoAdultsId = minor2.id;
        // Another minor in the same household
        await prisma.participant.create({
            data: { email: 'minorsibling-orphans-api-test@example.com', name: 'Minor Sibling Test', dob: tenYearsAgo, householdId: testHousehold1Id }
        });

        // 3. Minor in a household with an adult who has NO googleId
        const household2 = await prisma.household.create({ data: { name: 'Orphans API Test HH 2' } });
        testHousehold2Id = household2.id;
        const minor3 = await prisma.participant.create({
            data: { email: 'minor3-orphans-api-test@example.com', name: 'Minor Adult No GoogleID Test', dob: tenYearsAgo, householdId: testHousehold2Id }
        });
        testMinorHouseholdAdultNoGoogleIdId = minor3.id;
        await prisma.participant.create({
            data: { email: 'adult1-orphans-api-test@example.com', name: 'Adult No GoogleID Test', dob: twentyYearsAgo, householdId: testHousehold2Id, googleId: null }
        });

        // 4. Minor in a household with an adult who HAS a googleId (NOT an orphan)
        const household3 = await prisma.household.create({ data: { name: 'Orphans API Test HH 3' } });
        testHousehold3Id = household3.id;
        const minor4 = await prisma.participant.create({
            data: { email: 'minor4-orphans-api-test@example.com', name: 'Minor Adult Has GoogleID Test', dob: tenYearsAgo, householdId: testHousehold3Id }
        });
        testMinorHouseholdAdultHasGoogleIdId = minor4.id;
        await prisma.participant.create({
            data: { email: 'adult2-orphans-api-test@example.com', name: 'Adult Has GoogleID Test', dob: twentyYearsAgo, householdId: testHousehold3Id, googleId: '123456789' }
        });
    });

    afterAll(async () => {
        // Clean up
        await prisma.membership.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'orphans-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { id: { in: [testHousehold1Id, testHousehold2Id, testHousehold3Id] } }
        });
    });

    describe('GET /api/admin/orphans', () => {
        it('should return 403 Forbidden without session or admin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, sysadmin: false, boardMember: false }
             });

             const req = new Request('http://localhost:4000/api/admin/orphans', { method: 'GET' });

             const res = await GET(req as any);
             expect(res.status).toBe(403);
        });

        it('should return the correct list of orphaned minors for admins', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/admin/orphans', { method: 'GET' });

            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.orphans).toBeDefined();
            expect(Array.isArray(data.orphans)).toBe(true);
            
            const orphanIds = data.orphans.map((o: any) => o.id);

            // Should be orphans
            expect(orphanIds).toContain(testMinorNoHouseholdId);
            expect(orphanIds).toContain(testMinorHouseholdNoAdultsId);
            expect(orphanIds).toContain(testMinorHouseholdAdultNoGoogleIdId);

            // Should NOT be an orphan
            expect(orphanIds).not.toContain(testMinorHouseholdAdultHasGoogleIdId);
        });
    });
});
