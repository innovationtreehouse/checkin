/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Visits API
 * Tests GET and PATCH /api/facility/visits for viewing and editing check-in records
 */

import { GET, PATCH } from '@/app/api/facility/visits/route';
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
        const existingUsers = await prisma.person.findMany({
            where: { email: { contains: 'visits-api-test' } },
            select: { id: true }
        });
        
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.visit.deleteMany({
            where: { personId: { in: existingUserIds } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.person.deleteMany({
            where: { email: { contains: 'visits-api-test' } }
        });

        // Setup mock database records
        const admin = await prisma.person.create({
            data: { email: 'admin-visits-api-test@example.com', name: 'Admin Visits Test', isSysadmin: true, household: { create: {} } }
        });
        testAdminId = admin.id;
        const checkAdmin = await prisma.person.findUnique({ where: { id: testAdminId } });
        console.log("Check Admin:", checkAdmin);

        const user = await prisma.person.create({
            data: { email: 'user-visits-api-test@example.com', name: 'User Visits Test', household: { create: {} } }
        });
        testUserId = user.id;

        const visit = await prisma.visit.create({
            data: {
                personId: testUserId,
                arrivedAt: new Date(Date.now() - 3600000), // 1 hour ago
            }
        });
        testVisitId = visit.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.visit.deleteMany({
            where: { personId: { in: [testAdminId, testUserId] } }
        });
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: [testAdminId, testUserId] } }
        });
        await prisma.person.deleteMany({
            where: { id: { in: [testAdminId, testUserId] } }
        });
    });

    describe('GET /api/facility/visits', () => {
        it('should return 401 Unauthorized without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'GET'
            });

            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'GET'
            });

            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(403);
        });

        it('should return the latest visits for a isSysadmin', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'GET'
            });

            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(Array.isArray(data.visits)).toBe(true);
            expect(data.visits.length).toBeGreaterThanOrEqual(1);

            const visitMatches = data.visits.filter((v: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => v.personId === testUserId);
            expect(visitMatches.length).toBe(1);
            expect(visitMatches[0].person).toBeDefined();
        });
    });

    describe('PATCH /api/facility/visits', () => {
        it('should return 401 Unauthorized without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, departedAt: new Date().toISOString() })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, departedAt: new Date().toISOString() })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if visitId is missing', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'PATCH',
                body: JSON.stringify({ departedAt: new Date().toISOString() })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('visitId is required.');
        });

        it('should return 400 for an invalid provided date', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, departedAt: 'not-a-date' })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Invalid departure time');
        });

        it('should return 400 for a future provided date', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const future = new Date(Date.now() + 3600000).toISOString();
            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, departedAt: future })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Departure time cannot be in the future.');
        });

        it('should return 400 when editing an open visit without supplying a departure', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            // testVisitId is still open here (departedAt null); editing only arrival must not leave it open.
            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, arrivedAt: new Date(Date.now() - 7200000).toISOString() })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Departure time is required to close this visit.');
        });

        it('should return 400 when departure is not after arrival', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            // Existing arrival is ~1h ago; a departure 2h ago is before it (also covers zero-length).
            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, departedAt: new Date(Date.now() - 7200000).toISOString() })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Departure time must be after arrival time');
        });

        it('should return 404 for a non-existent visit', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: 999999999, departedAt: new Date().toISOString() })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error).toBe('Visit not found.');
        });

        it('should update the visit and log to audit block when an admin requests it', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const previousAuditLogs = await prisma.auditLog.count({
                where: { actorId: testAdminId, action: 'EDIT', tableName: 'Visit' }
            });

            const now = new Date();
            const req = new Request('http://localhost:4000/api/facility/visits', {
                method: 'PATCH',
                body: JSON.stringify({ visitId: testVisitId, departedAt: now.toISOString() })
            });

            const res = await PATCH(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(new Date(data.visit.departedAt).toISOString()).toBe(now.toISOString());
            expect(data.visit.departedVia).toBe('WEB');

            const updatedVisit = await prisma.visit.findUnique({ where: { id: testVisitId } });
            expect(updatedVisit?.departedAt?.toISOString()).toBe(now.toISOString());

            const currentAuditLogs = await prisma.auditLog.count({
                where: { actorId: testAdminId, action: 'EDIT', tableName: 'Visit' }
            });
            expect(currentAuditLogs).toBe(previousAuditLogs + 1);
        });
    });
});
