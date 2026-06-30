/**
 * @jest-environment node
 */
/**
 * Integration tests for POST /api/webhooks/shopify covering the NEGATIVE and
 * IDEMPOTENCY paths that the happy-path lifecycle test never exercised:
 *   - bad / missing HMAC signature, unconfigured secret, malformed JSON
 *   - participant-not-found (acknowledged, no mutation)
 *   - replaying the same valid payload twice (Shopify retries at-least-once)
 *   - the membership-process activation branch
 *   - comma-separated multi-participant activation
 */
import crypto from 'crypto';
import { POST } from '@/app/api/webhooks/shopify/route';
import prisma from '@/lib/prisma';
import { activateByProcessId } from '@/lib/membership/payment';

jest.mock('@/lib/membership/payment', () => ({
    activateByProcessId: jest.fn().mockResolvedValue(undefined),
}));

// Keep the REAL logIntegrationError (it writes to the DB — the 500-catch test
// below asserts that write) but silence the console logger.
jest.mock('@/lib/logger', () => ({
    ...jest.requireActual('@/lib/logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const SECRET = 'shopify-test-secret';
const TAG = 'shopify-webhook-test';

function sign(body: string, secret = SECRET): string {
    return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

function webhookReq(body: string, signature: string | null) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (signature !== null) headers['x-shopify-hmac-sha256'] = signature;
    return new Request('http://localhost/api/webhooks/shopify', {
        method: 'POST',
        headers,
        body,
    });
}

describe('POST /api/webhooks/shopify — negatives & idempotency', () => {
    let programId: number;
    let p1: number;
    let p2: number;
    let h1: number;
    let h2: number;

    beforeAll(async () => {
        const program = await prisma.program.create({
            data: { name: `Webhook Test Program ${TAG}`, enrollmentStatus: 'OPEN' },
        });
        programId = program.id;

        const a = await prisma.participant.create({
            data: { name: 'Hook P1', email: `p1-${TAG}@example.com`, household: { create: {} } },
        });
        p1 = a.id;
        h1 = a.householdId;
        const b = await prisma.participant.create({
            data: { name: 'Hook P2', email: `p2-${TAG}@example.com`, household: { create: {} } },
        });
        p2 = b.id;
        h2 = b.householdId;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.SHOPIFY_WEBHOOK_SECRET = SECRET;
    });

    afterAll(async () => {
        await prisma.integrationErrorLog.deleteMany({ where: { source: 'shopify-webhook' } });
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.program.delete({ where: { id: programId } });
        await prisma.participant.deleteMany({ where: { id: { in: [p1, p2] } } });
        await prisma.household.deleteMany({ where: { id: { in: [h1, h2] } } });
    });

    async function setPending(participantId: number) {
        await prisma.programParticipant.upsert({
            where: { programId_participantId: { programId, participantId } },
            update: { status: 'PENDING', pendingSince: new Date() },
            create: { programId, participantId, status: 'PENDING', pendingSince: new Date() },
        });
    }

    function programPayload(accountIds: string) {
        return JSON.stringify({
            id: 555,
            note_attributes: [
                { name: 'CheckMeIn_Account_ID', value: accountIds },
                { name: 'Program_ID', value: String(programId) },
            ],
        });
    }

    it('returns 500 when the webhook secret is not configured', async () => {
        delete process.env.SHOPIFY_WEBHOOK_SECRET;
        const body = programPayload(String(p1));
        const res = await POST(webhookReq(body, sign(body)));
        expect(res.status).toBe(500);
    });

    it('returns 401 when the signature header is missing', async () => {
        const body = programPayload(String(p1));
        const res = await POST(webhookReq(body, null));
        expect(res.status).toBe(401);
    });

    it('returns 401 on a signature mismatch', async () => {
        const body = programPayload(String(p1));
        const res = await POST(webhookReq(body, sign(body, 'wrong-secret')));
        expect(res.status).toBe(401);
    });

    it('returns 400 on a malformed JSON body with a valid signature', async () => {
        const body = 'not-json';
        const res = await POST(webhookReq(body, sign(body)));
        expect(res.status).toBe(400);
    });

    it('acknowledges (200) but makes no change when the participant is not enrolled', async () => {
        // p1 has no programParticipant row for this program yet.
        await prisma.programParticipant.deleteMany({ where: { programId, participantId: p1 } });
        const body = programPayload(String(p1));
        const res = await POST(webhookReq(body, sign(body)));
        expect(res.status).toBe(200);

        const row = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId, participantId: p1 } },
        });
        expect(row).toBeNull();
    });

    it('activates a PENDING participant and is idempotent across a replayed delivery', async () => {
        await setPending(p1);
        const body = programPayload(String(p1));

        const first = await POST(webhookReq(body, sign(body)));
        expect(first.status).toBe(200);
        let row = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId, participantId: p1 } },
        });
        expect(row?.status).toBe('ACTIVE');
        expect(row?.pendingSince).toBeNull();

        // Shopify retries at-least-once: replay the identical signed payload.
        const second = await POST(webhookReq(body, sign(body)));
        expect(second.status).toBe(200);
        row = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId, participantId: p1 } },
        });
        // Still ACTIVE, still cleared — replay must not error or regress state.
        expect(row?.status).toBe('ACTIVE');
        expect(row?.pendingSince).toBeNull();
    });

    it('activates every id in a comma-separated CheckMeIn_Account_ID list', async () => {
        await setPending(p1);
        await setPending(p2);
        const body = programPayload(`${p1}, ${p2}`);

        const res = await POST(webhookReq(body, sign(body)));
        expect(res.status).toBe(200);

        const rows = await prisma.programParticipant.findMany({
            where: { programId, participantId: { in: [p1, p2] } },
        });
        expect(rows).toHaveLength(2);
        expect(rows.every(r => r.status === 'ACTIVE')).toBe(true);
    });

    it('routes a Membership_Process_ID payload to activateByProcessId and returns 200', async () => {
        const body = JSON.stringify({
            id: 98765,
            note_attributes: [{ name: 'Membership_Process_ID', value: '42' }],
        });
        const res = await POST(webhookReq(body, sign(body)));
        expect(res.status).toBe(200);
        expect(activateByProcessId).toHaveBeenCalledWith(42, '98765');
    });

    it('returns 500 and writes one IntegrationErrorLog row when a handler throws', async () => {
        // Clean slate so the survivor count is exact.
        await prisma.integrationErrorLog.deleteMany({ where: { source: 'shopify-webhook' } });
        (activateByProcessId as jest.Mock).mockRejectedValueOnce(new Error('handler boom'));

        const body = JSON.stringify({
            id: 13579,
            note_attributes: [{ name: 'Membership_Process_ID', value: '99' }],
        });
        const res = await POST(webhookReq(body, sign(body)));
        expect(res.status).toBe(500);

        const rows = await prisma.integrationErrorLog.findMany({ where: { source: 'shopify-webhook' } });
        expect(rows).toHaveLength(1);
        expect(rows[0].message).toBe('handler boom');
        expect(rows[0].context).toEqual({ operation: 'POST /api/webhooks/shopify' });
    });
});
