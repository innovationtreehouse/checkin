/**
 * @jest-environment node
 */
/**
 * Integration Tests for Program Participants API
 * Tests POST and DELETE /api/programs/[id]/participants for enrollments
 */

import { POST, DELETE } from '@/app/api/programs/[id]/participants/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
// Mock Notifications
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn()
}));

describe('Program Participants API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    let otherId: number;
    let boardId: number;   // board member who leads a household
    let depId: number;     // dependent (25yo) in the board member's household

    let standardProgramId: number;
    let freeProgramId: number;
    let fullProgramId: number;
    let exactAgeProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'partic-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);

        await prisma.householdLead.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });

        await prisma.programParticipant.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Partic API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-partic-api-test@example.com', name: 'Admin', isSysadmin: true, household: { create: {} } }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.participant.create({
            data: { email: 'lead-partic-api-test@example.com', name: 'Lead', household: { create: {} } }
        });
        leadId = lead.id;

        // Create Common User (25 years old)
        const commonUser = await prisma.participant.create({
            data: {
                email: 'common-partic-api-test@example.com',
                name: 'Common',
                dateOfBirth: new Date(Date.now() - (25 * 31556952000)),
                household: { create: {} }
            }
        });
        commonId = commonUser.id;

        // Create Other User (underage: 10 years old)
        const otherUser = await prisma.participant.create({
            data: {
                email: 'other-partic-api-test@example.com',
                name: 'Other Underage',
                dateOfBirth: new Date(Date.now() - (10 * 31556952000)),
                household: { create: {} }
            }
        });
        otherId = otherUser.id;

        // Board member who leads a household containing a 25yo dependent. The
        // board flag lives on the session, not the DB row — see the mocks below.
        const boardHousehold = await prisma.household.create({ data: {} });
        const board = await prisma.participant.create({
            data: { email: 'board-partic-api-test@example.com', name: 'Board Parent', householdId: boardHousehold.id }
        });
        boardId = board.id;
        const dependent = await prisma.participant.create({
            data: {
                email: 'dep-partic-api-test@example.com',
                name: 'Board Dependent',
                dateOfBirth: new Date(Date.now() - (25 * 31556952000)),
                householdId: boardHousehold.id
            }
        });
        depId = dependent.id;
        await prisma.householdLead.create({
            data: { householdId: boardHousehold.id, participantId: boardId }
        });

        // Create mock programs
        const standardProgram = await prisma.program.create({
            data: { name: 'Standard Partic API Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', leadMentorId: leadId, memberPriceCents: 1000, nonMemberPriceCents: 1500 }
        });
        standardProgramId = standardProgram.id;

        const freeProgram = await prisma.program.create({
            data: { name: 'Free Partic API Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', leadMentorId: leadId, memberPriceCents: null, nonMemberPriceCents: null }
        });
        freeProgramId = freeProgram.id;

        // Create a capped program and pre-fill it to its capacity (1 participant)
        const fullProgram = await prisma.program.create({
            data: { 
                name: 'Full Partic API Test', 
                phase: 'RUNNING', 
                enrollmentStatus: 'OPEN',
                maxParticipants: 1,
                participants: {
                    create: { participantId: otherId }
                }
            }
        });
        fullProgramId = fullProgram.id;

        const exactAgeProgram = await prisma.program.create({
            data: { name: 'Age Restricted Partic API Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', minAge: 18, maxAge: 21 }
        });
        exactAgeProgramId = exactAgeProgram.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId, otherId, boardId, depId].filter(id => id !== undefined);
        const validProgramIds = [standardProgramId, freeProgramId, fullProgramId, exactAgeProgramId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.householdLead.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });
            await prisma.programParticipant.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });
        }

        if (validProgramIds.length > 0) {
            await prisma.program.deleteMany({
                where: { id: { in: validProgramIds } }
            });
        }
        
        if (existingUserIds.length > 0) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });

            await prisma.participant.deleteMany({
                where: { id: { in: existingUserIds } }
            });
        }
    });

    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    describe('POST /api/programs/[id]/participants', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId })
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(401);
        });

        it('should block a common user from enrolling someone else', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId }) // common trying to enroll other
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow a common user to self-enroll into a paid program as PENDING', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId }) // self-enrollment
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.participantId).toBe(commonId);
             expect(data.enrollment.status).toBe('PENDING');
        });

        it('should allow a common user to self-enroll into a free program as ACTIVE', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${freeProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId }) // self-enrollment
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(freeProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.participantId).toBe(commonId);
             expect(data.enrollment.status).toBe('ACTIVE');
        });

        it('should block self-enrollment if the program is at full capacity', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId })
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(fullProgramId) as unknown as never);
             expect(res.status).toBe(400); // 400 Bad Request
             
             const data = await res.json();
             expect(data.error).toMatch(/maximum capacity/);
             expect(data.requiresOverride).toBe(true);
        });

        it('should block self-enrollment if out of age constraints', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: otherId } }); // other is 10 years old

             const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId })
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
             expect(res.status).toBe(400);
             
             const data = await res.json();
             expect(data.error).toMatch(/at least 18/);
             expect(data.requiresOverride).toBe(true);
        });

        it('should allow admins to bypass age constraints using override', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId, override: true }) // ignoring age rules
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
        });

        // INTENT LOCK: a board/isSysadmin override DELIBERATELY overfills a program
        // past maxParticipants. The override is a confirmed action (the route first
        // returns requiresOverride:true) and is meant to bypass every soft limit —
        // closed enrollment, age, AND capacity. This 200 is correct, not a bug.
        // The non-override path still cannot overbook (see the 400 test above and
        // programsParticipantsConcurrency.integration.test.ts). Do not "fix" the
        // capacity bypass at route.ts enforceLimits to make this fail.
        it('should allow an admin override to enroll into a FULL program (deliberate overfill)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: adminId, override: true })
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(fullProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.status).toBe('ACTIVE'); // override → confirmed/paid bypass

             // Program is now intentionally over its cap of 1.
             const enrolled = await prisma.programParticipant.count({ where: { programId: fullProgramId } });
             expect(enrolled).toBe(2);
        });

        // A board member is also a parent. Enrolling their own dependent through
        // the public program page must behave like any household lead: PENDING
        // (awaiting Shopify payment), NOT a comped/free enrollment and NOT a
        // scary "bypasses all payment" override prompt.
        it('should make a board parent PAY (PENDING) when enrolling their own dependent in a paid program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: depId }) // no override
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.status).toBe('PENDING'); // pays like any parent
        });

        // The comp still belongs to genuine admin action: a board member
        // enrolling someone OUTSIDE their household (the program-ops surface).
        it('should require override + comp (ACTIVE) when a board member enrolls a non-household participant', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

             const promptReq = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId }) // not in board's household, no override
             });
             const promptRes = await POST(promptReq as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(promptRes.status).toBe(400);
             expect((await promptRes.json()).requiresOverride).toBe(true);

             const forceReq = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId, override: true })
             });
             const forceRes = await POST(forceReq as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(forceRes.status).toBe(200);
             expect((await forceRes.json()).enrollment.status).toBe('ACTIVE'); // admin comp
        });

        it('should return 409 (not 500) when enrolling the same participant twice', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const enroll = () => POST(
                 new Request(`http://localhost:4000/api/programs/${freeProgramId}/participants`, {
                     method: 'POST',
                     body: JSON.stringify({ participantId: leadId }) // self-enroll into free program
                 }) as unknown as import("next/server").NextRequest,
                 createParams(freeProgramId) as unknown as never
             );

             const first = await enroll();
             expect(first.status).toBe(200);

             // Double-submit (UI double-click) — must be a clean 409, not a 500.
             const second = await enroll();
             expect(second.status).toBe(409);
             const data = await second.json();
             expect(data.error).toMatch(/already enrolled/i);

             // No duplicate row, no corruption: exactly one enrollment exists.
             const count = await prisma.programParticipant.count({
                 where: { programId: freeProgramId, participantId: leadId }
             });
             expect(count).toBe(1);
        });
    });

    describe('DELETE /api/programs/[id]/participants', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: commonId })
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(401);
        });

        it('should block a common user from un-enrolling someone else', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: otherId })
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow the program lead to un-enroll a participant', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: commonId }) // assigned lead removing common from standardProgram
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.participantId).toBe(commonId);
        });
        
        it('should allow a common user to drop out of their own program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: otherId } });

             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: otherId }) // self-removal
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(fullProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
        });

        it('should be idempotent (200, not 500) when un-enrolling a participant twice', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: otherId } });

             // otherId already self-removed from fullProgram in the test above.
             // A second delete hits a missing row (Prisma P2025) — must stay 200.
             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: otherId })
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(fullProgramId) as unknown as never);
             expect(res.status).toBe(200);
             const data = await res.json();
             expect(data.success).toBe(true);
        });
    });
});
