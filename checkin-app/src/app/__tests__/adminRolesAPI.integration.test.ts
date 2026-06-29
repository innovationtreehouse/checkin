/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Roles API
 * Tests GET and PATCH /api/roles for fetching and updating user roles
 */

import { GET, PATCH } from '@/app/api/roles/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

describe('Admin Roles API Integration Tests', () => {
    let testSysAdminId: number;
    let testBoardMemberId: number;
    let testUserId: number;
    let testTargetUserId: number;
    let testStudentId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'roles-api-test' } },
            select: { id: true }
        });
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUsers.map(u => u.id) } }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'roles-api-test' } }
        });

        // Setup mock database records
        const sysadmin = await prisma.participant.create({
            data: { email: 'sysadmin-roles-api-test@example.com', name: 'Admin Roles Test', sysadmin: true, household: { create: {} } }
        });
        testSysAdminId = sysadmin.id;

        const boardMember = await prisma.participant.create({
            data: { email: 'board-roles-api-test@example.com', name: 'Board Roles Test', boardMember: true, household: { create: {} } }
        });
        testBoardMemberId = boardMember.id;

        const user = await prisma.participant.create({
            data: { email: 'user-roles-api-test@example.com', name: 'User Roles Test', household: { create: {} } }
        });
        testUserId = user.id;

        const targetUser = await prisma.participant.create({
            data: { email: 'target-roles-api-test@example.com', name: 'Target Roles Test', dateOfBirth: new Date('1990-01-01'), household: { create: {} } }
        });
        testTargetUserId = targetUser.id;

        const now = new Date();
        const tenYearsAgo = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
        
        const student = await prisma.participant.create({
            data: { email: 'student-roles-api-test@example.com', name: 'Student Roles Test', dateOfBirth: tenYearsAgo, household: { create: {} } }
        });
        testStudentId = student.id;
    });

    afterAll(async () => {
        // Clean up
        if (testSysAdminId && testBoardMemberId) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: [testSysAdminId, testBoardMemberId] } }
            });
        }
        await prisma.participant.deleteMany({
            where: { id: { in: [testSysAdminId, testBoardMemberId, testUserId, testTargetUserId, testStudentId] } }
        });
    });

    describe('GET /api/roles', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/roles', { method: 'GET' });

             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId }
             });

             const req = new Request('http://localhost:4000/api/roles', { method: 'GET' });

             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toContain('Forbidden');
        });

        it('should return all participants (youth flagged, dob hidden) for a sysadmin', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testSysAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/roles', { method: 'GET' });

            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.participants).toBeDefined();
            expect(Array.isArray(data.participants)).toBe(true);

            const ids = data.participants.map((p: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => p.id);
            expect(ids).toContain(testTargetUserId);
            // Youth are returned (client filters via "Hide Youth"), flagged isYouth; dob is not leaked.
            expect(ids).toContain(testStudentId);
            const adult = data.participants.find((p: { id?: number }) => p.id === testTargetUserId);
            const student = data.participants.find((p: { id?: number }) => p.id === testStudentId);
            expect(adult.isYouth).toBe(false);
            expect(student.isYouth).toBe(true);
            expect(adult).not.toHaveProperty('dateOfBirth');
            expect(student).not.toHaveProperty('dateOfBirth');
        });
    });

    describe('PATCH /api/roles', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/roles', {
                 method: 'PATCH',
                 body: JSON.stringify({ targetUserId: testTargetUserId, boardMember: true })
             });

             const res = await PATCH(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId }
             });

             const req = new Request('http://localhost:4000/api/roles', {
                 method: 'PATCH',
                 body: JSON.stringify({ targetUserId: testTargetUserId, boardMember: true })
             });

             const res = await PATCH(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if targetUserId is missing', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testSysAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/roles', {
                method: 'PATCH',
                body: JSON.stringify({ boardMember: true })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
        });

        it('should return 403 Forbidden when Board Member tries to grant Sysadmin privileges', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testBoardMemberId, boardMember: true }
            });

            const req = new Request('http://localhost:4000/api/roles', {
                method: 'PATCH',
                body: JSON.stringify({ targetUserId: testTargetUserId, sysadmin: true })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(403);
            
            const data = await res.json();
            expect(data.error).toBe("Only Sysadmins can modify sysadmin privileges");
        });

        it('should successfully grant boardMember as a Board Member', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testBoardMemberId, boardMember: true }
            });

            const req = new Request('http://localhost:4000/api/roles', {
                method: 'PATCH',
                body: JSON.stringify({ targetUserId: testTargetUserId, boardMember: true })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.message).toBe("Roles updated successfully");
            expect(data.user.boardMember).toBe(true);

            const userRef = await prisma.participant.findUnique({ where: { id: testTargetUserId } });
            expect(userRef?.boardMember).toBe(true);
        });

        it('should successfully grant sysadmin as a Sysadmin', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testSysAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/roles', {
                method: 'PATCH',
                body: JSON.stringify({ targetUserId: testTargetUserId, sysadmin: true })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.user.sysadmin).toBe(true);

            const userRef = await prisma.participant.findUnique({ where: { id: testTargetUserId } });
            expect(userRef?.sysadmin).toBe(true);
        });
    });
});
