/**
 * @jest-environment node
 */
/**
 * Integration Tests for Manual Attendance API
 * Tests POST /api/attendance/manual for adding past manual check-ins
 */

import { POST } from '@/app/api/attendance/manual/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));
describe('Manual Attendance API Integration Tests', () => {
    let testUserId: number;
    let testHouseholdId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'manual-attendance-test' } },
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
            where: { email: { contains: 'manual-attendance-test' } }
        });

        // Setup mock database records
        const user = await prisma.participant.create({
            data: { email: 'user-manual-attendance-test@example.com', name: 'User Manual Attendance Test', household: { create: {} } }
        });
        testUserId = user.id;
        testHouseholdId = user.householdId;
    });

    afterAll(async () => {
        // Clean up
        await prisma.visit.deleteMany({
            where: { participantId: testUserId }
        });
        await prisma.auditLog.deleteMany({
            where: { actorId: testUserId }
        });
        await prisma.participant.deleteMany({
            where: { id: testUserId }
        });
        await prisma.household.deleteMany({
            where: { id: testHouseholdId }
        });
    });

    describe('POST /api/attendance/manual', () => {
        it('should return 401 Unauthorized without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrivedAt: new Date().toISOString() })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(401);
            const data = await res.json();
            expect(data.error).toBe('Unauthorized');
        });

        it('should return 400 Bad Request if arrival time is missing', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ departedAt: new Date().toISOString() }) // No arrivedAt time
            });

            const res = await POST(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Arrival time is required');
        });

        it('should return 400 Bad Request if arrival time is malformed', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrivedAt: 'not-a-date' })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Invalid arrival time');
        });

        it('should return 400 Bad Request if departure time is before arrival time', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const arrivedAt = new Date();
            const departedAt = new Date(arrivedAt.getTime() - 3600000); // 1 hour BEFORE arrival

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrivedAt: arrivedAt.toISOString(), departedAt: departedAt.toISOString() })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Departure time must be after arrival time');
        });

        it('should successfully record a manual visit with both arrivedAt and departedAt defined', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const arrivedAt = new Date(Date.now() - 7200000); // 2 hours ago
            const departedAt = new Date(Date.now() - 3600000); // 1 hour ago

            const previousAuditLogs = await prisma.auditLog.count({
                where: { actorId: testUserId, action: 'CREATE', tableName: 'Visit' }
            });

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrivedAt: arrivedAt.toISOString(), departedAt: departedAt.toISOString() })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(201);
            const data = await res.json();
            
            expect(data.message).toBe('Manual visit recorded successfully.');
            expect(data.visit).toBeDefined();
            expect(data.visit.participantId).toBe(testUserId);
            expect(new Date(data.visit.arrivedAt).toISOString()).toBe(arrivedAt.toISOString());
            expect(new Date(data.visit.departedAt).toISOString()).toBe(departedAt.toISOString());

            const currentAuditLogs = await prisma.auditLog.count({
                where: { actorId: testUserId, action: 'CREATE', tableName: 'Visit' }
            });
            expect(currentAuditLogs).toBe(previousAuditLogs + 1);
        });

        it('should successfully record a manual visit with arrivedAt only', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const arrivedAt = new Date(Date.now() - 1800000); // 30 minutes ago

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrivedAt: arrivedAt.toISOString() })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(201);
            const data = await res.json();
            
            expect(data.message).toBe('Manual visit recorded successfully.');
            expect(data.visit).toBeDefined();
            expect(new Date(data.visit.arrivedAt).toISOString()).toBe(arrivedAt.toISOString());
            expect(data.visit.departedAt).toBeNull();
        });

        it('dedups a SERIAL double-submit: second POST returns the same open visit, only one in DB', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            // Isolate: drop any open visit left by earlier tests so the count is unambiguous.
            await prisma.visit.deleteMany({ where: { participantId: testUserId, departedAt: null } });

            const arrivedAt = new Date(Date.now() - 600000).toISOString(); // 10 min ago, open (no departure)
            const makeReq = () => new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrivedAt })
            }) as unknown as import("next/server").NextRequest;

            // Two submits, strictly one after the other (not the pool-2 concurrency harness):
            // the route's re-check-then-return path must dedup on its own.
            const res1 = await POST(makeReq());
            expect(res1.status).toBe(201);
            const first = (await res1.json()).visit;

            const res2 = await POST(makeReq());
            expect(res2.status).toBe(201);
            const second = (await res2.json()).visit;

            // The re-check returned the existing open visit instead of creating a new one.
            expect(second.id).toBe(first.id);

            const openVisits = await prisma.visit.findMany({
                where: { participantId: testUserId, departedAt: null }
            });
            expect(openVisits.length).toBe(1);
            expect(openVisits[0].id).toBe(first.id);
        });
    });
});
