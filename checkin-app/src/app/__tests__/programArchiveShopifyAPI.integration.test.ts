/**
 * @jest-environment node
 */
/**
 * Integration tests for POST /api/programs/[id]/archive-shopify — the
 * board/sysadmin action that retires (archives) / restores a program's Shopify
 * listing (docs/designs/SHOPIFY_LISTING_ARCHIVE.md).
 *
 * Covers: authz, the archive/un-archive/idempotent/no-listing/404 contract, and
 * that archiving BLOCKS the checkout-affecting routes (sync-shopify 400,
 * discount-code → { code: null }, PATCH capacity push skipped) while un-archiving
 * RESTORES them (sync-shopify repairs again).
 *
 * Runs against the CHECKIN_ENV=local Shopify mock (config.shopifyMockActive) so
 * setProgramListingArchived / the sync-create fns / adjustProgramInventory hit
 * the synthetic mock branch instead of the real Admin API — same explicit env
 * gate the sibling program-Shopify suites use.
 */
import { POST as archivePost } from '@/app/api/programs/[id]/archive-shopify/route';
import { POST as syncPost } from '@/app/api/programs/[id]/sync-shopify/route';
import { POST as discountPost } from '@/app/api/programs/[id]/discount-code/route';
import { PATCH } from '@/app/api/programs/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

const TAG = 'archive-shopify-api-test';
const params = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) }) as unknown as never;
// CHECKIN_ENV=local arms the keyless-kiosk fallback in authenticateRequest, which
// hijacks a cookie-less request as `kiosk` → 403 before the role gate — so every
// request carries a cookie (mirrors the sync-shopify suite).
const req = (body?: unknown) =>
    new Request('http://localhost/api/programs/x/archive-shopify', {
        method: 'POST',
        headers: { cookie: 'session=test', 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }) as unknown as import('next/server').NextRequest;

describe('POST /api/programs/[id]/archive-shopify', () => {
    let adminId: number;
    let boardId: number;
    let commonId: number;
    let prevCheckinEnv: string | undefined;

    beforeAll(async () => {
        prevCheckinEnv = process.env.CHECKIN_ENV;
        process.env.CHECKIN_ENV = 'local';

        const admin = await prisma.person.create({
            data: { email: `admin-${TAG}@example.com`, name: 'Admin', isSysadmin: true, household: { create: { name: 'Test HH' } } },
        });
        adminId = admin.id;
        const board = await prisma.person.create({
            data: { email: `board-${TAG}@example.com`, name: 'Board', isBoardMember: true, household: { create: { name: 'Test HH' } } },
        });
        boardId = board.id;
        const common = await prisma.person.create({
            data: { email: `common-${TAG}@example.com`, name: 'Common', household: { create: { name: 'Test HH' } } },
        });
        commonId = common.id;
    });

    afterAll(async () => {
        const ids = [adminId, boardId, commonId];
        await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
        await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
        await prisma.person.deleteMany({ where: { id: { in: ids } } });
        process.env.CHECKIN_ENV = prevCheckinEnv;
    });

    // A live single-pool listing: product + variant + prices + capacity.
    const makeListedProgram = (extra: Record<string, unknown> = {}) =>
        prisma.program.create({
            data: {
                name: `Listed Prog ${TAG} ${Math.round(performance.now() * 1000)}`,
                phase: 'RUNNING',
                orgMemberPriceCents: 5000,
                nonOrgMemberPriceCents: 7500,
                maxParticipants: 10,
                shopifyProductId: 'dev-mock-product-listed',
                shopifyVariantId: 'dev-mock-variant-listed',
                ...extra,
            },
        });

    it('rejects an anon caller (401) and a plain user (403) — the role gate', async () => {
        const program = await makeListedProgram();

        // Anon (no session, but a cookie so the keyless-kiosk fallback is not armed).
        (getServerSession as jest.Mock).mockResolvedValue(null);
        expect((await archivePost(req({ archived: true }), params(program.id))).status).toBe(401);

        // Authenticated but no isSysadmin/isBoardMember role.
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });
        expect((await archivePost(req({ archived: true }), params(program.id))).status).toBe(403);

        const after = await prisma.program.findUnique({ where: { id: program.id } });
        expect(after?.shopifyArchivedAt).toBeNull(); // gate held: no stamp
    });

    it('archives a listed program: stamps shopifyArchivedAt, audits, 200', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
        const program = await makeListedProgram();

        const res = await archivePost(req({ archived: true }), params(program.id));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.warning).toBeUndefined(); // mock branch succeeds → no reconcile warning
        expect(data.program.shopifyArchivedAt).not.toBeNull();

        const persisted = await prisma.program.findUnique({ where: { id: program.id } });
        expect(persisted?.shopifyArchivedAt).not.toBeNull();

        const audit = await prisma.auditLog.findFirst({
            where: { actorId: boardId, tableName: 'Program', affectedEntityId: program.id, action: 'EDIT' },
        });
        expect(audit).not.toBeNull();
    });

    it('un-archives (archived:false) back to a live listing (clears the stamp)', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const program = await makeListedProgram({ shopifyArchivedAt: new Date() });

        const res = await archivePost(req({ archived: false }), params(program.id));
        expect(res.status).toBe(200);
        expect((await res.json()).program.shopifyArchivedAt).toBeNull();

        const persisted = await prisma.program.findUnique({ where: { id: program.id } });
        expect(persisted?.shopifyArchivedAt).toBeNull();
    });

    it('is idempotent: archiving an already-archived program is a 200 no-op', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
        const stamp = new Date('2026-01-01T00:00:00.000Z');
        const program = await makeListedProgram({ shopifyArchivedAt: stamp });

        const res = await archivePost(req({ archived: true }), params(program.id));
        expect(res.status).toBe(200);

        const persisted = await prisma.program.findUnique({ where: { id: program.id } });
        expect(persisted?.shopifyArchivedAt?.toISOString()).toBe(stamp.toISOString()); // unchanged
    });

    it('refuses to archive a program with no Shopify listing (400)', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
        const free = await prisma.program.create({
            data: { name: `Free Prog ${TAG} ${Math.round(performance.now() * 1000)}`, phase: 'RUNNING' },
        });

        const res = await archivePost(req({ archived: true }), params(free.id));
        expect(res.status).toBe(400);
    });

    it('rejects a non-boolean archived (400) and a missing program (404)', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const program = await makeListedProgram();

        expect((await archivePost(req({ archived: 'yes' }), params(program.id))).status).toBe(400);
        expect((await archivePost(req({ archived: true }), params(999_999_999))).status).toBe(404);
    });

    describe('archive blocks checkout-affecting routes; un-archive restores', () => {
        it('sync-shopify: 400 while archived, repairs once un-archived', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            // Checkout-broken (priced, no variant) AND archived.
            const program = await prisma.program.create({
                data: {
                    name: `Broken Archived Prog ${TAG} ${Math.round(performance.now() * 1000)}`,
                    phase: 'RUNNING',
                    orgMemberPriceCents: 5000,
                    nonOrgMemberPriceCents: 7500,
                    shopifyArchivedAt: new Date(),
                },
            });

            const blocked = await syncPost(req(), params(program.id));
            expect(blocked.status).toBe(400); // "un-archive first"
            expect((await prisma.program.findUnique({ where: { id: program.id } }))?.shopifyVariantId).toBeNull();

            // Un-archive, then sync repairs onto the single-pool model.
            expect((await archivePost(req({ archived: false }), params(program.id))).status).toBe(200);
            const repaired = await syncPost(req(), params(program.id));
            expect(repaired.status).toBe(200);
            expect((await prisma.program.findUnique({ where: { id: program.id } }))?.shopifyVariantId).toMatch(/^dev-mock-variant-/);
        });

        it('discount-code: returns { code: null } while archived (no mint)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });
            const program = await makeListedProgram({ shopifyArchivedAt: new Date() });

            const res = await discountPost(req(), params(program.id));
            expect(res.status).toBe(200);
            expect((await res.json()).code).toBeNull();
        });

        it('PATCH capacity push: no inventory warning while archived (contrast: live warns)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            // Archived: capped -> uncapped normally warns (null transition), but the
            // whole capacity-push block is skipped while archived → no warning.
            const archived = await makeListedProgram({ shopifyArchivedAt: new Date() });
            const archivedRes = await PATCH(req({ maxParticipants: null }), params(archived.id));
            expect(archivedRes.status).toBe(200);
            expect((await archivedRes.json()).warning).toBeUndefined();

            // Live control: same capped -> uncapped edit DOES surface the null-transition warning.
            const live = await makeListedProgram();
            const liveRes = await PATCH(req({ maxParticipants: null }), params(live.id));
            expect(liveRes.status).toBe(200);
            expect((await liveRes.json()).warning).toBeTruthy();
        });
    });
});
