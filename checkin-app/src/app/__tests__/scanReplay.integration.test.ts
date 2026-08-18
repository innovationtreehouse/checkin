/**
 * @jest-environment node
 */
/**
 * Kiosk replay idempotency against the real DB (docs/designs/KIOSK_RESILIENCE.md
 * §2): a queued scan carries clientEventId + scannedAt, and replay must dedup,
 * toggle with the original scan time, and park instead of toggling when stale
 * or out-of-order.
 */
import { POST } from '@/app/api/scan/route';
import prisma from '@/lib/prisma';
import { authenticateRequest } from '@/lib/auth';
import type { Person } from '@/generated/prisma/client';

jest.mock('@/lib/auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/notifications', () => ({
    sendCheckinNotifications: jest.fn().mockResolvedValue(undefined),
    sendNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/logger', () => ({
    logBackendError: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const TAG = 'scan-replay-test';

function scanReq(body: Record<string, unknown>) {
    return new Request('http://localhost/api/scan', {
        method: 'POST',
        body: JSON.stringify(body),
    }) as unknown as import('next/server').NextRequest;
}

describe('Scan replay — clientEventId dedup and freshness window (real DB)', () => {
    let keyholder: Person;
    let member: Person;
    const householdIds: number[] = [];

    beforeAll(async () => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'kiosk' });
        keyholder = await prisma.person.create({
            data: { name: 'Replay Key', email: `key-${TAG}@example.com`, isKeyholder: true, household: { create: { name: 'Test HH' } } },
        });
        householdIds.push(keyholder.householdId);
        member = await prisma.person.create({
            data: { name: 'Replay Member', email: `member-${TAG}@example.com`, household: { create: { name: 'Test HH' } } },
        });
        householdIds.push(member.householdId);

        // Keep the facility open for the whole suite: member check-ins require an
        // active keyholder, and this is testing replay, not facility-open gating.
        await prisma.visit.create({ data: { personId: keyholder.id, arrivedAt: new Date(0), arrivedVia: 'SCANNER' } });
    });

    afterEach(async () => {
        await prisma.visit.deleteMany({ where: { personId: member.id } });
        await prisma.rawBadgeLog.deleteMany({ where: { personId: member.id } });
    });

    afterAll(async () => {
        await prisma.visit.deleteMany({ where: { personId: { in: [keyholder.id, member.id] } } });
        await prisma.rawBadgeLog.deleteMany({ where: { personId: { in: [keyholder.id, member.id] } } });
        await prisma.person.deleteMany({ where: { id: { in: [keyholder.id, member.id] } } });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    });

    it('redelivering the same clientEventId dedups instead of toggling a second time', async () => {
        const scannedAt = new Date().toISOString();
        const first = await POST(scanReq({ participantId: member.id, clientEventId: 'evt-dedup', scannedAt }));
        expect((await first.json()).type).toBe('checkin');

        const retry = await POST(scanReq({ participantId: member.id, clientEventId: 'evt-dedup', scannedAt }));
        expect(retry.status).toBe(200);
        expect((await retry.json()).type).toBe('duplicate_ignored');

        const visits = await prisma.visit.findMany({ where: { personId: member.id } });
        expect(visits).toHaveLength(1);
    });

    it('a fresh replay toggles using scannedAt as the recorded arrival time', async () => {
        const scannedAt = new Date(Date.now() - 60_000); // 1 min ago, within W
        const res = await POST(scanReq({ participantId: member.id, clientEventId: 'evt-fresh', scannedAt: scannedAt.toISOString() }));
        expect((await res.json()).type).toBe('checkin');

        const visit = await prisma.visit.findFirst({ where: { personId: member.id } });
        expect(visit?.arrivedAt.getTime()).toBe(scannedAt.getTime());
    });

    it('a replay older than the freshness window parks instead of toggling', async () => {
        const scannedAt = new Date(Date.now() - 20 * 60_000); // 20 min ago > 10 min W
        const res = await POST(scanReq({ participantId: member.id, clientEventId: 'evt-stale', scannedAt: scannedAt.toISOString() }));
        expect(res.status).toBe(200);
        expect((await res.json()).type).toBe('parked');

        expect(await prisma.visit.findFirst({ where: { personId: member.id } })).toBeNull();
        const log = await prisma.rawBadgeLog.findUnique({ where: { clientEventId: 'evt-stale' } });
        expect(log?.reviewReason).toBe('stale_replay');
    });

    it('a fresh replay whose scannedAt is older than a later departure parks (out-of-order guard)', async () => {
        // Live check-in and check-out first, well past the 3s debounce.
        await POST(scanReq({ participantId: member.id }));
        await prisma.rawBadgeLog.updateMany({ where: { personId: member.id }, data: { timestamp: new Date(Date.now() - 5000) } });
        await POST(scanReq({ participantId: member.id }));

        // A queued check-in from BEFORE that departure arrives late — state has
        // moved past it.
        const scannedAt = new Date(Date.now() - 4000);
        const res = await POST(scanReq({ participantId: member.id, clientEventId: 'evt-out-of-order', scannedAt: scannedAt.toISOString() }));
        expect(res.status).toBe(200);
        expect((await res.json()).type).toBe('parked');

        const log = await prisma.rawBadgeLog.findUnique({ where: { clientEventId: 'evt-out-of-order' } });
        expect(log?.reviewReason).toBe('out_of_order');
    });
});
