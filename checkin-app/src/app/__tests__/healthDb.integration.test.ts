/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/health/db — the DbWakeNotice wake probe.
 * Session-gated (an anonymous SELECT-1 endpoint would let crawlers wake the
 * auto-pausing Aurora cluster), returns only the ok/waking boolean.
 */
import { GET } from '@/app/api/health/db/route';
import prisma from '@/lib/prisma';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;

const TAG = 'health-db-test';

describe('GET /api/health/db', () => {
    let personId: number;
    let householdId: number;

    beforeAll(async () => {
        const person = await prisma.person.create({
            data: { name: 'Health Probe', email: `probe-${TAG}@example.com`, household: { create: { name: 'Test HH' } } },
        });
        personId = person.id;
        householdId = person.householdId;
    });

    afterAll(async () => {
        await prisma.person.deleteMany({ where: { id: personId } });
        await prisma.household.deleteMany({ where: { id: householdId } });
    });

    const req = () => new Request('http://localhost/api/health/db') as unknown as import('next/server').NextRequest;

    it('401 without a session (no anonymous wake-amplification)', async () => {
        mockSession.mockResolvedValue(null);
        const res = await GET(req());
        expect(res.status).toBe(401);
    });

    it('200 { ok: true } for an authenticated user when the DB answers', async () => {
        mockSession.mockResolvedValue({ user: { id: personId } });
        const res = await GET(req());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(res.headers.get('cache-control')).toBe('no-store');
    });
});
