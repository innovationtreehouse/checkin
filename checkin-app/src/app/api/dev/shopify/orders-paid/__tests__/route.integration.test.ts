/**
 * @jest-environment node
 */
/**
 * Integration tests for POST /api/dev/shopify/orders-paid — the dev-only mock
 * that synthesizes an orders/paid payload and self-fires it at the REAL inbound
 * webhook (see docs/designs/SHOPIFY_DEV_STORE_WEBHOOK.md §6). Covers the gate
 * fuses (mock-active, session, validation) plus an end-to-end happy path that
 * proves the mock actually drives activate() via the real webhook handler —
 * not just a mocked 200.
 *
 * The route calls `fetch(config.baseUrl() + '/api/webhooks/shopify')`. There is
 * no live HTTP server bound to that URL in the test process, so `global.fetch`
 * is replaced here with an implementation that routes the exact request the
 * route built (same headers, same raw body) straight into the real inbound
 * `POST` handler — same DB, same HMAC verify, same activate() call prod runs.
 */
import { POST } from '@/app/api/dev/shopify/orders-paid/route';
import { POST as WEBHOOK_POST } from '@/app/api/webhooks/shopify/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

const TAG = 'dev-shopify-route-test';

function asSession(id = 1) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: false } });
}
function anonymous() {
    (getServerSession as jest.Mock).mockResolvedValue(null);
}
function jsonReq(body?: unknown) {
    return new Request('http://localhost:4000/api/dev/shopify/orders-paid', {
        method: 'POST',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}

describe('POST /api/dev/shopify/orders-paid (dev mock)', () => {
    let originalFetch: typeof global.fetch;
    let prevSettings: {
        orgMembershipVariantId: string | null;
        shopifyNormalVariantId: string | null;
        shopifyVolunteerVariantId: string | null;
    } | null;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.orgMembershipProcess.deleteMany({ where: { orgMembership: { householdId: { in: ids } } } });
            await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
    }

    /** A fresh household + membership + PENDING_PAYMENT process, matching what the dev UI lists. */
    async function makeProc() {
        const hh = await prisma.household.create({ data: { name: `Dev Mock HH ${TAG}` } });
        const m = await prisma.orgMembership.create({ data: { householdId: hh.id, status: 'NONE', isVolunteer: false } });
        // No bgClearedAt: activate() deterministically lands PENDING_BG_CLEARANCE
        // (not ACTIVE) when it advances — see payment.ts `activating = !!process.bgClearedAt`.
        const p = await prisma.orgMembershipProcess.create({
            data: { orgMembershipId: m.id, kind: 'INITIAL', status: 'PENDING_PAYMENT' },
        });
        return { householdId: hh.id, orgMembershipId: m.id, processId: p.id };
    }

    async function setVariant(variantId: string | null) {
        await prisma.boardSettings.upsert({
            where: { id: 1 },
            create: { id: 1, orgMembershipVariantId: variantId },
            update: { orgMembershipVariantId: variantId, shopifyNormalVariantId: null, shopifyVolunteerVariantId: null },
        });
    }

    beforeAll(async () => {
        const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prevSettings = existing
            ? {
                  orgMembershipVariantId: existing.orgMembershipVariantId,
                  shopifyNormalVariantId: existing.shopifyNormalVariantId,
                  shopifyVolunteerVariantId: existing.shopifyVolunteerVariantId,
              }
            : null;
        await wipe();

        originalFetch = global.fetch;
        global.fetch = jest.fn(async (input, init) => {
            const req = new Request(String(input), init as RequestInit);
            return WEBHOOK_POST(req as never) as unknown as Response;
        }) as unknown as typeof fetch;
    });

    afterAll(async () => {
        await wipe();
        if (prevSettings) await prisma.boardSettings.update({ where: { id: 1 }, data: prevSettings });
        global.fetch = originalFetch;
        await prisma.$disconnect();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('404s when the mock is inactive (real Shopify creds configured)', async () => {
        asSession();
        process.env.SHOPIFY_STORE_DOMAIN = 'test.myshopify.com';
        process.env.SHOPIFY_CLIENT_ID = 'test-client-id';
        process.env.SHOPIFY_CLIENT_SECRET = 'test-client-secret';
        try {
            const res = await POST(jsonReq({ processId: 1 }));
            expect(res.status).toBe(404);
        } finally {
            delete process.env.SHOPIFY_STORE_DOMAIN;
            delete process.env.SHOPIFY_CLIENT_ID;
            delete process.env.SHOPIFY_CLIENT_SECRET;
        }
    });

    it('401s when there is no session', async () => {
        anonymous();
        const res = await POST(jsonReq({ processId: 1 }));
        expect(res.status).toBe(401);
    });

    it('400s when processId is missing or not an integer', async () => {
        asSession();
        expect((await POST(jsonReq({}))).status).toBe(400);
        expect((await POST(jsonReq({ processId: 'not-a-number' }))).status).toBe(400);
        expect((await POST(jsonReq({ processId: 1.5 }))).status).toBe(400);
    });

    it('404s when the process does not exist', async () => {
        asSession();
        const res = await POST(jsonReq({ processId: 999999999 }));
        expect(res.status).toBe(404);
    });

    it('404s when the process exists but is not PENDING_PAYMENT', async () => {
        asSession();
        const { processId } = await makeProc();
        await prisma.orgMembershipProcess.update({ where: { id: processId }, data: { status: 'PENDING_BG_REVIEW' } });
        const res = await POST(jsonReq({ processId }));
        expect(res.status).toBe(404);
    });

    it('409s when no membership variant is configured on BoardSettings', async () => {
        asSession();
        await setVariant(null);
        const { processId } = await makeProc();
        const res = await POST(jsonReq({ processId }));
        expect(res.status).toBe(409);
    });

    it('200s, fires the real inbound webhook, and advances the process (PENDING_PAYMENT -> PENDING_BG_CLEARANCE)', async () => {
        asSession();
        await setVariant('dev-mock-variant-route-test');
        const { processId } = await makeProc();

        const res = await POST(jsonReq({ processId }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ ok: true, status: 'PENDING_BG_CLEARANCE' });

        // The real proof: the webhook actually ran end-to-end and mutated the DB,
        // not just that the route returned 200.
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe('PENDING_BG_CLEARANCE');
        expect(proc?.paidAt).not.toBeNull();
    });
});
