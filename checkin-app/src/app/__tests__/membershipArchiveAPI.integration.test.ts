/**
 * @jest-environment node
 */
/**
 * Integration tests for board disposal of abandoned applications:
 * archive a stale non-ACTIVE process (drops off the board list, audit row),
 * refuse an ACTIVE membership (409), reject non-board (403), idempotent no-op.
 * Also the applicant side: a disposed process is terminal — a returning applicant
 * sees a clean slate, can file a fresh application (past the partial unique index),
 * and cannot resume or submit the archived one.
 */

import { POST as ARCHIVE } from '@/app/api/membership-ops/applications/archive/route';
import { GET as ADMIN_LIST } from '@/app/api/membership-ops/applications/route';
import { getIntakeState, startIntake, submitIntake } from '@/lib/membership/intake';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

const TAG = 'membership-archive-test';

function asBoard(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: true } });
}
function asUser(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: false } });
}
function req(body: unknown) {
    return new Request('http://localhost:4000/api/membership-ops/applications/archive', {
        method: 'POST',
        body: JSON.stringify(body),
    }) as unknown as Parameters<typeof ARCHIVE>[0];
}
function listReq() {
    return new Request('http://localhost:4000/api/membership-ops/applications') as unknown as Parameters<typeof ADMIN_LIST>[0];
}

async function makeProcess(label: string, status: 'INTAKE' | 'PENDING_EXTERNAL_ACTION' | 'PENDING_PAYMENT' | 'ACTIVE') {
    const hh = await prisma.household.create({ data: { name: `${label} ${TAG}` } });
    const m = await prisma.orgMembership.create({ data: { householdId: hh.id, status: 'NONE' } });
    const p = await prisma.orgMembershipProcess.create({ data: { orgMembershipId: m.id, kind: 'INITIAL', status } });
    return { householdId: hh.id, processId: p.id };
}

// A full applicant household: a lead (guardian) + membership + INITIAL process,
// so the intake service (getIntakeState/startIntake/submitIntake) can run.
async function makeApplicant(label: string, status: 'INTAKE' | 'PENDING_PAYMENT') {
    const hh = await prisma.household.create({ data: { name: `${label} ${TAG}` } });
    const lead = await prisma.person.create({ data: { name: `${label} Parent`, householdId: hh.id } });
    await prisma.householdLead.create({ data: { householdId: hh.id, personId: lead.id } });
    const m = await prisma.orgMembership.create({ data: { householdId: hh.id, status: 'NONE' } });
    const p = await prisma.orgMembershipProcess.create({ data: { orgMembershipId: m.id, kind: 'INITIAL', status } });
    return { householdId: hh.id, membershipId: m.id, userId: lead.id, processId: p.id };
}

async function wipe() {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    if (ids.length) {
        await prisma.orgMembershipProcess.deleteMany({ where: { orgMembership: { householdId: { in: ids } } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.person.deleteMany({ where: { email: { contains: TAG } } });
}

describe('Membership application archive API', () => {
    let boardId: number, plainId: number;

    beforeAll(async () => {
        await wipe();
        boardId = (await prisma.person.create({ data: { name: 'board', email: `board-${TAG}@example.com`, isBoardMember: true, household: { create: { name: `board HH ${TAG}` } } } })).id;
        plainId = (await prisma.person.create({ data: { name: 'plain', email: `plain-${TAG}@example.com`, household: { create: { name: `plain HH ${TAG}` } } } })).id;
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    it.each(['INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_PAYMENT'] as const)(
        'board archives a stale %s process → status ARCHIVED, drops off the list, audit written',
        async (status) => {
            const { processId } = await makeProcess(`Stale-${status}`, status);
            asBoard(boardId);
            const res = await ARCHIVE(req({ processId }) as never);
            expect(res.status).toBe(200);

            // Transitions to the terminal ARCHIVED status (single declarative axis).
            const after = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
            expect(after?.status).toBe('ARCHIVED');

            // No longer surfaces on the board applications list.
            const listRes = await ADMIN_LIST(listReq() as never);
            const listed = (await listRes.json()).processes.map((p: { id: number }) => p.id);
            expect(listed).not.toContain(processId);

            // The audit row captures who + the phase it was archived from.
            const audit = await prisma.auditLog.findFirst({ where: { tableName: 'OrgMembershipProcess', affectedEntityId: processId }, orderBy: { id: 'desc' } });
            expect(audit?.actorId).toBe(boardId);
            expect(audit?.oldData).toMatchObject({ status });
            expect(audit?.newData).toMatchObject({ status: 'ARCHIVED' });
        },
    );

    it('refuses to archive an ACTIVE membership (409 wrong_phase), state unchanged', async () => {
        const { processId } = await makeProcess('Active', 'ACTIVE');
        asBoard(boardId);
        const res = await ARCHIVE(req({ processId }) as never);
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('wrong_phase');
        const after = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(after?.status).toBe('ACTIVE');
    });

    it('rejects a non-board user (403)', async () => {
        const { processId } = await makeProcess('Forbidden', 'INTAKE');
        asUser(plainId);
        const res = await ARCHIVE(req({ processId }) as never);
        expect(res.status).toBe(403);
        const after = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(after?.status).toBe('INTAKE');
    });

    it('archiving an already-archived process is an idempotent no-op (200, no second audit)', async () => {
        const { processId } = await makeProcess('Idempotent', 'INTAKE');
        asBoard(boardId);
        await ARCHIVE(req({ processId }) as never);
        const auditCount = () => prisma.auditLog.count({ where: { tableName: 'OrgMembershipProcess', affectedEntityId: processId } });
        const before = await auditCount();

        const res = await ARCHIVE(req({ processId }) as never);
        expect(res.status).toBe(200);
        const second = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(second?.status).toBe('ARCHIVED');
        expect(await auditCount()).toBe(before);
    });

    it('archiving a non-existent process returns 404 not_found', async () => {
        asBoard(boardId);
        const res = await ARCHIVE(req({ processId: 999999999 }) as never);
        expect(res.status).toBe(404);
        expect((await res.json()).code).toBe('not_found');
    });

    // --- applicant side: a disposed process is terminal ---

    it('after archive, the applicant sees a clean slate and can file a fresh application', async () => {
        const { userId, processId, membershipId } = await makeApplicant('Returning', 'INTAKE');
        asBoard(boardId);
        await ARCHIVE(req({ processId }) as never);

        // Clean slate: the disposed process no longer surfaces as in-flight.
        const state = await getIntakeState(userId);
        expect(state.process).toBeNull();

        // Start again → a brand-new process, not the archived one, and no P2002 from
        // the partial unique index (ARCHIVED isn't in its in-flight status set, so
        // the disposed row no longer occupies the one-in-flight slot).
        const fresh = await startIntake(userId);
        expect(fresh.id).not.toBe(processId);
        expect(fresh.status).toBe('INTAKE');
        expect(fresh.orgMembershipId).toBe(membershipId);

        // The archived process is untouched — still on record, terminal ARCHIVED.
        const old = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(old?.status).toBe('ARCHIVED');
    });

    it('a board-archived INTAKE cannot be resumed or submitted', async () => {
        const { userId, processId } = await makeApplicant('NoResume', 'INTAKE');
        asBoard(boardId);
        await ARCHIVE(req({ processId }) as never);

        // startIntake must not hand back the archived process — it opens a new one.
        const started = await startIntake(userId);
        expect(started.id).not.toBe(processId);

        // submitIntake only ever targets a live INTAKE — archive the fresh one too
        // and confirm submit finds no process to act on.
        await prisma.orgMembershipProcess.update({ where: { id: started.id }, data: { status: 'ARCHIVED' } });
        await expect(submitIntake(userId)).rejects.toMatchObject({ code: 'no_process' });
    });
});
