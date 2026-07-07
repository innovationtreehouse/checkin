/**
 * @jest-environment node
 */
/**
 * Integration Tests for General Attendance API
 * Tests GET, POST, and DELETE /api/attendance for managing check-ins and check-outs
 */

import { GET, POST, DELETE } from '@/app/api/attendance/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import * as verifyKiosk from '@/lib/verify-kiosk';

// Mock Kiosk util
jest.mock('@/lib/verify-kiosk', () => ({
    getKioskPublicKeys: jest.fn(),
    verifyKioskSignature: jest.fn()
}));

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
describe('General Attendance API Integration Tests', () => {
    let adminId: number;
    let commonId: number;
    let householdLeadId: number;
    let householdChildId: number;
    let boardMemberId: number;
    let keyholderId: number;

    let activeVisitId: number;
    let childActiveVisitId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.person.findMany({
            where: { email: { contains: 'attend-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.visit.deleteMany({
            where: { personId: { in: existingUserIds } }
        });

        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });

        // Capture households before participants are removed (RESTRICT requires
        // participants to be deleted before their household).
        const existingHouseholdIds = (await prisma.person.findMany({
            where: { id: { in: existingUserIds } },
            select: { householdId: true }
        })).map(p => p.householdId);

        await prisma.person.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        await prisma.household.deleteMany({
            where: { id: { in: existingHouseholdIds } }
        });

        await prisma.auditLog.deleteMany({
            where: { tableName: 'SYSTEM_NOTIFY' }
        });

        // Create Admin
        const admin = await prisma.person.create({
            data: { email: 'admin-attend-api-test@example.com', name: 'Admin', isSysadmin: true, household: { create: { name: "Test HH" } } }
        });
        adminId = admin.id;

        // Create Board Member
        const isBoardMember = await prisma.person.create({
            data: { email: 'board-attend-api-test@example.com', name: 'Board Member', isBoardMember: true, household: { create: { name: "Test HH" } } }
        });
        boardMemberId = isBoardMember.id;

        // Create Common User
        const commonUser = await prisma.person.create({
            data: { email: 'common-attend-api-test@example.com', name: 'Common', household: { create: { name: "Test HH" } } }
        });
        commonId = commonUser.id;

        // Create Household
        const household = await prisma.household.create({
            data: { name: 'Attend API Household Test' }
        });

        const householdLead = await prisma.person.create({
            data: { 
                email: 'lead-attend-api-test@example.com', 
                name: 'Household Lead',
                household: { connect: { id: household.id } },
                isHouseholdLead: true
            }
        });
        householdLeadId = householdLead.id;

        const householdChild = await prisma.person.create({
            data: { 
                email: 'child-attend-api-test@example.com', 
                name: 'Household Child',
                household: { connect: { id: household.id } }
            }
        });
        householdChildId = householdChild.id;

        // Keyholder present + checked in: the facility-open guard requires an
        // active keyholder before any non-keyholder MANUAL_CHECKIN succeeds.
        const keyholder = await prisma.person.create({
            data: { email: 'keyholder-attend-api-test@example.com', name: 'Keyholder', isKeyholder: true, household: { create: { name: "Test HH" } } }
        });
        keyholderId = keyholder.id;
        await prisma.visit.create({
            data: { personId: keyholderId, arrivedAt: new Date() }
        });

        // Create initial active visits
        const commonVisit = await prisma.visit.create({
            data: { personId: commonId, arrivedAt: new Date() }
        });
        activeVisitId = commonVisit.id;

        const childVisit = await prisma.visit.create({
            data: { personId: householdChildId, arrivedAt: new Date() }
        });
        childActiveVisitId = childVisit.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, commonId, householdLeadId, householdChildId, boardMemberId, keyholderId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.visit.deleteMany({
                where: { personId: { in: existingUserIds } }
            });
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });

            // RESTRICT: delete participants before their households.
            const existingHouseholdIds = (await prisma.person.findMany({
                where: { id: { in: existingUserIds } },
                select: { householdId: true }
            })).map(p => p.householdId);

            await prisma.person.deleteMany({
                where: { id: { in: existingUserIds } }
            });
            await prisma.household.deleteMany({
                where: { id: { in: existingHouseholdIds } }
            });
        }
        await prisma.auditLog.deleteMany({
            where: { tableName: 'SYSTEM_NOTIFY' }
        });
    });

    describe('GET /api/attendance', () => {
        it('should return 401 Unauthorized without session or Kiosk Signature when Kiosk checking is strict', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);
             
             // Mock Kiosk setup enforcing signatures
             (verifyKiosk.getKioskPublicKeys as jest.Mock).mockReturnValue([Buffer.from('mock-public-key')]);

             const req = new Request(`http://localhost:4000/api/attendance`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(401);
             
             jest.restoreAllMocks();
        });

        it('should reject invalid Kiosk signatures', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);
             
             (verifyKiosk.getKioskPublicKeys as jest.Mock).mockReturnValue([Buffer.from('mock-public-key')]);
             (verifyKiosk.verifyKioskSignature as jest.Mock).mockReturnValue({ ok: false, status: 403, error: 'Invalid signature' });

             const req = new Request(`http://localhost:4000/api/attendance`, { 
                 method: 'GET',
                 headers: new Headers({
                     'x-kiosk-signature': 'bad-signature',
                     'x-kiosk-timestamp': Date.now().toString()
                 })
             });
             const res = await GET(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(403);
             
             jest.restoreAllMocks();
        });

        it('should fetch active visits with an authenticated admin session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/attendance`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.access).toBe('full');
             expect(data.counts).toBeDefined();
             expect(data.counts.total).toBeGreaterThanOrEqual(2);
             // email is deliberately not returned on this route (M1 PII minimization) —
             // assert on name, the field the response actually carries.
             const names = data.attendance.map((v: { participant: { name: string } }) => v.participant.name);
             expect(names).toContain('Common');
             expect(names).toContain('Household Child');
        });
    });

    describe('POST /api/attendance (MANUAL_CHECKIN)', () => {
        it('should block a common user from checking in another user', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ type: 'MANUAL_CHECKIN', participantId: adminId })
             });
             const res = await POST(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should block checking in a user that is already checked in', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ type: 'MANUAL_CHECKIN', participantId: commonId }) // commonId is already checked in from beforeAll
             });
             const res = await POST(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(400);
             
             const data = await res.json();
             expect(data.error).toBe('User is already checked in');
        });

        it('should allow a Household Lead to check in a child from the same household', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: householdLeadId, householdId: 1, householdLead: true } });

             // Note: First we must clear the child's visit to simulate checking them back in
             await prisma.visit.update({ where: { id: childActiveVisitId }, data: { departedAt: new Date() } });

             const req = new Request(`http://localhost:4000/api/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ type: 'MANUAL_CHECKIN', participantId: householdChildId })
             });

             // We actually have to mock the user having the *correct* householdId matching the child in the DB
             // The mock user object should have the actual household.id
             const childRecord = await prisma.person.findUnique({ where: { id: householdChildId } });
             (getServerSession as jest.Mock).mockResolvedValue({ 
                 user: { id: householdLeadId, householdId: childRecord!.householdId, householdLead: true } 
             });

             const res = await POST(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.visit.personId).toBe(householdChildId);
        });

        it('should allow an admin to check in any user', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ type: 'MANUAL_CHECKIN', participantId: householdLeadId })
             });

             const res = await POST(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.visit.personId).toBe(householdLeadId);
        });
    });

    describe('POST /api/attendance (TWO_DEEP_VIOLATION)', () => {
        it('should broadcast a TWO_DEEP_VIOLATION to board members', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId } });

             const req = new Request(`http://localhost:4000/api/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ type: 'TWO_DEEP_VIOLATION', message: 'Only 1 adult is in the building!' })
             });

             const res = await POST(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.notified).toBeGreaterThanOrEqual(1); // There is 1 isBoardMember setup in beforeAll

             // Prove debounce log was created
             const logs = await prisma.auditLog.findMany({ where: { tableName: 'SYSTEM_NOTIFY' } });
             expect(logs.length).toBe(1);
             expect((logs[0].newData as { message: string }).message).toMatch(/Sent Two-Deep warning/);
        });

        it('should debounce subsequent TWO_DEEP_VIOLATION triggers if within 5 minutes', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId } });

             const req = new Request(`http://localhost:4000/api/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ type: 'TWO_DEEP_VIOLATION', message: 'Spam trigger!' })
             });

             const res = await POST(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(false); // Indicates it was dropped due to debounce
             expect(data.message).toMatch(/already sent recently/);
        });
    });

    describe('DELETE /api/attendance', () => {
        it('should block a common user from checking out another user', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             // Admin hasn't departedAt
             const req = new Request(`http://localhost:4000/api/attendance`, {
                 method: 'DELETE',
                 body: JSON.stringify({ visitId: childActiveVisitId }) // the child's visit
             });

             const res = await DELETE(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow a common user to check themselves out', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/attendance`, {
                 method: 'DELETE',
                 body: JSON.stringify({ visitId: activeVisitId }) // their own visit
             });

             const res = await DELETE(req as unknown as import("next/server").NextRequest) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.visit.departedAt).not.toBeNull();
        });
    });
});
