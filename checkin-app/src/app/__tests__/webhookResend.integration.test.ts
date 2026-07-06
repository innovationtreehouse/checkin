/**
 * @jest-environment node
 */
/**
 * Integration tests for POST /api/webhooks/resend:
 *   - unconfigured secret (500), missing/bad Svix signature (401)
 *   - email.bounced / email.complained flag the matching Person
 *   - email.delivered clears a previously-flagged Person (self-healing)
 *   - a bounce for an address with no matching Person no-ops cleanly (200)
 *   - email.delivery_delayed logs only — never sets the flag
 *   - rate limiting precedes signature verification (mirrors webhookShopify's ordering test)
 */
import { Webhook } from 'svix';
import { POST } from '@/app/api/webhooks/resend/route';
import prisma from '@/lib/prisma';

// Keep the REAL logIntegrationError (withWebhook's top-level catch writes to the
// DB on a handler throw) but silence the console logger.
jest.mock('@/lib/logger', () => ({
    ...jest.requireActual('@/lib/logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const SECRET = 'whsec_' + Buffer.from('resend-webhook-test-secret').toString('base64');
const TAG = 'resend-webhook-test';

function sign(id: string, timestamp: Date, body: string): string {
    return new Webhook(SECRET).sign(id, timestamp, body);
}

function webhookReq(
    body: string,
    opts: { id?: string; timestamp?: Date; signature?: string | null; omitHeaders?: boolean; ip?: string } = {},
) {
    const id = opts.id ?? 'msg_test';
    const timestamp = opts.timestamp ?? new Date();
    const signature = opts.signature === undefined ? sign(id, timestamp, body) : opts.signature;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!opts.omitHeaders) {
        headers['svix-id'] = id;
        headers['svix-timestamp'] = String(Math.floor(timestamp.getTime() / 1000));
        if (signature !== null) headers['svix-signature'] = signature;
    }
    if (opts.ip) headers['x-forwarded-for'] = opts.ip;
    return new Request('http://localhost/api/webhooks/resend', { method: 'POST', headers, body });
}

function resendEvent(type: string, to: string) {
    return JSON.stringify({ type, data: { to: [to], subject: 'Test Subject', email_id: 'evt_test' } });
}

describe('POST /api/webhooks/resend', () => {
    let personId: number;
    let householdId: number;
    const email = `bounce-${TAG}@example.com`;
    let prevSecret: string | undefined;

    beforeAll(async () => {
        prevSecret = process.env.RESEND_WEBHOOK_SECRET;
        const p = await prisma.person.create({
            data: { name: `Resend Webhook Test ${TAG}`, email, household: { create: { name: 'Test HH' } } },
        });
        personId = p.id;
        householdId = p.householdId;
    });

    beforeEach(() => {
        process.env.RESEND_WEBHOOK_SECRET = SECRET;
    });

    afterAll(async () => {
        if (prevSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
        else process.env.RESEND_WEBHOOK_SECRET = prevSecret;
        await prisma.integrationErrorLog.deleteMany({ where: { source: 'resend-webhook' } });
        await prisma.person.deleteMany({ where: { id: personId } });
        await prisma.household.deleteMany({ where: { id: householdId } });
    });

    it('returns 500 when RESEND_WEBHOOK_SECRET is not configured', async () => {
        delete process.env.RESEND_WEBHOOK_SECRET;
        const res = await POST(webhookReq(resendEvent('email.bounced', email)));
        expect(res.status).toBe(500);
    });

    it('returns 401 when the Svix headers are missing', async () => {
        const res = await POST(webhookReq(resendEvent('email.bounced', email), { omitHeaders: true }));
        expect(res.status).toBe(401);
    });

    it('returns 401 on a signature mismatch', async () => {
        const res = await POST(webhookReq(resendEvent('email.bounced', email), { signature: 'v1,not-the-right-signature' }));
        expect(res.status).toBe(401);
    });

    it('flags the matching Person on email.bounced', async () => {
        const res = await POST(webhookReq(resendEvent('email.bounced', email)));
        expect(res.status).toBe(200);

        const person = await prisma.person.findUnique({ where: { id: personId } });
        expect(person?.emailUndeliverableAt).not.toBeNull();
    });

    it('flags the matching Person on email.complained', async () => {
        await prisma.person.update({ where: { id: personId }, data: { emailUndeliverableAt: null } });
        const res = await POST(webhookReq(resendEvent('email.complained', email)));
        expect(res.status).toBe(200);

        const person = await prisma.person.findUnique({ where: { id: personId } });
        expect(person?.emailUndeliverableAt).not.toBeNull();
    });

    it('clears the flag on a later email.delivered for the same address (self-healing)', async () => {
        await prisma.person.update({ where: { id: personId }, data: { emailUndeliverableAt: new Date() } });
        const res = await POST(webhookReq(resendEvent('email.delivered', email)));
        expect(res.status).toBe(200);

        const person = await prisma.person.findUnique({ where: { id: personId } });
        expect(person?.emailUndeliverableAt).toBeNull();
    });

    it('acknowledges (200) but does not throw when a bounce has no matching Person', async () => {
        const res = await POST(webhookReq(resendEvent('email.bounced', `nobody-${TAG}@example.com`)));
        expect(res.status).toBe(200);
    });

    it('logs only on email.delivery_delayed — never sets the flag', async () => {
        await prisma.person.update({ where: { id: personId }, data: { emailUndeliverableAt: null } });
        const res = await POST(webhookReq(resendEvent('email.delivery_delayed', email)));
        expect(res.status).toBe(200);

        const person = await prisma.person.findUnique({ where: { id: personId } });
        expect(person?.emailUndeliverableAt).toBeNull();
    });

    it('acknowledges (200) an unrecognized event type without acting', async () => {
        const res = await POST(webhookReq(resendEvent('email.opened', email)));
        expect(res.status).toBe(200);
    });

    it('rate-limits a flood (429 + Retry-After) AHEAD of the Svix check — bad sig still 401, not 429', async () => {
        // route.ts: rateLimit(..., { limit: 60, windowMs: 60_000 }) runs BEFORE
        // signature verification (via withWebhook). Dedicated IP so this doesn't
        // share a bucket with the tests above.
        const ip = '198.51.100.22';
        const body = resendEvent('email.bounced', email);
        for (let i = 0; i < 60; i++) {
            const res = await POST(webhookReq(body, { signature: 'v1,wrong', ip }));
            expect(res.status).toBe(401);
        }
        const limited = await POST(webhookReq(body, { signature: 'v1,wrong', ip }));
        expect(limited.status).toBe(429);
        expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    });
});
