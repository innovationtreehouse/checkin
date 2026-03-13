/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Attendance API
 * Tests GET (fetch active visits), POST (manual check-in, two-deep notification), and DELETE (force checkout)
 */

import { GET, POST, DELETE } from '@/app/api/attendance/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('@/lib/verify-kiosk', () => ({
    getKioskPublicKeys: jest.fn().mockReturnValue([Buffer.from('mock-key')]),
    verifyKioskSignature: jest.fn()
}));

describe('Attendance API Integration Tests', () => {
    let testAdminId: number;
    let testParticipantId: number;
    let testHouseholdMemberId: number;
    let testHouseholdId: number;
    let activeVisitId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.visit.deleteMany({});
        await prisma.householdLead.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'attendance-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: 'Attendance Test Household' }
        });

        // Setup mock database records
        const household = await prisma.household.create({
            data: { name: 'Attendance Test Household' }
        });
        testHouseholdId = household.id;

        const admin = await prisma.participant.create({
            data: { email: 'admin-attendance-test@example.com', name: 'Admin Test', sysadmin: true }
        });
        testAdminId = admin.id;

        const participant = await prisma.participant.create({
            data: { 
                email: 'participant-attendance-test@example.com', 
                name: 'Participant Test',
                householdId: testHouseholdId 
            }
        });
        testParticipantId = participant.id;

        // Make participant the household lead
        await prisma.householdLead.create({
            data: { householdId: testHouseholdId, participantId: testParticipantId }
        });

        const householdMember = await prisma.participant.create({
            data: { 
                email: 'member-attendance-test@example.com', 
                name: 'Household Member Test',
                householdId: testHouseholdId 
            }
        });
        testHouseholdMemberId = householdMember.id;

        const visit = await prisma.visit.create({
            data: { participantId: testParticipantId, arrived: new Date() }
        });
        activeVisitId = visit.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.visit.deleteMany({});
        await prisma.householdLead.deleteMany({
            where: { householdId: testHouseholdId }
        });
        await prisma.participant.deleteMany({
            where: { id: { in: [testAdminId, testParticipantId, testHouseholdMemberId] } }
        });
        await prisma.household.deleteMany({
            where: { id: testHouseholdId }
        });
    });

    describe('GET /api/attendance', () => {
        it('should return 401 Unauthorized without session or Kiosk header', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/attendance', {
                 method: 'GET'
             });

             const res = await GET(req as any);
             expect(res.status).toBe(401);
        });

        it('should return active visits for an authenticated session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/attendance', {
                method: 'GET'
            });

            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.attendance).toBeDefined();
            expect(Array.isArray(data.attendance)).toBe(true);
            
            // Should contain at least the visit we seeded
            const foundVisit = data.attendance.find((v: any) => v.id === activeVisitId);
            expect(foundVisit).toBeDefined();
            expect(foundVisit.participant.name).toBe('Participant Test');
        });
    });

    describe('DELETE /api/attendance', () => {
        it('should allow a household lead to check out a household member', async () => {
            // Setup a visit for the household member
            const memberVisit = await prisma.visit.create({
                data: { participantId: testHouseholdMemberId, arrived: new Date() }
            });

            (getServerSession as jest.Mock).mockResolvedValue({
                user: { 
                    id: testParticipantId, 
                    sysadmin: false, 
                    householdId: testHouseholdId, 
                    householdLead: true 
                }
            });

            const req = new Request('http://localhost:4000/api/attendance', {
                method: 'DELETE',
                body: JSON.stringify({ visitId: memberVisit.id })
            });

            const res = await DELETE(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.visit.departed).not.toBeNull();
        });

        it('should not allow a regular user to check out someone else', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testHouseholdMemberId, sysadmin: false, householdId: testHouseholdId }
            });

            const req = new Request('http://localhost:4000/api/attendance', {
                method: 'DELETE',
                body: JSON.stringify({ visitId: activeVisitId }) // activeVisitId belongs to testParticipantId
            });

            const res = await DELETE(req as any);
            expect(res.status).toBe(403);
            
            const data = await res.json();
            expect(data.error).toContain('Forbidden');
        });
    });

    describe('POST /api/attendance', () => {
        it('should allow an admin to manually check in a user', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            // Ensure testHouseholdMemberId is checked out before we check them in
            await prisma.visit.deleteMany({
                where: { participantId: testHouseholdMemberId }
            });

            const req = new Request('http://localhost:4000/api/attendance', {
                method: 'POST',
                body: JSON.stringify({ type: 'MANUAL_CHECKIN', participantId: testHouseholdMemberId })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.visit.participantId).toBe(testHouseholdMemberId);
        });

        it('should return 400 when trying to check in an already checked in user', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/attendance', {
                method: 'POST',
                body: JSON.stringify({ type: 'MANUAL_CHECKIN', participantId: testParticipantId }) // Already checked in
            });

            const res = await POST(req as any);
            expect(res.status).toBe(400);

            const data = await res.json();
            expect(data.error).toContain('already checked in');
        });
    });
});
