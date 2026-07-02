/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Participants API
 * Tests POST (create participant with parent/household logic)
 */

import { POST } from '@/app/api/membership-ops/participants/route';
import { PUT } from '@/app/api/membership-ops/participants/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { expectAuditRow, auditJson } from '@/test-helpers/expectAuditRow';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

describe('Admin Participants API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'participants-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Test Household' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-participants-test@example.com', name: 'Admin Test', isSysadmin: true, household: { create: {} } }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-participants-test@example.com', name: 'User Test', household: { create: {} } }
        });
        testUserId = user.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'participants-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Test Household' } }
        });
    });

    afterEach(async () => {
        // Clean up participants created during tests
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'new-child-participants-test' } }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'new-lone-participants-test' } }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'new-parent-participants-test' } }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'edit-test-user' } }
        });
        await prisma.participant.deleteMany({
            where: { email: 'updated-email@example.com' }
        });
        // Only sweep households the deletions above emptied — the name filter
        // alone also matches other data's households, and the FK is RESTRICT.
        await prisma.household.deleteMany({
            where: { name: { contains: 'Household' }, participants: { none: {} } }
        });
    });

    describe('POST /api/membership-ops/participants', () => {
        it('should return 403 Forbidden for non-admin users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, isSysadmin: false, isBoardMember: false }
             });

             const req = new Request('http://localhost:4000/api/membership-ops/participants', {
                 method: 'POST',
                 body: JSON.stringify({ name: 'Test', email: 'test@example.com' })
             });

             const res = await POST(req as unknown as Parameters<typeof POST>[0]);
             expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if no email, parentEmail, or householdId is provided', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/participants', {
                method: 'POST',
                body: JSON.stringify({ name: 'Test No Email' })
            });

            const res = await POST(req as unknown as Parameters<typeof POST>[0]);
            expect(res.status).toBe(400);
            
            const data = await res.json();
            expect(data.error).toContain('Email, Parent Email, or Household assignment is required');
        });

        it('should return 400 Bad Request if email format is invalid', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/participants', {
                method: 'POST',
                body: JSON.stringify({ name: 'Test Invalid Email', email: 'invalid-email' })
            });

            const res = await POST(req as unknown as Parameters<typeof POST>[0]);
            expect(res.status).toBe(400);
            
            const data = await res.json();
            expect(data.error).toContain('Invalid email format');
        });

        it('should return 409 Conflict if participant with email already exists', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/participants', {
                method: 'POST',
                body: JSON.stringify({ name: 'Duplicate Email Test', email: 'admin-participants-test@example.com' })
            });

            const res = await POST(req as unknown as Parameters<typeof POST>[0]);
            expect(res.status).toBe(409);
            
            const data = await res.json();
            expect(data.error).toContain('already exists');
        });

        it('should create a lone participant and auto-generate a household for them', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/participants', {
                method: 'POST',
                body: JSON.stringify({ name: 'Lone Adult', email: 'new-lone-participants-test@example.com' })
            });

            const res = await POST(req as unknown as Parameters<typeof POST>[0]);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.participant.email).toBe('new-lone-participants-test@example.com');

            // The API returns the participant created BEFORE the household is linked since it does not refetch
            // We should just verify it exists in the DB correctly
            const updatedParticipant = await prisma.participant.findUnique({
                where: { id: data.participant.id }
            });
            expect(updatedParticipant?.householdId).not.toBeNull();
            // Verify the household was actually created
            const household = await prisma.household.findUnique({
                where: { id: updatedParticipant!.householdId! }
            });
            expect(household).toBeDefined();
            expect(household?.name).toBe('Adult Household');

            // D4.5: admin-created participants default to visitors (no membership)
            const membership = await prisma.membership.findUnique({
                where: { householdId: updatedParticipant!.householdId! }
            });
            expect(membership).toBeNull();
        });

        it('should grant an ACTIVE membership when alreadyMember is true', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/participants', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Paid Adult',
                    email: 'new-paid-participants-test@example.com',
                    alreadyMember: true
                })
            });

            const res = await POST(req as unknown as Parameters<typeof POST>[0]);
            expect(res.status).toBe(200);
            const data = await res.json();

            const created = await prisma.participant.findUnique({
                where: { id: data.participant.id }
            });
            const membership = await prisma.membership.findUnique({
                where: { householdId: created!.householdId! }
            });
            expect(membership?.status).toBe('ACTIVE');
        });

        it('should create a child participant and auto-generate a parent and household if parentEmail does not exist', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            const req = new Request('http://localhost:4000/api/membership-ops/participants', {
                method: 'POST',
                body: JSON.stringify({ 
                    name: 'Child User', 
                    email: 'new-child-participants-test@example.com',
                    parentEmail: 'new-parent-participants-test@example.com' 
                })
            });

            const res = await POST(req as unknown as Parameters<typeof POST>[0]);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.participant.email).toBe('new-child-participants-test@example.com');
            expect(data.participant.householdId).not.toBeNull();

            // Verify the parent was created
            const parent = await prisma.participant.findUnique({
                where: { email: 'new-parent-participants-test@example.com' }
            });
            expect(parent).toBeDefined();
            expect(parent?.householdId).toBe(data.participant.householdId);
        });
    });

    describe('PUT /api/membership-ops/participants/[id]', () => {
        it('should return 403 Forbidden for non-admin users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, isSysadmin: false, isBoardMember: false }
             });

             const req = new Request(`http://localhost:4000/api/membership-ops/participants/${testUserId}`, {
                 method: 'PUT',
                 body: JSON.stringify({ name: 'Hacked Name' })
             });

             const res = await PUT(req as unknown as Parameters<typeof PUT>[0], { params: Promise.resolve({ id: testUserId.toString() }) });
             expect(res.status).toBe(403);
        });

        it('should successfully update a participant name, email, and phone', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            // Create a disposable user just for this edit test
            const editUser = await prisma.participant.create({
                data: { email: 'edit-test-user@example.com', name: 'Original Name', household: { create: {} } }
            });

            const req = new Request(`http://localhost:4000/api/membership-ops/participants/${editUser.id}`, {
                method: 'PUT',
                body: JSON.stringify({ name: 'Updated Name', email: 'updated-email@example.com', phone: '5551234567' })
            });

            const res = await PUT(req as unknown as Parameters<typeof PUT>[0], { params: Promise.resolve({ id: editUser.id.toString() }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.participant.name).toBe('Updated Name');
            expect(data.participant.email).toBe('updated-email@example.com');
            // The route formats via formatPhone() before saving (dashed, not raw digits).
            expect(data.participant.phone).toBe('555-123-4567');

            // Verify the DB actually saved it
            const dbCheck = await prisma.participant.findUnique({ where: { id: editUser.id } });
            expect(dbCheck?.name).toBe('Updated Name');
            expect(dbCheck?.phone).toBe('555-123-4567');

            // PII edits MUST leave an audit trail naming the acting admin and the
            // before/after of the field — a regression dropping the actor or the
            // log fails right here.
            const log = await expectAuditRow(prisma, { action: 'EDIT', tableName: 'Participant', affectedEntityId: editUser.id });
            expect(log.actorId).toBe(testAdminId);
            expect(auditJson(log.oldData).name).toBe('Original Name');
            expect(auditJson(log.newData).name).toBe('Updated Name');

            // Cleanup is handled by afterEach
        });
    });
});
