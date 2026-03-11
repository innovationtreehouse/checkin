/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Shop API Endpoints
 * Tests active, members, tools, and certifications sub-routes
 */

import { GET as getActive } from '@/app/api/shop/active/route';
import { GET as getMembers } from '@/app/api/shop/members/route';
import { GET as getTools, POST as postTools } from '@/app/api/shop/tools/route';
import { GET as getCerts, POST as postCerts } from '@/app/api/shop/certifications/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Shop API Integration Tests', () => {
    let adminId: number;
    let stewardId: number;
    let certifierId: number;
    let commonId: number;
    
    let mockToolId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'shop-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        await prisma.toolStatus.deleteMany({
            where: { userId: { in: existingUserIds } }
        });
        await prisma.visit.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        await prisma.toolStatus.deleteMany({
            where: { tool: { name: { contains: 'Shop Test Tool' } } }
        });
        await prisma.tool.deleteMany({
            where: { name: { contains: 'Shop Test Tool' } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-shop-api-test@example.com', name: 'Admin', sysadmin: true }
        });
        adminId = admin.id;

        // Create Steward
        const steward = await prisma.participant.create({
            data: { email: 'steward-shop-api-test@example.com', name: 'Steward', shopSteward: true }
        });
        stewardId = steward.id;

        // Create Common User
        const commonUser = await prisma.participant.create({
            data: { 
                email: 'common-shop-api-test@example.com', 
                name: 'Common',
                memberships: { create: { type: 'VOLUNTEER', active: true } as any }
            }
        });
        commonId = commonUser.id;

        const tool = await prisma.tool.create({
            data: { name: 'Shop Test Tool Alpha' }
        });
        mockToolId = tool.id;

        // Create Certifier (A user who has MAY_CERTIFY_OTHERS on a tool)
        const certifier = await prisma.participant.create({
            data: { 
                email: 'certifier-shop-api-test@example.com', 
                name: 'Certifier',
                toolStatuses: {
                    create: { toolId: mockToolId, level: 'MAY_CERTIFY_OTHERS' }
                }
            }
        });
        certifierId = certifier.id;

        // Give the common user an active visit
        await prisma.visit.create({
            data: { participantId: commonId, arrived: new Date() }
        });
    });

    afterAll(async () => {
        const existingUserIds = [adminId, stewardId, certifierId, commonId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.membership.deleteMany({
                where: { volunteerId: { in: existingUserIds } }
            });
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });
            await prisma.toolStatus.deleteMany({
                where: { userId: { in: existingUserIds } }
            });
            await prisma.visit.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });
            await prisma.participant.deleteMany({
                where: { id: { in: existingUserIds } }
            });
        }
        await prisma.toolStatus.deleteMany({
            where: { tool: { name: { contains: 'Shop Test Tool' } } }
        });
        await prisma.tool.deleteMany({
            where: { name: { contains: 'Shop Test Tool' } }
        });
    });

    const createReq = (method: string, queryAndBody?: { searchParams?: string, body?: any }) => {
        let url = `http://localhost:4000/api/shop/route`;
        if (queryAndBody?.searchParams) url += `?${queryAndBody.searchParams}`;

        return {
            url,
            method,
            json: queryAndBody?.body ? jest.fn().mockResolvedValue(queryAndBody.body) : undefined
        } as any;
    };

    describe('/api/shop/active', () => {
        it('should return 403 for common users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const res = await getActive(createReq('GET'));
             expect(res.status).toBe(403);
        });

        it('should return 200 and active occupants for standard shop steward', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: stewardId, shopSteward: true } });

             const res = await getActive(createReq('GET'));
             expect(res.status).toBe(200);
             const data = await res.json();
             
             // The common user we made has an active visit
             const occupantEmails = data.map((d: any) => d.participant.email);
             expect(occupantEmails).toContain('common-shop-api-test@example.com');
        });

        it('should return 200 and active occupants for certifier', async () => {
             // To mock certifier role checking correctly, route.ts looks for `session.user.toolStatuses`
             (getServerSession as jest.Mock).mockResolvedValue({ 
                 user: { id: certifierId, toolStatuses: [{ level: 'MAY_CERTIFY_OTHERS' }] }
             });

             const res = await getActive(createReq('GET'));
             expect(res.status).toBe(200);
        });
    });

    describe('/api/shop/members', () => {
        it('should return 403 for common users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const res = await getMembers(createReq('GET'));
             expect(res.status).toBe(403);
        });

        it('should return 200 and members for an admin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const res = await getMembers(createReq('GET'));
             expect(res.status).toBe(200);
             const data = await res.json();
             
             // Our common user has an active membership so they should appear
             const memberEmails = data.members.map((m: any) => m.email);
             expect(memberEmails).toContain('common-shop-api-test@example.com');
        });
    });

    describe('/api/shop/tools', () => {
        it('should allow anyone authenticated to GET tool list', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const res = await getTools(createReq('GET'));
             expect(res.status).toBe(200);
             const data = await res.json();
             expect(Array.isArray(data)).toBe(true);
             expect(data.some((t: any) => t.name === 'Shop Test Tool Alpha')).toBe(true);
        });

        it('should return 403 for common users attempting a POST', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = createReq('POST', { body: { name: 'Shop Test Tool Beta' } });
             const res = await postTools(req);
             expect(res.status).toBe(403);
        });

        it('should allow admins to create a new tool', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = createReq('POST', { body: { name: 'Shop Test Tool Admin' } });
             const res = await postTools(req);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.tool.name).toBe('Shop Test Tool Admin');
        });
    });

    describe('/api/shop/certifications', () => {
        it('should allow anyone to GET certifications', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = createReq('GET', { searchParams: `toolId=${mockToolId}` });
             const res = await getCerts(req);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(Array.isArray(data)).toBe(true);

             // The Certifier automatically has one on the mockToolId
             expect(data.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 403 for common users attempting a certification grant', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = createReq('POST', { body: { participantId: commonId, toolId: mockToolId, level: 'BASIC' } });
             const res = await postCerts(req);
             expect(res.status).toBe(403);
        });

        it('should allow Certifiers to update a status for someone else on their specific tool', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: certifierId } });

             const req = createReq('POST', { body: { participantId: commonId, toolId: mockToolId, level: 'BASIC' } });
             const res = await postCerts(req);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.certification.level).toBe('BASIC');
             expect(data.certification.userId).toBe(commonId);
        });
    });
});
