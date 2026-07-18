/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Roles API
 * Tests GET and PATCH /api/roles for fetching and updating user roles.
 *
 * The PATCH matrix (PR-1, roles foundation): board grants/revokes ALL five
 * flags (including isSysadmin and removing isBoardMember); a sysadmin-only
 * actor (not board) may grant any flag, including adding board, but may
 * never remove board membership (403); the last board member can never be
 * removed (409), guarded by a `SELECT ... FOR UPDATE` lock over the board
 * set inside a transaction. Board-actor tests below deliberately create
 * their OWN board-member fixtures (rather than one file-wide board actor)
 * so the last-board-guard describes can reason about the GLOBAL board count
 * precisely — the guard counts every Person with isBoardMember=true, not
 * just this file's fixtures.
 */
import { GET, PATCH } from '@/app/api/roles/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

const TAG = 'roles-api-test';

function patchReq(body: unknown) {
    return new Request('http://localhost:4000/api/roles', {
        method: 'PATCH',
        body: JSON.stringify(body),
    }) as unknown as import("next/server").NextRequest;
}

function getReq() {
    return new Request('http://localhost:4000/api/roles', { method: 'GET' }) as unknown as import("next/server").NextRequest;
}

function asSession(user: Record<string, unknown>) {
    (getServerSession as jest.Mock).mockResolvedValue({ user });
}

describe('Admin Roles API Integration Tests', () => {
    let testSysAdminId: number;
    let testUserId: number;
    let testTargetUserId: number;
    let testStudentId: number;

    async function wipeTagged() {
        const existingUsers = await prisma.person.findMany({
            where: { email: { contains: TAG } },
            select: { id: true },
        });
        const ids = existingUsers.map((u) => u.id);
        await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
        await prisma.person.deleteMany({ where: { id: { in: ids } } });
    }

    beforeAll(async () => {
        await wipeTagged();

        const sysadmin = await prisma.person.create({
            data: { email: `sysadmin-${TAG}@example.com`, name: 'Admin Roles Test', isSysadmin: true, household: { create: { name: "Test HH" } } },
        });
        testSysAdminId = sysadmin.id;

        const user = await prisma.person.create({
            data: { email: `user-${TAG}@example.com`, name: 'User Roles Test', household: { create: { name: "Test HH" } } },
        });
        testUserId = user.id;

        const targetUser = await prisma.person.create({
            data: { email: `target-${TAG}@example.com`, name: 'Target Roles Test', dateOfBirth: new Date('1990-01-01'), household: { create: { name: "Test HH" } } },
        });
        testTargetUserId = targetUser.id;

        const now = new Date();
        const tenYearsAgo = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
        const student = await prisma.person.create({
            data: { email: `student-${TAG}@example.com`, name: 'Student Roles Test', dateOfBirth: tenYearsAgo, household: { create: { name: "Test HH" } } },
        });
        testStudentId = student.id;
    });

    afterAll(async () => {
        await wipeTagged();
    });

    beforeEach(() => jest.clearAllMocks());

    describe('GET /api/roles', () => {
        it('should return 401 Unauthorized without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);
            const res = await GET(getReq());
            expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
            asSession({ id: testUserId });
            const res = await GET(getReq());
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toContain('Forbidden');
        });

        it('should return all participants (youth flagged, dob hidden) for a isSysadmin', async () => {
            asSession({ id: testSysAdminId, isSysadmin: true });
            const res = await GET(getReq());
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.people).toBeDefined();
            expect(Array.isArray(data.people)).toBe(true);

            const ids = data.people.map((p: { id?: number }) => p.id);
            expect(ids).toContain(testTargetUserId);
            expect(ids).toContain(testStudentId);
            const adult = data.people.find((p: { id?: number }) => p.id === testTargetUserId);
            const student = data.people.find((p: { id?: number }) => p.id === testStudentId);
            expect(adult.isYouth).toBe(false);
            expect(student.isYouth).toBe(true);
            expect(adult).not.toHaveProperty('dateOfBirth');
            expect(student).not.toHaveProperty('dateOfBirth');
            // isOperations now rides along with the other four flags.
            expect(adult).toHaveProperty('isOperations');
        });
    });

    describe('PATCH /api/roles — validation', () => {
        it('should return 401 Unauthorized without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);
            const res = await PATCH(patchReq({ targetUserId: testTargetUserId, isBoardMember: true }));
            expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
            asSession({ id: testUserId });
            const res = await PATCH(patchReq({ targetUserId: testTargetUserId, isBoardMember: true }));
            expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if targetUserId is missing', async () => {
            asSession({ id: testSysAdminId, isSysadmin: true });
            const res = await PATCH(patchReq({ isBoardMember: true }));
            expect(res.status).toBe(400);
        });

        it('should return 400 for an unknown role flag', async () => {
            asSession({ id: testSysAdminId, isSysadmin: true });
            const res = await PATCH(patchReq({ targetUserId: testTargetUserId, isWizard: true }));
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain('isWizard');
        });

        it('should return 400 when no valid role fields are provided', async () => {
            asSession({ id: testSysAdminId, isSysadmin: true });
            const res = await PATCH(patchReq({ targetUserId: testTargetUserId }));
            expect(res.status).toBe(400);
        });

        it('should return 404 for a non-existent target', async () => {
            asSession({ id: testSysAdminId, isSysadmin: true });
            const res = await PATCH(patchReq({ targetUserId: 999_999_999, isOperations: true }));
            expect(res.status).toBe(404);
        });

        it('self-edit: a sysadmin may change their own non-board flag', async () => {
            asSession({ id: testSysAdminId, isSysadmin: true });
            const res = await PATCH(patchReq({ targetUserId: testSysAdminId, isOperations: true }));
            expect(res.status).toBe(200);
            const row = await prisma.person.findUnique({ where: { id: testSysAdminId } });
            expect(row?.isOperations).toBe(true);
        });
    });

    describe('PATCH /api/roles — board actor matrix', () => {
        let boardActorId: number;
        let board2Id: number;

        beforeAll(async () => {
            const boardActor = await prisma.person.create({
                data: { email: `board-actor-${TAG}@example.com`, name: 'Board Actor', isBoardMember: true, household: { create: { name: "Test HH" } } },
            });
            boardActorId = boardActor.id;
            const board2 = await prisma.person.create({
                data: { email: `board2-${TAG}@example.com`, name: 'Board Two', isBoardMember: true, household: { create: { name: "Test HH" } } },
            });
            board2Id = board2.id;
        });

        afterAll(async () => {
            await prisma.auditLog.deleteMany({ where: { actorId: { in: [boardActorId, board2Id] } } });
            await prisma.person.deleteMany({ where: { id: { in: [boardActorId, board2Id] } } });
        });

        it('board grants isSysadmin on a target -> 200 (reverses the old board-cannot-touch-sysadmin guard)', async () => {
            asSession({ id: boardActorId, isBoardMember: true });
            const res = await PATCH(patchReq({ targetUserId: testTargetUserId, isSysadmin: true }));
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.message).toBe("Roles updated successfully");
            expect(data.user.isSysadmin).toBe(true);

            const row = await prisma.person.findUnique({ where: { id: testTargetUserId } });
            expect(row?.isSysadmin).toBe(true);
        });

        it('board grants/revokes isKeyholder, isBackgroundCheckReviewer, isOperations -> 200', async () => {
            asSession({ id: boardActorId, isBoardMember: true });

            const grant = await PATCH(patchReq({
                targetUserId: testTargetUserId,
                isKeyholder: true,
                isBackgroundCheckReviewer: true,
                isOperations: true,
            }));
            expect(grant.status).toBe(200);
            let row = await prisma.person.findUnique({ where: { id: testTargetUserId } });
            expect(row?.isKeyholder).toBe(true);
            expect(row?.isBackgroundCheckReviewer).toBe(true);
            expect(row?.isOperations).toBe(true);

            const revoke = await PATCH(patchReq({ targetUserId: testTargetUserId, isKeyholder: false }));
            expect(revoke.status).toBe(200);
            row = await prisma.person.findUnique({ where: { id: testTargetUserId } });
            expect(row?.isKeyholder).toBe(false);
        });

        it('writes an audit row with per-flag before/after on a successful change', async () => {
            asSession({ id: boardActorId, isBoardMember: true });
            const before = await prisma.person.findUnique({ where: { id: testTargetUserId }, select: { isOperations: true } });
            const res = await PATCH(patchReq({ targetUserId: testTargetUserId, isOperations: !before?.isOperations }));
            expect(res.status).toBe(200);

            const audit = await prisma.auditLog.findFirst({
                where: { actorId: boardActorId, affectedEntityId: testTargetUserId, action: 'EDIT' },
                orderBy: { id: 'desc' },
            });
            expect(audit).not.toBeNull();
            expect(audit?.tableName).toBe('Participant');
            expect(audit?.newData).toMatchObject({ isOperations: !before?.isOperations });
            expect(audit?.oldData).toMatchObject({ isOperations: !!before?.isOperations });
        });

        it('board removes board membership from another board member -> 200 (>=2 board members present)', async () => {
            asSession({ id: boardActorId, isBoardMember: true });
            const countBefore = await prisma.person.count({ where: { isBoardMember: true } });
            expect(countBefore).toBeGreaterThanOrEqual(2);

            const res = await PATCH(patchReq({ targetUserId: board2Id, isBoardMember: false }));
            expect(res.status).toBe(200);

            const row = await prisma.person.findUnique({ where: { id: board2Id } });
            expect(row?.isBoardMember).toBe(false);
        });

        it('a present flag equal to the current value is a no-op (still 200, no audit row written)', async () => {
            asSession({ id: boardActorId, isBoardMember: true });
            const before = await prisma.person.findUnique({ where: { id: testTargetUserId }, select: { isKeyholder: true } });
            const auditCountBefore = await prisma.auditLog.count({ where: { actorId: boardActorId, affectedEntityId: testTargetUserId } });

            const res = await PATCH(patchReq({ targetUserId: testTargetUserId, isKeyholder: !!before?.isKeyholder }));
            expect(res.status).toBe(200);

            const auditCountAfter = await prisma.auditLog.count({ where: { actorId: boardActorId, affectedEntityId: testTargetUserId } });
            expect(auditCountAfter).toBe(auditCountBefore);
        });
    });

    describe('PATCH /api/roles — sysadmin-only board grant/revoke', () => {
        let plainTargetId: number;

        beforeAll(async () => {
            const plain = await prisma.person.create({
                data: { email: `sysadmin-target-${TAG}@example.com`, name: 'Sysadmin Target', household: { create: { name: "Test HH" } } },
            });
            plainTargetId = plain.id;
        });

        afterAll(async () => {
            await prisma.auditLog.deleteMany({ where: { affectedEntityId: plainTargetId } });
            await prisma.person.deleteMany({ where: { id: plainTargetId } });
        });

        it('sysadmin-only adds board -> 200', async () => {
            asSession({ id: testSysAdminId, isSysadmin: true });
            const res = await PATCH(patchReq({ targetUserId: plainTargetId, isBoardMember: true }));
            expect(res.status).toBe(200);
            const row = await prisma.person.findUnique({ where: { id: plainTargetId } });
            expect(row?.isBoardMember).toBe(true);
        });

        it('sysadmin-only grants/revokes a non-board flag incl. isOperations -> 200', async () => {
            asSession({ id: testSysAdminId, isSysadmin: true });
            const res = await PATCH(patchReq({ targetUserId: plainTargetId, isOperations: true }));
            expect(res.status).toBe(200);
            const row = await prisma.person.findUnique({ where: { id: plainTargetId } });
            expect(row?.isOperations).toBe(true);
        });

        it('sysadmin-only removes board -> 403 (message asserted), target unchanged', async () => {
            asSession({ id: testSysAdminId, isSysadmin: true });
            const res = await PATCH(patchReq({ targetUserId: plainTargetId, isBoardMember: false }));
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe("Only board members can remove board membership");

            const row = await prisma.person.findUnique({ where: { id: plainTargetId } });
            expect(row?.isBoardMember).toBe(true);
        });
    });

    describe('PATCH /api/roles — last-board guard', () => {
        let loneBoardId: number;

        beforeAll(async () => {
            const ambientBoardCount = await prisma.person.count({ where: { isBoardMember: true } });
            if (ambientBoardCount !== 0) {
                throw new Error(`Expected zero ambient board members before this describe, found ${ambientBoardCount}. A prior describe's board fixtures leaked.`);
            }
            const lone = await prisma.person.create({
                data: { email: `lone-board-${TAG}@example.com`, name: 'Lone Board', isBoardMember: true, household: { create: { name: "Test HH" } } },
            });
            loneBoardId = lone.id;
        });

        afterAll(async () => {
            await prisma.auditLog.deleteMany({ where: { actorId: loneBoardId } });
            await prisma.person.deleteMany({ where: { id: loneBoardId } });
        });

        it('removing the last board member -> 409, board membership unchanged', async () => {
            asSession({ id: loneBoardId, isBoardMember: true });
            const res = await PATCH(patchReq({ targetUserId: loneBoardId, isBoardMember: false }));
            expect(res.status).toBe(409);
            const data = await res.json();
            expect(data.error).toBe("Cannot remove the last board member");

            const row = await prisma.person.findUnique({ where: { id: loneBoardId } });
            expect(row?.isBoardMember).toBe(true);
        });
    });

    describe('PATCH /api/roles — concurrent last-board race (FOR UPDATE lock)', () => {
        let raceAId: number;
        let raceBId: number;

        beforeAll(async () => {
            const ambientBoardCount = await prisma.person.count({ where: { isBoardMember: true } });
            if (ambientBoardCount !== 0) {
                throw new Error(`Expected zero ambient board members before this describe, found ${ambientBoardCount}. A prior describe's board fixtures leaked.`);
            }
            const a = await prisma.person.create({
                data: { email: `race-a-${TAG}@example.com`, name: 'Race A', isBoardMember: true, household: { create: { name: "Test HH" } } },
            });
            raceAId = a.id;
            const b = await prisma.person.create({
                data: { email: `race-b-${TAG}@example.com`, name: 'Race B', isBoardMember: true, household: { create: { name: "Test HH" } } },
            });
            raceBId = b.id;
        });

        afterAll(async () => {
            await prisma.auditLog.deleteMany({ where: { actorId: { in: [raceAId, raceBId] } } });
            await prisma.person.deleteMany({ where: { id: { in: [raceAId, raceBId] } } });
        });

        it('two concurrent self-removals with count==2 -> exactly one 200 and one 409; final count is 1', async () => {
            // Deterministic mock-identity assignment: Promise.all evaluates its array
            // left-to-right, and each PATCH call synchronously reaches its
            // getServerSession() call (the first await inside authenticateRequest)
            // before the next array element is even invoked — so the first queued
            // mock value always resolves for reqA, the second for reqB, regardless
            // of which transaction's DB work finishes first.
            (getServerSession as jest.Mock)
                .mockResolvedValueOnce({ user: { id: raceAId, isBoardMember: true } })
                .mockResolvedValueOnce({ user: { id: raceBId, isBoardMember: true } });

            const [resA, resB] = await Promise.all([
                PATCH(patchReq({ targetUserId: raceAId, isBoardMember: false })),
                PATCH(patchReq({ targetUserId: raceBId, isBoardMember: false })),
            ]);

            const statuses = [resA.status, resB.status].sort();
            expect(statuses).toEqual([200, 409]);

            const loser = resA.status === 409 ? resA : resB;
            const loserData = await loser.json();
            expect(loserData.error).toBe("Cannot remove the last board member");

            const finalBoardCount = await prisma.person.count({ where: { isBoardMember: true, id: { in: [raceAId, raceBId] } } });
            expect(finalBoardCount).toBe(1);
        });
    });
});
