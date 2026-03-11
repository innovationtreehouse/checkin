/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Audit API
 * Tests GET /api/admin/audit for viewing telemetry
 */

import { GET } from '@/app/api/admin/audit/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
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
            data: { email: 'admin-audit-api-test@example.com', name: 'Admin', sysadmin: true }
        });
        adminId = admin.id;

        // Create Common User
        const commonUser = await prisma.participant.create({
            data: { email: 'common-audit-api-test@example.com', name: 'Common' }
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

    describe('GET /api/admin/audit', () => {
        it('should return 403 Forbidden without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const res = await GET();
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should return 403 Forbidden for a common user', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId, sysadmin: false } });

             const res = await GET();
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should return 200 OK and logs for a sysadmin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const res = await GET();
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(Array.isArray(data.logs)).toBe(true);
             expect(data.logs.length).toBeGreaterThanOrEqual(1);

             // Verify it contains our generated log
             const ourLog = data.logs.find((log: any) => log.actorId === adminId && log.action === 'CREATE');
             expect(ourLog).toBeDefined();
        });
    });
});
