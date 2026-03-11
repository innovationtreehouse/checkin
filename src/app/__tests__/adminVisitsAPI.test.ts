/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Visits API
 * Tests GET and PATCH /api/admin/visits for viewing and editing check-in records
 */

import { GET, PATCH } from '@/app/api/admin/visits/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));

describe('Admin Visits API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testVisitId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'visits-api-test' } },
            select: { id: true }
        });
        
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.visit.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { email: { contains: 'visits-api-test' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-visits-api-test@example.com', name: 'Admin Visits Test', sysadmin: true }
        });
        testAdminId = admin.id;
        const checkAdmin = await prisma.participant.findUnique({ where: { id: testAdminId } });
        console.log("Check Admin:", checkAdmin);

        const user = await prisma.participant.create({
            data: { email: 'user-visits-api-test@example.com', name: 'User Visits Test' }
        });
        testUserId = user.id;

        const visit = await prisma.visit.create({
            data: {
                participantId: testUserId,
                arrived: new Date(Date.now() - 3600000), // 1 hour ago
            }
        });
        testVisitId = visit.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.visit.deleteMany({
            where: { participantId: { in: [testAdminId, testUserId] } }
        });
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: [testAdminId, testUserId] } }
        });
        await prisma.participant.deleteMany({
            where: { id: { in: [testAdminId, testUserId] } }
        });
    });

    describe('GET /api/admin/visits', () => {
        it('should return 401 Unauthorized without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request('http://localhost:4000/api/admin/visits', {
                method: 'GET'
            });

            const res = await GET(req as any);
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe('Unauthorized: Requires Admin Role');
        });

        it('should return 403 Forbidden for non-admin users', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request('http://localhost:4000/api/admin/visits', {
                method: 'GET'
            });

            const res = await GET(req as any);
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe('Unauthorized: Requires Admin Role');
        });

        it('should return the latest visits for a sysadmin', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/admin/visits', {
                method: 'GET'
            });

            const res = await GET(req as any);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(Array.isArray(data.visits)).toBe(true);
            expect(data.visits.length).toBeGreaterThanOrEqual(1);

            const visitMatches = data.visits.filter((v: any) => v.participantId === testUserId);
            expect(visitMatches.length).toBe(1);
            expect(visitMatches[0].participant).toBeDefined();
        });
    });

    describe('PATCH /api/admin/visits', () => {
        it('should return 401 Unauthorized without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request('http://localhost:4000/api/admin/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, departed: new Date().toISOString() })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(403);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request('http://localhost:4000/api/admin/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, departed: new Date().toISOString() })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if visitId is missing', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/admin/visits', {
                method: 'PATCH',
                body: JSON.stringify({ departed: new Date().toISOString() })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('visitId is required.');
        });

        it('should update the visit and log to audit block when an admin requests it', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const previousAuditLogs = await prisma.auditLog.count({
                where: { actorId: testAdminId, action: 'EDIT', tableName: 'Visit' }
            });

            const now = new Date();
            const req = new Request('http://localhost:4000/api/admin/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, departed: now.toISOString() })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(new Date(data.visit.departed).toISOString()).toBe(now.toISOString());

            const updatedVisit = await prisma.visit.findUnique({ where: { id: testVisitId } });
            expect(updatedVisit?.departed?.toISOString()).toBe(now.toISOString());

            const currentAuditLogs = await prisma.auditLog.count({
                where: { actorId: testAdminId, action: 'EDIT', tableName: 'Visit' }
            });
            expect(currentAuditLogs).toBe(previousAuditLogs + 1);
        });
    });
});
