/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Audit API
 * Tests GET /api/system-status/audit-log for viewing telemetry
 */

import { GET } from '@/app/api/system-status/audit-log/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));

describe('Admin Audit API Integration Tests', () => {
    let adminId: number;
    let commonId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'audit-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-audit-api-test@example.com', name: 'Admin', isSysadmin: true, household: { create: {} } }
        });
        adminId = admin.id;

        // Create Common User
        const commonUser = await prisma.participant.create({
            data: { email: 'common-audit-api-test@example.com', name: 'Common', household: { create: {} } }
        });
        commonId = commonUser.id;

        // Produce a fake audit log row
        await prisma.auditLog.create({
            data: {
                actorId: adminId,
                action: 'CREATE',
                affectedEntityId: commonId,
                tableName: 'Participant',
                newData: { email: 'common-audit-api-test@example.com' }
            }
        });
    });

    afterAll(async () => {
        const existingUserIds = [adminId, commonId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });

            await prisma.participant.deleteMany({
                where: { id: { in: existingUserIds } }
            });
        }
    });

    describe('GET /api/system-status/audit-log', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/system-status/audit-log', { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for a common user', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId, isSysadmin: false } });

             const req = new Request('http://localhost:4000/api/system-status/audit-log', { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(403);
        });

        it('should return 200 OK and logs for a isSysadmin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request('http://localhost:4000/api/system-status/audit-log', { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(Array.isArray(data.logs)).toBe(true);
             expect(data.logs.length).toBeGreaterThanOrEqual(1);

             // Verify it contains our generated log
             const ourLog = data.logs.find((log: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => log.actorId === adminId && log.action === 'CREATE');
             expect(ourLog).toBeDefined();

             // Server-side paging metadata + resolved actor name.
             expect(typeof data.total).toBe('number');
             expect(data.page).toBe(1);
             expect(data.pageSize).toBe(50);
             expect(Array.isArray(data.tables)).toBe(true);
             expect(ourLog.actorName).toBe('Admin');
        });

        it('should filter by action and entity and page server-side', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const url = 'http://localhost:4000/api/system-status/audit-log?action=CREATE&table=Participant&page=1';
             const req = new Request(url, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.logs.length).toBeLessThanOrEqual(50);
             // Every returned row must satisfy both filters.
             for (const log of data.logs) {
                 expect(log.action).toBe('CREATE');
                 expect(log.tableName).toBe('Participant');
             }
        });
    });
});
