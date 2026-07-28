/**
 * @jest-environment node
 */
/**
 * Integration Tests for Shop API Endpoints
 * Tests members, tools, and certifications sub-routes
 */

import { GET as getMembers } from '@/app/api/shop/org-members/route';
import { normalizeAuditData } from '@/lib/auditPayload';
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
    let boardId: number;
    let certifierId: number;
    let commonId: number;
    
    let mockToolId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.person.findMany({
            where: { email: { contains: 'shop-api-test' } },
            select: { id: true, householdId: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        const existingHouseholdIds = existingUsers.map(u => u.householdId).filter((id): id is number => id !== null);

        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        await prisma.toolStatus.deleteMany({
            where: { personId: { in: existingUserIds } }
        });
        await prisma.visit.deleteMany({
            where: { personId: { in: existingUserIds } }
        });
        // RESTRICT: delete participants before their households
        await prisma.person.deleteMany({
            where: { id: { in: existingUserIds } }
        });
        // Memberships belong to the household; remove them before deleting households.
        await prisma.orgMembership.deleteMany({
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
        const admin = await prisma.person.create({
            data: { email: 'admin-shop-api-test@example.com', name: 'Admin', isSysadmin: true, household: { create: { name: "Test HH" } } }
        });
        adminId = admin.id;

        // Create Board Member
        const board = await prisma.person.create({
            data: { email: 'board-shop-api-test@example.com', name: 'Board', isBoardMember: true, household: { create: { name: "Test HH" } } }
        });
        boardId = board.id;

        // Create Common User
        const commonUser = await prisma.person.create({
            data: {
                email: 'common-shop-api-test@example.com',
                name: 'Common',
                // Volunteer member: the household holds an ACTIVE, isVolunteer membership.
                household: { create: { name: 'Test HH', orgMembership: { create: { status: 'ACTIVE', isVolunteer: true } } } }
            }
        });
        commonId = commonUser.id;

        const tool = await prisma.tool.create({
            data: { name: 'Shop Test Tool Alpha' }
        });
        mockToolId = tool.id;

        // Create Certifier (A user who has MAY_CERTIFY_OTHERS on a tool)
        const certifier = await prisma.person.create({
            data: {
                email: 'certifier-shop-api-test@example.com',
                name: 'Certifier',
                household: { create: { name: "Test HH" } },
                toolStatuses: {
                    create: { toolId: mockToolId, level: 'MAY_CERTIFY_OTHERS' }
                }
            }
        });
        certifierId = certifier.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, boardId, certifierId, commonId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            const participants = await prisma.person.findMany({
                where: { id: { in: existingUserIds } },
                select: { householdId: true }
            });
            const householdIds = participants.map(p => p.householdId).filter((id): id is number => id !== null);

            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });
            await prisma.toolStatus.deleteMany({
                where: { personId: { in: existingUserIds } }
            });
            await prisma.visit.deleteMany({
                where: { personId: { in: existingUserIds } }
            });
            // RESTRICT: delete participants before their households
            await prisma.person.deleteMany({
                where: { id: { in: existingUserIds } }
            });
            if (householdIds.length > 0) {
                // Memberships belong to the household; remove them before deleting households.
                await prisma.orgMembership.deleteMany({
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
            // authenticateRequest probes kiosk headers before the session path;
            // return null so it falls through to the mocked getServerSession.
            headers: { get: () => null },
            json: queryAndBody?.body ? jest.fn().mockResolvedValue(queryAndBody.body) : undefined
        } as unknown as never;
    };

    describe('/api/shop/org-members', () => {
        it('should return 403 for common users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const res = await getMembers(createReq('GET')) as Response;
             expect(res.status).toBe(403);
        });

        it('should return 200 and members for an admin', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const res = await getMembers(createReq('GET')) as Response;
             expect(res.status).toBe(200);
             const data = await res.json();
             
             // Our common user has an active membership so they should appear
             const memberEmails = data.orgMembers.map((m: { email: string }) => m.email);
             expect(memberEmails).toContain('common-shop-api-test@example.com');
        });

        it('certifier sees member names but NOT emails (pii stripped)', async () => {
             // Certifier auth comes from a MAY_CERTIFY_OTHERS toolStatus on the
             // session — not a role boolean. The view grants member+public only,
             // so email (pii) is stripped while name (public) survives.
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: commonId, toolStatuses: [{ toolId: 1, level: 'MAY_CERTIFY_OTHERS' }] },
             });

             const res = await getMembers(createReq('GET')) as Response;
             expect(res.status).toBe(200);
             const data = await res.json();
             expect(data.orgMembers.length).toBeGreaterThan(0);
             expect(data.orgMembers.every((m: { name?: string }) => typeof m.name === 'string')).toBe(true);
             expect(data.orgMembers.every((m: { email?: string }) => m.email === undefined)).toBe(true);
        });
    });

    describe('/api/shop/tools', () => {
        it('should allow anyone authenticated to GET tool list', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const res = await getTools(createReq('GET')) as Response;
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
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = createReq('POST', { body: { name: 'Shop Test Tool Admin' } });
             const res = await postTools(req) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.tool.name).toBe('Shop Test Tool Admin');
        });

        it('should allow board members to create a new tool', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

             const req = createReq('POST', { body: { name: 'Shop Test Tool Board' } });
             const res = await postTools(req) as Response;
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.tool.name).toBe('Shop Test Tool Board');
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

             const req = createReq('POST', { body: { personId: commonId, toolId: mockToolId, level: 'BASIC' } });
             const res = await postCerts(req) as Response;
             expect(res.status).toBe(403);
        });

        it('should allow Certifiers to update a status for someone else on their specific tool', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: certifierId } });

             const req = createReq('POST', { body: { personId: commonId, toolId: mockToolId, level: 'BASIC' } });
             const res = await postCerts(req) as Response;
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.certification.level).toBe('BASIC');
             expect(data.certification.personId).toBe(commonId);

             // Audit: first grant on this participant+tool → CREATE, no prior data.
             const auditRows = await prisma.auditLog.findMany({
                 where: { tableName: 'ToolStatus', actorId: certifierId, affectedEntityId: commonId, secondaryAffectedEntity: mockToolId }
             });
             expect(auditRows.length).toBe(1);
             expect(auditRows[0].action).toBe('CREATE');
             expect(auditRows[0].oldData).toBeNull();
        });

        // Denied-household lockout (auth-consistency §5 risk #2 / GAP-1). Certifier
        // status is re-queried from the DB, bypassing the denial-stripped session,
        // so a denied certifier would still pass the MAY_CERTIFY_OTHERS gate. The
        // denied check must reject before the lookup. No certification row is written.
        it('blocks a denied certifier from granting a certification (401, no write)', async () => {
             const tool = await prisma.tool.create({ data: { name: 'Shop Test Tool Denied' } });
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: certifierId, denied: true } });

             const req = createReq('POST', { body: { personId: commonId, toolId: tool.id, level: 'BASIC' } });
             const res = await postCerts(req) as Response;
             expect(res.status).toBe(401);

             // No toolStatus row was written for this fresh (participant, tool) pair.
             const written = await prisma.toolStatus.findUnique({
                 where: { personId_toolId: { personId: commonId, toolId: tool.id } }
             });
             expect(written).toBeNull();
        });

        it('should forbid a Certifier from promoting someone to MAY_CERTIFY_OTHERS', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: certifierId } });

             const req = createReq('POST', { body: { personId: commonId, toolId: mockToolId, level: 'MAY_CERTIFY_OTHERS' } });
             const res = await postCerts(req) as Response;
             // Only admins/board may grant the Certifier level.
             expect(res.status).toBe(403);
        });

        it('should allow an admin to grant MAY_CERTIFY_OTHERS', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = createReq('POST', { body: { personId: commonId, toolId: mockToolId, level: 'MAY_CERTIFY_OTHERS' } });
             const res = await postCerts(req) as Response;
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.certification.level).toBe('MAY_CERTIFY_OTHERS');

             // Audit: a prior status (BASIC) now exists → EDIT, with old data captured.
             const auditRows = await prisma.auditLog.findMany({
                 where: { tableName: 'ToolStatus', actorId: adminId, affectedEntityId: commonId, secondaryAffectedEntity: mockToolId }
             });
             expect(auditRows.length).toBe(1);
             expect(auditRows[0].action).toBe('EDIT');
             expect(auditRows[0].oldData).not.toBeNull();
             expect((normalizeAuditData(auditRows[0].oldData) as Record<string, unknown>).level).toBe('BASIC');
        });

        it('re-cert by a certifier writes an EDIT audit row with the prior level in oldData and the acting certifier as actor', async () => {
            // Self-contained: a fresh tool the certifier may certify on, a fresh target.
            const tool = await prisma.tool.create({ data: { name: 'Shop Test Tool Recert' } });
            const reCertifier = await prisma.person.create({
                data: {
                    email: 'recert-certifier-shop-api-test@example.com',
                    name: 'Recert Certifier',
                    household: { create: { name: "Test HH" } },
                    toolStatuses: { create: { toolId: tool.id, level: 'MAY_CERTIFY_OTHERS' } },
                },
            });
            const target = await prisma.person.create({
                data: { email: 'recert-target-shop-api-test@example.com', name: 'Recert Target', household: { create: { name: "Test HH" } } },
            });

            try {
                (getServerSession as jest.Mock).mockResolvedValue({ user: { id: reCertifier.id } });

                // First grant: BASIC → CREATE (no prior status).
                const createRes = await postCerts(
                    createReq('POST', { body: { personId: target.id, toolId: tool.id, level: 'BASIC' } }),
                ) as Response;
                expect(createRes.status).toBe(200);

                // Re-cert: BASIC → CERTIFIED → EDIT with the prior status snapshotted.
                const editRes = await postCerts(
                    createReq('POST', { body: { personId: target.id, toolId: tool.id, level: 'CERTIFIED' } }),
                ) as Response;
                expect(editRes.status).toBe(200);
                expect((await editRes.json()).certification.level).toBe('CERTIFIED');

                const rows = await prisma.auditLog.findMany({
                    where: { tableName: 'ToolStatus', affectedEntityId: target.id, secondaryAffectedEntity: tool.id },
                    orderBy: { id: 'asc' },
                });
                expect(rows.length).toBe(2);
                expect(rows[0].action).toBe('CREATE');

                const editRow = rows[1];
                expect(editRow.action).toBe('EDIT');
                expect(editRow.actorId).toBe(reCertifier.id); // the acting certifier, not an admin
                expect(editRow.oldData).not.toBeNull();
                expect((normalizeAuditData(editRow.oldData) as Record<string, unknown>).level).toBe('BASIC'); // prior level snapshot
            } finally {
                await prisma.auditLog.deleteMany({ where: { affectedEntityId: target.id, tableName: 'ToolStatus' } });
                await prisma.toolStatus.deleteMany({ where: { toolId: tool.id } });
                await prisma.tool.deleteMany({ where: { id: tool.id } });
                const hhIds = [reCertifier.householdId, target.householdId].filter((id): id is number => id !== null);
                await prisma.person.deleteMany({ where: { id: { in: [reCertifier.id, target.id] } } });
                await prisma.household.deleteMany({ where: { id: { in: hhIds } } });
            }
        });
    });
});
