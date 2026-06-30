/**
 * @jest-environment node
 */
/**
 * Integration Tests for Individual Program API
 * Tests GET and PATCH /api/programs/[id] for viewing and updating a specific program
 */

import { GET, PATCH } from '@/app/api/programs/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
describe('Individual Program API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    let memberId: number;
    let memberHouseholdId: number;
    let enrolledId: number;
    let publicProgramId: number;
    let memberOnlyProgramId: number;

    // Distinctive name we assert NEVER appears in an anonymous response — the
    // roster/association leak (#P0-5.1a) is closed iff this string is absent.
    const ENROLLED_NAME = 'Roster Leak Canary';

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'prog-id-api-test' } },
            select: { id: true, householdId: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        const existingHouseholdIds = existingUsers.map(u => u.householdId);

        await prisma.membership.deleteMany({
            where: { householdId: { in: existingHouseholdIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Prog ID API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-prog-id-api-test@example.com', name: 'Admin', isSysadmin: true, household: { create: {} } }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.participant.create({
            data: { email: 'lead-prog-id-api-test@example.com', name: 'Lead', household: { create: {} } }
        });
        leadId = lead.id;

        // Create Common User (no membership)
        const commonUser = await prisma.participant.create({
            data: { email: 'common-prog-id-api-test@example.com', name: 'Common', household: { create: {} } }
        });
        commonId = commonUser.id;

        // Create Member User (household holds an active membership)
        const memberUser = await prisma.participant.create({
            data: {
                email: 'member-prog-id-api-test@example.com',
                name: 'Member',
                household: {
                    create: {
                        membership: {
                            create: {
                                status: 'ACTIVE',
                                memberSince: new Date()
                            }
                        }
                    }
                }
            },
            select: { id: true, householdId: true }
        });
        memberId = memberUser.id;
        memberHouseholdId = memberUser.householdId;

        // Create mock programs
        const publicProgram = await prisma.program.create({
            data: { name: 'Public Prog ID API Test', phase: 'RUNNING', memberOnly: false, leadMentorId: leadId }
        });
        publicProgramId = publicProgram.id;

        const memberOnlyProgram = await prisma.program.create({
            data: { name: 'Member Only Prog ID API Test', phase: 'RUNNING', memberOnly: true, leadMentorId: leadId }
        });
        memberOnlyProgramId = memberOnlyProgram.id;

        // Enroll a participant with a recognizable name into the public program so
        // the leak tests have a roster identity to look for.
        const enrolled = await prisma.participant.create({
            data: { email: 'enrolled-prog-id-api-test@example.com', name: ENROLLED_NAME, household: { create: {} } }
        });
        enrolledId = enrolled.id;
        await prisma.programParticipant.create({
            data: { programId: publicProgramId, participantId: enrolledId, status: 'ACTIVE' }
        });
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId, memberId, enrolledId];

        if (memberHouseholdId) {
            await prisma.membership.deleteMany({
                where: { householdId: memberHouseholdId }
            });
        }

        const validProgramIds = [publicProgramId, memberOnlyProgramId].filter(id => id !== undefined);
        if (validProgramIds.length > 0) {
            // ProgramParticipant has no cascade — clear enrollments before the program.
            await prisma.programParticipant.deleteMany({
                where: { programId: { in: validProgramIds } }
            });
            await prisma.program.deleteMany({
                where: { id: { in: validProgramIds } }
            });
        }
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });
    });

    // Helper function to mock Next.js App Router params
    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    describe('GET /api/programs/[id]', () => {
        it('should allow unauthenticated users to view public programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.name).toBe('Public Prog ID API Test');
        });

        it('should return 404 Not Found for invalid program ID', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId } });

             const req = new Request('http://localhost:4000/api/programs/999999', { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(999999) as unknown as never);
             expect(res.status).toBe(404);
        });

        it('should allow common users to view public programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.name).toBe('Public Prog ID API Test');
             expect(data.leadMentor.id).toBe(leadId);
        });

        it('should block common users from viewing member-only programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${memberOnlyProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(memberOnlyProgramId) as unknown as never);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow active members to view member-only programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: memberId } });

             const req = new Request(`http://localhost:4000/api/programs/${memberOnlyProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(memberOnlyProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.name).toBe('Member Only Prog ID API Test');
        });

        it('should allow admins to view member-only programs without active membership', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${memberOnlyProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(memberOnlyProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.name).toBe('Member Only Prog ID API Test');
        });

        // ── Roster / association leak regression (auth-consistency §5.1a) ───────────
        // ProgramParticipant rows + Participant.name are tier 'public', so per-field
        // stripping cannot hide WHO is enrolled. The route gates the association:
        // anonymous/non-enrolled get metadata + counts only, never the roster.
        it('does NOT leak the participant roster to an unauthenticated caller', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             // Metadata still flows (public catalog/registration page).
             expect(data.name).toBe('Public Prog ID API Test');
             // Roster rows are absent — no participant/volunteer arrays at all.
             expect(data.participants).toBeUndefined();
             expect(data.volunteers).toBeUndefined();
             // The enrolled identity must not appear anywhere in the payload.
             expect(JSON.stringify(data)).not.toContain(ENROLLED_NAME);
             // Capacity is preserved via an aggregate count, not the rows.
             expect(data._count?.participants).toBe(1);
        });

        it('does NOT leak the roster to a plain authenticated non-enrolled caller', async () => {
             // memberId is authenticated but not enrolled in / staffing this program.
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: memberId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.name).toBe('Public Prog ID API Test');
             expect(data.participants).toBeUndefined();
             expect(JSON.stringify(data)).not.toContain(ENROLLED_NAME);
        });

        it('returns the roster to the program lead mentor (staff tier unchanged)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(Array.isArray(data.participants)).toBe(true);
             expect(data.participants.some((p: { participantId: number }) => p.participantId === enrolledId)).toBe(true);
             expect(JSON.stringify(data)).toContain(ENROLLED_NAME);
        });

        it('returns the roster to an enrolled participant (their own household)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: enrolledId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(Array.isArray(data.participants)).toBe(true);
             expect(data.participants.some((p: { participantId: number }) => p.participantId === enrolledId)).toBe(true);
        });
    });

    describe('PATCH /api/programs/[id]', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Hacked' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(401);
        });

        // GAP-1: PATCH had no denied gate before the withAuth conversion. A denied
        // household is locked out at admission now, even the program's own lead mentor,
        // and no mutation occurs.
        it('should reject a denied household (even the lead mentor) with 401 and not mutate', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId, denied: true } });

             const before = await prisma.program.findUnique({ where: { id: publicProgramId } });
             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Denied Should Not Persist' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(401);

             const after = await prisma.program.findUnique({ where: { id: publicProgramId } });
             expect(after?.name).toBe(before?.name);
        });

        it('should block common users from updating a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Hacked' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(403);
        });

        it('should allow the assigned lead mentor to update a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ maxParticipants: 50 })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.program.maxParticipants).toBe(50);
        });

        it('should allow admins to update a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ phase: 'FINISHED' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.program.phase).toBe('FINISHED');
        });

        // Denied-household lockout (auth-consistency §5 risk #2 / GAP-1). A denied
        // lead mentor keeps `user.id`, so the leadMentorId-match gate would still
        // pass — the denied check must reject before any mutation. No write occurs.
        it('blocks a denied lead mentor from editing their own program (401, no mutation)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId, denied: true } });

             const before = await prisma.program.findUnique({ where: { id: publicProgramId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Denied Hack' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(401);

             const after = await prisma.program.findUnique({ where: { id: publicProgramId } });
             expect(after?.name).toBe(before?.name);
             expect(after?.name).not.toBe('Denied Hack');
        });
    });
});
