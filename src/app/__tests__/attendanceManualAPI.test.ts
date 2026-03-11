/* eslint-disable @typescript-eslint/no-explicit-any */
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
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Manual Attendance API Integration Tests', () => {
    let testUserId: number;

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
            data: { email: 'user-manual-attendance-test@example.com', name: 'User Manual Attendance Test' }
        });
        testUserId = user.id;
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
    });

    describe('POST /api/attendance/manual', () => {
        it('should return 401 Unauthorized without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrived: new Date().toISOString() })
            });

            const res = await POST(req as any);
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
                body: JSON.stringify({ departed: new Date().toISOString() }) // No arrived time
            });

            const res = await POST(req as any);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Arrival time is required');
        });

        it('should return 400 Bad Request if departure time is before arrival time', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const arrived = new Date();
            const departed = new Date(arrived.getTime() - 3600000); // 1 hour BEFORE arrival

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrived: arrived.toISOString(), departed: departed.toISOString() })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Departure time must be after arrival time');
        });

        it('should successfully record a manual visit with both arrived and departed defined', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const arrived = new Date(Date.now() - 7200000); // 2 hours ago
            const departed = new Date(Date.now() - 3600000); // 1 hour ago

            const previousAuditLogs = await prisma.auditLog.count({
                where: { actorId: testUserId, action: 'CREATE', tableName: 'Visit' }
            });

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrived: arrived.toISOString(), departed: departed.toISOString() })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(201);
            const data = await res.json();
            
            expect(data.message).toBe('Manual visit recorded successfully.');
            expect(data.visit).toBeDefined();
            expect(data.visit.participantId).toBe(testUserId);
            expect(new Date(data.visit.arrived).toISOString()).toBe(arrived.toISOString());
            expect(new Date(data.visit.departed).toISOString()).toBe(departed.toISOString());

            const currentAuditLogs = await prisma.auditLog.count({
                where: { actorId: testUserId, action: 'CREATE', tableName: 'Visit' }
            });
            expect(currentAuditLogs).toBe(previousAuditLogs + 1);
        });

        it('should successfully record a manual visit with arrived only', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const arrived = new Date(Date.now() - 1800000); // 30 minutes ago

            const req = new Request('http://localhost:4000/api/attendance/manual', {
                method: 'POST',
                body: JSON.stringify({ arrived: arrived.toISOString() })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(201);
            const data = await res.json();
            
            expect(data.message).toBe('Manual visit recorded successfully.');
            expect(data.visit).toBeDefined();
            expect(new Date(data.visit.arrived).toISOString()).toBe(arrived.toISOString());
            expect(data.visit.departed).toBeNull();
        });
    });
});
