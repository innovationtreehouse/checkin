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
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
describe('Shop API Integration Tests', () => {
    let adminId: number;
    let boardMemberId: number;
    let stewardId: number;
    let certifierId: number;
    let commonId: number;

    let mockToolId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'shop-api-test' } },
            select: { id: true, householdId: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        const existingHouseholdIds = existingUsers.map(u => u.householdId).filter((id): id is number => id !== null);

        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        await prisma.toolStatus.deleteMany({
            where: { userId: { in: existingUserIds } }
        });
        await prisma.visit.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });
        // RESTRICT: delete participants before their households
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });
        // Memberships belong to the household; remove them before deleting households.
        await prisma.membership.deleteMany({
            where: { householdId: { in: existingHouseholdIds } }
        });
        await prisma.household.deleteMany({
            where: { id: { in: existingHouseholdIds } }
        });

        await prisma.toolStatus.deleteMany({
            where: { tool: { name: { contains: 'Shop Test Tool' } } }
        });
        await prisma.tool.deleteMany({
            where: { name: { contains: 'Shop Test Tool' } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-shop-api-test@example.com', name: 'Admin', sysadmin: true, household: { create: {} } }
        });
        adminId = admin.id;

        // Create Board Member (#160 – board members must be able to access shop routes)
        const boardMember = await prisma.participant.create({
            data: { email: 'board-shop-api-test@example.com', name: 'Board Member', boardMember: true, household: { create: {} } }
        });
        boardMemberId = boardMember.id;

        // Create Steward
        const steward = await prisma.participant.create({
            data: { email: 'steward-shop-api-test@example.com', name: 'Steward', shopSteward: true, household: { create: {} } }
        });
        stewardId = steward.id;

        // Create Common User
        const commonUser = await prisma.participant.create({
            data: {
                email: 'common-shop-api-test@example.com',
                name: 'Common',
                // Volunteer member: the household holds an ACTIVE, isVolunteer membership.
                household: { create: { membership: { create: { status: 'ACTIVE', isVolunteer: true } } } }
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
                household: { create: {} },
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
        const existingUserIds = [adminId, boardMemberId, stewardId, certifierId, commonId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            const participants = await prisma.participant.findMany({
                where: { id: { in: existingUserIds } },
                select: { householdId: true }
            });
            const householdIds = participants.map(p => p.householdId).filter((id): id is number => id !== null);

            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });
            await prisma.toolStatus.deleteMany({
                where: { userId: { in: existingUserIds } }
            });
            await prisma.visit.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });
            // RESTRICT: delete participants before their households
            await prisma.participant.deleteMany({
                where: { id: { in: existingUserIds } }
            });
            if (householdIds.length > 0) {
                // Memberships belong to the household; remove them before deleting households.
                await prisma.membership.deleteMany({
                    where: { householdId: { in: householdIds } }
                });
                await prisma.household.deleteMany({
                    where: { id: { in: householdIds } }
                });
            }
        }
        await prisma.toolStatus.deleteMany({
            where: { tool: { name: { contains: 'Shop Test Tool' } } }
        });
        await prisma.tool.deleteMany({
            where: { name: { contains: 'Shop Test Tool' } }
        });
    });

    const createReq = (method: string, queryAndBody?: { searchParams?: string, body?: Record<string, unknown> }) => {
        let url = `http://localhost:4000/api/shop/route`;
        if (queryAndBody?.searchParams) url += `?${queryAndBody.searchParams}`;

        return {
            url,
            method,
            json: queryAndBody?.body ? jest.fn().mockResolvedValue(queryAndBody.body) : undefined
        } as unknown as never;
    };

    describe('/api/shop/active', () => {
        it('should return 403 for common users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const res = await getActive() as Response;
             expect(res.status).toBe(403);
        });

        it('should return 200 and active occupants for standard shop steward', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: stewardId, shopSteward: true } });

             const res = await getActive() as Response;
             expect(res.status).toBe(200);
             const data = await res.json();
             
             // The common user we made has an active visit
             const occupantEmails = data.map((d: { participant: { email: string } }) => d.participant.email);
             expect(occupantEmails).toContain('common-shop-api-test@example.com');
        });

        it('should return 200 and active occupants for certifier', async () => {
             // To mock certifier role checking correctly, route.ts looks for `session.user.toolStatuses`
             (getServerSession as jest.Mock).mockResolvedValue({ 
                 user: { id: certifierId, toolStatuses: [{ level: 'MAY_CERTIFY_OTHERS' }] }
             });

             const res = await getActive() as Response;
             expect(res.status).toBe(200);
        });
    });

    describe('/api/shop/members', () => {
        it('should return 403 for common users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const res = await getMembers() as Response;
             expect(res.status).toBe(403);
        });

        it('should return 200 and members for an admin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const res = await getMembers() as Response;
             expect(res.status).toBe(200);
             const data = await res.json();

             // Our common user has an active membership so they should appear
             const memberEmails = data.members.map((m: { email: string }) => m.email);
             expect(memberEmails).toContain('common-shop-api-test@example.com');
        });

        // Regression test for #160: board members must be able to fetch the member list
        // so the certification grant picklist is populated in the UI.
        it('should return 200 and members for a board member', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardMemberId, boardMember: true } });

             const res = await getMembers() as Response;
             expect(res.status).toBe(200);
             const data = await res.json();
             expect(Array.isArray(data.members)).toBe(true);
        });
    });

    describe('/api/shop/tools', () => {
        it('should allow anyone authenticated to GET tool list', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const res = await getTools() as Response;
             expect(res.status).toBe(200);
             const data = await res.json();
             expect(Array.isArray(data)).toBe(true);
             expect(data.some((t: { name: string }) => t.name === 'Shop Test Tool Alpha')).toBe(true);
        });

        it('should return 403 for common users attempting a POST', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = createReq('POST', { body: { name: 'Shop Test Tool Beta' } });
             const res = await postTools(req) as Response;
             expect(res.status).toBe(403);
        });

        it('should allow admins to create a new tool', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = createReq('POST', { body: { name: 'Shop Test Tool Admin' } });
             const res = await postTools(req) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.tool.name).toBe('Shop Test Tool Admin');
        });

        it('should allow shop stewards to create a new tool', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: stewardId, shopSteward: true } });

             const req = createReq('POST', { body: { name: 'Shop Test Tool Steward' } });
             const res = await postTools(req) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.tool.name).toBe('Shop Test Tool Steward');
        });
    });

    describe('/api/shop/certifications', () => {
        it('should allow anyone to GET certifications', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = createReq('GET', { searchParams: `toolId=${mockToolId}` });
             const res = await getCerts(req) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(Array.isArray(data)).toBe(true);

             // The Certifier automatically has one on the mockToolId
             expect(data.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 403 for common users attempting a certification grant', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = createReq('POST', { body: { participantId: commonId, toolId: mockToolId, level: 'BASIC' } });
             const res = await postCerts(req) as Response;
             expect(res.status).toBe(403);
        });

        it('should allow Certifiers to update a status for someone else on their specific tool', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: certifierId } });

             const req = createReq('POST', { body: { participantId: commonId, toolId: mockToolId, level: 'BASIC' } });
             const res = await postCerts(req) as Response;
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.certification.level).toBe('BASIC');
             expect(data.certification.userId).toBe(commonId);
        });

        // Regression test for #160: board members must be able to grant certifications.
        it('should allow board members to grant a certification on any tool', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardMemberId, boardMember: true } });

             const req = createReq('POST', { body: { participantId: commonId, toolId: mockToolId, level: 'CERTIFIED' } });
             const res = await postCerts(req) as Response;
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.certification.level).toBe('CERTIFIED');
             expect(data.certification.userId).toBe(commonId);
        });
    });
});
