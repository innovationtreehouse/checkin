/**
 * @jest-environment node
 */
/**
 * Integration tests for program soft-archive (docs/designs/PROGRAM_ARCHIVE.md):
 * archive → hidden from default lists → blocks new activity (enroll / payment-plan /
 * volunteer, 4xx with NO Shopify inventory side effect) → un-archive restores.
 * Plus one cron-skip case: the pending-participants sweep skips archived programs.
 */

import { GET as ListGET } from '@/app/api/programs/route';
import { PATCH as ProgramPATCH } from '@/app/api/programs/[id]/route';
import { POST as EnrollPOST } from '@/app/api/programs/[id]/participants/route';
import { POST as PlanPOST } from '@/app/api/programs/[id]/request-payment-plan/route';
import { POST as VolPOST } from '@/app/api/programs/[id]/volunteers/route';
import { GET as PendingCron } from '@/app/api/cron/pending-participants/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn(),
    notifyNewProgramAnnounced: jest.fn(),
}));

const asSession = (user: Record<string, unknown> | null) =>
    (getServerSession as jest.Mock).mockResolvedValue(user ? { user } : null);

const params = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) }) as unknown as never;
const nreq = (path: string, method: string, body?: unknown) =>
    new Request(`http://localhost:4000${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }) as unknown as import('next/server').NextRequest;

describe('Program archive integration', () => {
    let boardId: number;
    let commonId: number;
    let programId: number;

    beforeAll(async () => {
        const leaked = await prisma.person.findMany({ where: { email: { contains: 'prog-archive-test' } }, select: { id: true } });
        const leakedIds = leaked.map((u) => u.id);
        await prisma.programParticipant.deleteMany({ where: { personId: { in: leakedIds } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: leakedIds } } });
        await prisma.person.deleteMany({ where: { id: { in: leakedIds } } });
        await prisma.program.deleteMany({ where: { name: { contains: 'Prog Archive Test' } } });

        const board = await prisma.person.create({
            data: { email: 'board-prog-archive-test@example.com', name: 'Board', household: { create: { name: 'HH' } } },
        });
        boardId = board.id;
        const common = await prisma.person.create({
            data: {
                email: 'common-prog-archive-test@example.com',
                name: 'Common',
                dateOfBirth: new Date(Date.now() - 25 * 31556952000),
                household: { create: { name: 'HH' } },
            },
        });
        commonId = common.id;

        const program = await prisma.program.create({
            data: {
                name: 'Prog Archive Test Main',
                phase: 'RUNNING',
                enrollmentStatus: 'OPEN',
                nonOrgMemberPriceCents: 1500,
                shopifyVariantId: 'dev-mock-variant-prog-archive',
            },
        });
        programId = program.id;
    });

    afterAll(async () => {
        const ids = [boardId, commonId].filter((x) => x !== undefined);
        await prisma.programParticipant.deleteMany({ where: { personId: { in: ids } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
        await prisma.program.deleteMany({ where: { name: { contains: 'Prog Archive Test' } } });
        await prisma.person.deleteMany({ where: { id: { in: ids } } });
    });

    it('board archive via PATCH stamps archivedAt', async () => {
        asSession({ id: boardId, isBoardMember: true });
        const res = await ProgramPATCH(nreq(`/api/programs/${programId}`, 'PATCH', { archived: true }), params(programId));
        expect(res.status).toBe(200);
        const row = await prisma.program.findUnique({ where: { id: programId } });
        expect(row?.archivedAt).not.toBeNull();
    });

    it('hides the archived program from the default list, but a board can opt in', async () => {
        asSession({ id: commonId }); // plain member
        const hiddenRes = await ListGET(nreq('/api/programs', 'GET'));
        const hidden = (await hiddenRes.json()) as { id: number }[];
        expect(hidden.some((p) => p.id === programId)).toBe(false);

        asSession({ id: boardId, isBoardMember: true });
        const shownRes = await ListGET(nreq('/api/programs?includeArchived=true', 'GET'));
        const shown = (await shownRes.json()) as { id: number }[];
        expect(shown.some((p) => p.id === programId)).toBe(true);

        // includeArchived is board-gated: a plain member cannot use it to unhide.
        asSession({ id: commonId });
        const gatedRes = await ListGET(nreq('/api/programs?includeArchived=true', 'GET'));
        const gated = (await gatedRes.json()) as { id: number }[];
        expect(gated.some((p) => p.id === programId)).toBe(false);
    });

    it('blocks self-enrollment on an archived program (409, no participant row)', async () => {
        asSession({ id: commonId });
        const res = await EnrollPOST(nreq(`/api/programs/${programId}/participants`, 'POST', { participantId: commonId }), params(programId));
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/archived/i);
        const row = await prisma.programParticipant.findUnique({ where: { programId_personId: { programId, personId: commonId } } });
        expect(row).toBeNull();
    });

    it('blocks even a board force-enroll override on an archived program (hard freeze)', async () => {
        asSession({ id: boardId, isBoardMember: true });
        const res = await EnrollPOST(nreq(`/api/programs/${programId}/participants`, 'POST', { participantId: commonId, override: true }), params(programId));
        expect(res.status).toBe(409);
        const row = await prisma.programParticipant.findUnique({ where: { programId_personId: { programId, personId: commonId } } });
        expect(row).toBeNull();
    });

    it('blocks a payment-plan request with NO Shopify inventory side effect (-1 never fires)', async () => {
        // Pre-existing PENDING enrollment (from before the archive), no hold yet.
        await prisma.programParticipant.create({
            data: { programId, personId: commonId, status: 'PENDING', pendingSince: new Date() },
        });
        const prevEnv = process.env.CHECKIN_ENV;
        process.env.CHECKIN_ENV = 'local'; // arms the Shopify dev-mock "Would adjust inventory" log
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        try {
            asSession({ id: boardId, isBoardMember: true });
            // CHECKIN_ENV=local hijacks cookie-less requests as kiosk -> send a cookie.
            const req = new Request(`http://localhost:4000/api/programs/${programId}/request-payment-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', cookie: 'session=test' },
                body: JSON.stringify({ participantId: commonId }),
            }) as unknown as import('next/server').NextRequest;
            const res = await PlanPOST(req, params(programId));
            expect(res.status).toBe(409);
            expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Would adjust inventory'));
            const row = await prisma.programParticipant.findUnique({ where: { programId_personId: { programId, personId: commonId } } });
            expect(row?.inventoryHeldAt).toBeNull(); // no phantom hold
        } finally {
            logSpy.mockRestore();
            process.env.CHECKIN_ENV = prevEnv;
            await prisma.programParticipant.deleteMany({ where: { programId, personId: commonId } });
        }
    });

    it('blocks volunteer signup on an archived program (409)', async () => {
        asSession({ id: boardId, isBoardMember: true });
        const res = await VolPOST(nreq(`/api/programs/${programId}/volunteers`, 'POST', { participantId: commonId }), params(programId));
        expect(res.status).toBe(409);
        const row = await prisma.programVolunteer.findUnique({ where: { programId_personId: { programId, personId: commonId } } });
        expect(row).toBeNull();
    });

    it('un-archive restores the list visibility and enrollment', async () => {
        asSession({ id: boardId, isBoardMember: true });
        const unarch = await ProgramPATCH(nreq(`/api/programs/${programId}`, 'PATCH', { archived: false }), params(programId));
        expect(unarch.status).toBe(200);
        expect((await prisma.program.findUnique({ where: { id: programId } }))?.archivedAt).toBeNull();

        // Back in the default list.
        asSession({ id: commonId });
        const listRes = await ListGET(nreq('/api/programs', 'GET'));
        const list = (await listRes.json()) as { id: number }[];
        expect(list.some((p) => p.id === programId)).toBe(true);

        // Enrollment works again.
        const enroll = await EnrollPOST(nreq(`/api/programs/${programId}/participants`, 'POST', { participantId: commonId }), params(programId));
        expect(enroll.status).toBe(200);
        expect((await enroll.json()).enrollment.status).toBe('PENDING');
    });

    it('pending-participants cron skips archived programs but sweeps live ones', async () => {
        const DAY_MS = 24 * 60 * 60 * 1000;
        const stale = new Date(Date.now() - 8 * DAY_MS);
        const archived = await prisma.program.create({
            data: { name: 'Prog Archive Test Cron Archived', phase: 'UPCOMING', enrollmentStatus: 'OPEN', archivedAt: new Date() },
        });
        const live = await prisma.program.create({
            data: { name: 'Prog Archive Test Cron Live', phase: 'UPCOMING', enrollmentStatus: 'OPEN' },
        });
        await prisma.programParticipant.create({ data: { programId: archived.id, personId: commonId, status: 'PENDING', pendingSince: stale } });
        await prisma.programParticipant.create({ data: { programId: live.id, personId: boardId, status: 'PENDING', pendingSince: stale } });

        process.env.CRON_SECRET = 'test-secret';
        const res = await PendingCron(new Request('http://localhost:4000/api/cron/pending-participants', {
            method: 'GET',
            headers: { authorization: 'Bearer test-secret' },
        }) as unknown as Request);
        expect(res.status).toBe(200);

        // Archived program's stale row survives; the live program's does not.
        expect(await prisma.programParticipant.findUnique({ where: { programId_personId: { programId: archived.id, personId: commonId } } })).not.toBeNull();
        expect(await prisma.programParticipant.findUnique({ where: { programId_personId: { programId: live.id, personId: boardId } } })).toBeNull();

        await prisma.programParticipant.deleteMany({ where: { programId: { in: [archived.id, live.id] } } });
        await prisma.program.deleteMany({ where: { id: { in: [archived.id, live.id] } } });
    });
});
