/**
 * @jest-environment node
 */
/**
 * Negative-auth coverage for protected routes that previously had NO 401/403
 * test. Two shapes:
 *
 *  1. ROLE-GATED — reject both the unauthenticated caller (401) and a plain
 *     authenticated user with no privileged role (403). Table-driven; the auth
 *     gate fires before any body/param work, so dummy params/empty bodies reach
 *     it.
 *
 *  2. AUTH-ONLY (`withAuth({})`, no role list) — there is NO privilege boundary
 *     beyond authentication, so only 401 is a meaningful negative. We assert 401
 *     and explicitly document that a plain authenticated user is admitted by
 *     design (NOT 403).
 *
 * TEST-ONLY. A route here returning 2xx for the unauthenticated/plain caller is
 * a live authz hole.
 */
import { PATCH as ADMIN_HH_PATCH } from '@/app/api/membership-ops/households/[id]/route';
import { POST as MERGE_POST } from '@/app/api/membership-ops/participants/merge/route';
import { GET as MERGE_ANALYZE_GET } from '@/app/api/membership-ops/participants/merge/analyze/route';
import { POST as IMPORT_PREVIEW_POST } from '@/app/api/membership-ops/participants/import/preview/route';
import { GET as SYSTEM_HEALTH_GET } from '@/app/api/system-status/health/route';
import { GET as TRENDS_GET } from '@/app/api/facility/trends/route';
import { GET as ADMIN_TA_GET } from '@/app/api/safety/trusted-adults/route';
import { POST as TA_OVERRIDE_POST } from '@/app/api/safety/trusted-adults/override/route';
import { PATCH as SHOP_TOOL_PATCH } from '@/app/api/shop/tools/[id]/route';
import { GET as EVENT_GET, PATCH as EVENT_PATCH } from '@/app/api/events/[id]/route';
import { GET as NOTIFICATIONS_GET } from '@/app/api/notifications/route';
import { POST as CONTRACT_SYNC_POST } from '@/app/api/membership/contract/sync/route';
import { POST as ONBOARDING_POST } from '@/app/api/profile/onboarding/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'authz-rolereject-test';

function as(id: number, extra: Record<string, unknown> = {}) {
    (getServerSession as jest.Mock).mockResolvedValue({
        user: { id, sysadmin: false, boardMember: false, keyholder: false, backgroundCheckReviewer: false, ...extra },
    });
}
function anon() {
    (getServerSession as jest.Mock).mockResolvedValue(null);
}
// authenticateRequest reads req.headers/url/method; the hand-rolled routes read
// req.json()/params. A plain (polyfilled) Request covers all of these — none of
// these routes touch req.nextUrl. next/server is mocked, so NextRequest is N/A.
function nreq(url = 'http://localhost/api/x', method = 'GET', body?: unknown) {
    return new Request(url, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }) as never;
}
function idCtx(id: string | number) {
    return { params: Promise.resolve({ id: String(id) }) } as never;
}

/**
 * Each role-gated case: invoke(req) calls the handler with whatever ctx/body it
 * needs. We mock the session per call. A plain user (plainId, no role flags)
 * must get 403; no session must get 401.
 */
type Case = { name: string; invoke: () => Promise<Response> };

describe('Protected-route role rejection', () => {
    let plainId = 0, plainHh = 0;
    let eventId = 0, programId = 0;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        await prisma.event.deleteMany({ where: { program: { name: { contains: TAG } } } });
        await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
        if (ids.length) {
            await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
    }

    beforeAll(async () => {
        await wipe();
        plainHh = (await prisma.household.create({ data: { name: `Plain HH ${TAG}` } })).id;
        plainId = (await prisma.participant.create({ data: { name: `Plain ${TAG}`, householdId: plainHh } })).id;
        // A real event so events/[id] GET reaches its in-handler authorization
        // gate (a missing event short-circuits to 404 before the 403).
        const prog = await prisma.program.create({ data: { name: `Prog ${TAG}` } });
        programId = prog.id;
        eventId = (await prisma.event.create({
            data: { programId, name: `Evt ${TAG}`, start: new Date('2030-01-01T10:00:00Z'), end: new Date('2030-01-01T12:00:00Z') },
        })).id;
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    beforeEach(() => jest.clearAllMocks());

    // ---- ROLE-GATED: 401 unauthenticated + 403 plain user ---------------------
    const roleGated: Case[] = [
        { name: 'PATCH /api/membership-ops/households/[id]', invoke: () => ADMIN_HH_PATCH(nreq('http://localhost/api/membership-ops/households/1', 'PATCH', {}), idCtx(1)) },
        { name: 'POST /api/membership-ops/participants/merge', invoke: () => MERGE_POST(nreq('http://localhost/api/membership-ops/participants/merge', 'POST', {})) },
        { name: 'GET /api/membership-ops/participants/merge/analyze', invoke: () => MERGE_ANALYZE_GET(nreq('http://localhost/api/membership-ops/participants/merge/analyze')) },
        { name: 'POST /api/membership-ops/participants/import/preview', invoke: () => IMPORT_PREVIEW_POST(nreq('http://localhost/api/membership-ops/participants/import/preview', 'POST')) },
        { name: 'GET /api/system-status/health', invoke: () => SYSTEM_HEALTH_GET(nreq('http://localhost/api/system-status/health')) },
        { name: 'GET /api/facility/trends', invoke: () => TRENDS_GET(nreq('http://localhost/api/facility/trends')) },
        { name: 'GET /api/safety/trusted-adults', invoke: () => ADMIN_TA_GET(nreq('http://localhost/api/safety/trusted-adults')) },
        { name: 'POST /api/safety/trusted-adults/override', invoke: () => TA_OVERRIDE_POST(nreq('http://localhost/api/safety/trusted-adults/override', 'POST', {})) },
        { name: 'PATCH /api/shop/tools/[id]', invoke: () => SHOP_TOOL_PATCH(nreq('http://localhost/api/shop/tools/1', 'PATCH', {}), idCtx(1)) },
    ];

    describe.each(roleGated)('$name', ({ invoke }) => {
        it('401 when unauthenticated', async () => {
            anon();
            expect((await invoke()).status).toBe(401);
        });
        it('403 for a plain authenticated user (no privileged role)', async () => {
            as(plainId, { householdId: plainHh });
            expect((await invoke()).status).toBe(403);
        });
    });

    // ---- events/[id] — in-handler ownership gate (needs a real event) ---------
    describe('events/[id]', () => {
        it('GET 401 when unauthenticated', async () => {
            anon();
            expect((await EVENT_GET(nreq(`http://localhost/api/events/${eventId}`), idCtx(eventId))).status).toBe(401);
        });
        it('GET 403 for a plain user who is not event staff (roster PII gate)', async () => {
            as(plainId, { householdId: plainHh });
            expect((await EVENT_GET(nreq(`http://localhost/api/events/${eventId}`), idCtx(eventId))).status).toBe(403);
        });
        it('PATCH 401 when unauthenticated', async () => {
            anon();
            const res = await EVENT_PATCH(nreq(`http://localhost/api/events/${eventId}`, 'PATCH', { action: 'cancel' }), idCtx(eventId));
            expect(res.status).toBe(401);
        });
    });

    // ---- AUTH-ONLY (withAuth({})): only 401 is a real negative ----------------
    // These have no role/ownership boundary — a plain authenticated user is
    // admitted by design. We assert 401 for the anon caller and that the plain
    // user is NOT rejected with 403.
    const authOnly: { name: string; invoke: () => Promise<Response> }[] = [
        { name: 'GET /api/notifications', invoke: () => NOTIFICATIONS_GET(nreq('http://localhost/api/notifications')) },
        { name: 'POST /api/membership/contract/sync', invoke: () => CONTRACT_SYNC_POST(nreq('http://localhost/api/membership/contract/sync', 'POST')) },
        { name: 'POST /api/profile/onboarding', invoke: () => ONBOARDING_POST(nreq('http://localhost/api/profile/onboarding', 'POST', { completed: true })) },
    ];

    describe.each(authOnly)('$name (auth-only)', ({ invoke }) => {
        it('401 when unauthenticated', async () => {
            anon();
            expect((await invoke()).status).toBe(401);
        });
        it('plain authenticated user is admitted by design (not 401/403)', async () => {
            as(plainId, { householdId: plainHh });
            const status = (await invoke()).status;
            expect(status).not.toBe(401);
            expect(status).not.toBe(403);
        });
    });
});
