/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Bulk Participant Import API
 * Tests CSV file uploads, parsing, household generation, and merging
 */

import { POST } from '@/app/api/admin/participants/import/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import * as xlsx from 'xlsx';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Admin Bulk Import API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'import-test' } }
        });
        await prisma.participant.deleteMany({
            where: { name: { contains: 'Import Test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Import Test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Household' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-import-test@example.com', name: 'Admin Import Test', sysadmin: true }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-import-test@example.com', name: 'User Import Test' }
        });
        testUserId = user.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'import-test' } }
        });
        await prisma.participant.deleteMany({
            where: { name: { contains: 'Import Test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Import Test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Household' } }
        });
    });

    afterEach(async () => {
        // Clean up participants created during tests
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'batch-import-test' } }
        });
        await prisma.participant.deleteMany({
            where: { name: { contains: 'Batch Import Test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Household' } }
        });
    });

    const createMockCsvFormData = (data: any[][]) => {
        const worksheet = xlsx.utils.aoa_to_sheet(data);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'csv' });
        
        const blob = new Blob([buffer], { type: 'text/csv' });
        const formData = new FormData();
        formData.append('file', blob, 'import.csv');
        return formData;
    };

    describe('POST /api/admin/participants/import', () => {
        it('should return 403 Forbidden for non-admin users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, sysadmin: false, boardMember: false }
             });

             const req = new Request('http://localhost:4000/api/admin/participants/import', {
                 method: 'POST',
             });

             const res = await POST(req as any);
             expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if no file is provided', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false }
            });

            const formData = new FormData();
            const req = new Request('http://localhost:4000/api/admin/participants/import', {
                method: 'POST',
                body: formData
            }) as any;
            req.formData = jest.fn().mockResolvedValue(formData);

            const res = await POST(req as any);
            expect(res.status).toBe(400);
            
            const data = await res.json();
            expect(data.error).toBe('No file provided');
        });

        it('should return 400 Bad Request if required columns are missing', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false }
            });

            // Missing Last Name column
            const formData = createMockCsvFormData([
                ['First Name', 'Email'],
                ['John', 'john@example.com']
            ]);

            const req = new Request('http://localhost:4000/api/admin/participants/import', {
                method: 'POST',
                body: formData
            }) as any;
            req.formData = jest.fn().mockResolvedValue(formData);

            const res = await POST(req as any);
            expect(res.status).toBe(400);
            
            const data = await res.json();
            expect(data.error).toContain("Missing required 'First Name' or 'Last Name' columns");
        });

        it('should successfully import a batch of new participants and link their households', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false }
            });

            const formData = createMockCsvFormData([
                ['First Name', 'Last Name', 'Email', 'Parent Email', 'Same Household As'],
                ['Alice', 'Batch Import Test', 'alice-batch-import-test@example.com', '', ''],
                ['Bob', 'Batch Import Test', '', 'alice-batch-import-test@example.com', ''], // Child of Alice using parent email
                ['Charlie', 'Batch Import Test', 'charlie-batch-import-test@example.com', '', 'Alice Batch Import Test'], // Adult in Alice's household using name reference
            ]);

            const req = new Request('http://localhost:4000/api/admin/participants/import', {
                method: 'POST',
                body: formData
            }) as any;
            req.formData = jest.fn().mockResolvedValue(formData);

            const res = await POST(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.message).toContain('3 participants');

            // Verify Alice
            const alice = await prisma.participant.findUnique({ where: { email: 'alice-batch-import-test@example.com' } });
            expect(alice).toBeDefined();
            expect(alice?.householdId).not.toBeNull();

            // Verify Bob
            const bob = await prisma.participant.findFirst({ where: { name: 'Bob Batch Import Test' } });
            expect(bob).toBeDefined();
            expect(bob?.householdId).toBe(alice?.householdId);

            // Verify Charlie
            const charlie = await prisma.participant.findUnique({ where: { email: 'charlie-batch-import-test@example.com' } });
            expect(charlie).toBeDefined();
            expect(charlie?.householdId).toBe(alice?.householdId);
        });

        it('should automatically create households for participants with no household links, and correctly assign lead status based on age', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false }
            });

            const formData = createMockCsvFormData([
                ['First Name', 'Last Name', 'DOB'],
                ['Adult', 'Import Test', '1990-01-01'],
                ['Minor', 'Import Test', '2015-01-01'],
                ['Default', 'Import Test', ''], 
            ]);

            const req = new Request('http://localhost:4000/api/admin/participants/import', {
                method: 'POST',
                body: formData
            }) as any;
            const res = await POST(req as any);
            expect(res.status).toBe(200);
            
            const adult = await prisma.participant.findFirst({ where: { name: 'Adult Import Test' } });
            expect(adult).not.toBeNull();
            expect(adult!.householdId).not.toBeNull();
            
            const adultLead = await prisma.householdLead.findFirst({ where: { participantId: adult!.id } });
            // In some environments, lead assignment might delay or fail if the household creation isn't atomic.
            // But here it should be present.
            expect(adultLead).not.toBeNull();

            const minor = await prisma.participant.findFirst({ where: { name: 'Minor Import Test' } });
            expect(minor).not.toBeNull();
            expect(minor!.householdId).not.toBeNull();
            const minorLead = await prisma.householdLead.findFirst({ where: { participantId: minor!.id } });
            expect(minorLead).toBeNull();

            const defaultAdult = await prisma.participant.findFirst({ where: { name: 'Default Import Test' } });
            expect(defaultAdult?.householdId).not.toBeNull();
            const defaultLead = await prisma.householdLead.findFirst({ where: { participantId: defaultAdult?.id } });
            expect(defaultLead).not.toBeNull();
        });
    });
});
