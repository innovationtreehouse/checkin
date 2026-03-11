/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Roles API
 * Tests GET and PATCH /api/admin/roles for fetching and updating user roles
 */

import { GET, PATCH } from '@/app/api/admin/roles/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
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
            data: { email: 'sysadmin-roles-api-test@example.com', name: 'Admin Roles Test', sysadmin: true }
        });
        testSysAdminId = sysadmin.id;

        const boardMember = await prisma.participant.create({
            data: { email: 'board-roles-api-test@example.com', name: 'Board Roles Test', boardMember: true }
        });
        testBoardMemberId = boardMember.id;

        const user = await prisma.participant.create({
            data: { email: 'user-roles-api-test@example.com', name: 'User Roles Test' }
        });
        testUserId = user.id;

        const targetUser = await prisma.participant.create({
            data: { email: 'target-roles-api-test@example.com', name: 'Target Roles Test', dob: new Date('1990-01-01') }
        });
        testTargetUserId = targetUser.id;

        const now = new Date();
        const tenYearsAgo = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
        
        const student = await prisma.participant.create({
            data: { email: 'student-roles-api-test@example.com', name: 'Student Roles Test', dob: tenYearsAgo }
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

    describe('GET /api/admin/roles', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/admin/roles', { method: 'GET' });

             const res = await GET(req as any);
             expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId }
             });

             const req = new Request('http://localhost:4000/api/admin/roles', { method: 'GET' });

             const res = await GET(req as any);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toContain('Forbidden');
        });

        it('should return all adult participants for a sysadmin', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testSysAdminId }
            });

            const req = new Request('http://localhost:4000/api/admin/roles', { method: 'GET' });

            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.participants).toBeDefined();
            expect(Array.isArray(data.participants)).toBe(true);

            const ids = data.participants.map((p: any) => p.id);
            expect(ids).toContain(testTargetUserId);
            expect(ids).not.toContain(testStudentId); // Students are filtered out
        });
    });

    describe('PATCH /api/admin/roles', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/admin/roles', {
                 method: 'PATCH',
                 body: JSON.stringify({ targetUserId: testTargetUserId, boardMember: true })
             });

             const res = await PATCH(req as any);
             expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId }
             });

             const req = new Request('http://localhost:4000/api/admin/roles', {
                 method: 'PATCH',
                 body: JSON.stringify({ targetUserId: testTargetUserId, boardMember: true })
             });

             const res = await PATCH(req as any);
             expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if targetUserId is missing', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testSysAdminId }
            });

            const req = new Request('http://localhost:4000/api/admin/roles', {
                method: 'PATCH',
                body: JSON.stringify({ boardMember: true })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(400);
        });

        it('should return 403 Forbidden when Board Member tries to grant Sysadmin privileges', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testBoardMemberId }
            });

            const req = new Request('http://localhost:4000/api/admin/roles', {
                method: 'PATCH',
                body: JSON.stringify({ targetUserId: testTargetUserId, sysadmin: true })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(403);
            
            const data = await res.json();
            expect(data.error).toBe("Only Sysadmins can modify sysadmin privileges");
        });

        it('should successfully grant boardMember as a Board Member', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testBoardMemberId }
            });

            const req = new Request('http://localhost:4000/api/admin/roles', {
                method: 'PATCH',
                body: JSON.stringify({ targetUserId: testTargetUserId, boardMember: true })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.message).toBe("Roles updated successfully");
            expect(data.user.boardMember).toBe(true);

            const userRef = await prisma.participant.findUnique({ where: { id: testTargetUserId } });
            expect(userRef?.boardMember).toBe(true);
        });

        it('should successfully grant sysadmin as a Sysadmin', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testSysAdminId }
            });

            const req = new Request('http://localhost:4000/api/admin/roles', {
                method: 'PATCH',
                body: JSON.stringify({ targetUserId: testTargetUserId, sysadmin: true })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.user.sysadmin).toBe(true);

            const userRef = await prisma.participant.findUnique({ where: { id: testTargetUserId } });
            expect(userRef?.sysadmin).toBe(true);
        });
    });
});
