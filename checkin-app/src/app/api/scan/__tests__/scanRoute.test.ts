/**
 * @jest-environment node
 */
import { POST } from '../route';
import { authenticateRequest } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { processCheckin } from '@/lib/scan-service';

jest.mock('@/lib/auth', () => ({
    authenticateRequest: jest.fn(),
}));

jest.mock('@/lib/prisma', () => {
    const mock = {
        person: {
            findUnique: jest.fn(),
        },
        rawBadgeLog: {
            create: jest.fn(),
            findFirst: jest.fn(),
        },
        visit: {
            findFirst: jest.fn(),
        },
        systemMetricLog: {
            create: jest.fn().mockResolvedValue({}),
        },
        // The route runs steps 4–6 inside a $transaction under a per-participant
        // advisory lock; the callback receives a tx client. For unit tests the
        // tx client is just this same mock, and the lock query is a no-op.
        $executeRaw: jest.fn().mockResolvedValue(1),
        $transaction: jest.fn(),
    };
    mock.$transaction.mockImplementation((cb: (tx: typeof mock) => unknown) => cb(mock));
    return mock;
});

jest.mock('@/lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    logBackendError: jest.fn(),
}));

jest.mock('@/lib/scan-service', () => ({
    processCheckin: jest.fn(),
    processCheckout: jest.fn(),
    finalizeFacilityClose: jest.fn().mockResolvedValue(undefined),
}));

describe('POST /api/scan', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 400 if the payload is not valid JSON', async () => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'session', user: { id: '1' } });
        const req = new Request('http://localhost/api/scan', {
            method: 'POST',
            body: 'not-json'
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(400);

        const json = await res.json();
        expect(json.error).toBe('Invalid JSON payload.');
    });

    it('should return 400 if participantId is missing', async () => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'session', user: { id: '1' } });
        const req = new Request('http://localhost/api/scan', {
            method: 'POST',
            body: JSON.stringify({ other: 'data' })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(400);

        const json = await res.json();
        expect(json.error).toBe('A valid numeric participantId is required.');
    });

    it('should return 400 if participantId is not a number', async () => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'session', user: { id: '1' } });
        const req = new Request('http://localhost/api/scan', {
            method: 'POST',
            body: JSON.stringify({ participantId: '123' })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(400);

        const json = await res.json();
        expect(json.error).toBe('A valid numeric participantId is required.');
    });
    it('forwards a merged-away badge to the surviving live record and scans as the survivor', async () => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'session', user: { id: '1' } });
        const req = new Request('http://localhost/api/scan', {
            method: 'POST',
            body: JSON.stringify({ participantId: 1 })
        }) as unknown as import('next/server').NextRequest;

        const survivor = { id: 99, mergedIntoId: null };
        (prisma.person.findUnique as jest.Mock).mockImplementation(({ where }: { where: { id: number } }) => {
            if (where.id === 1) return Promise.resolve({ id: 1, mergedIntoId: 99 });
            if (where.id === 99) return Promise.resolve(survivor);
            return Promise.resolve(null);
        });
        (prisma.rawBadgeLog.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
        (processCheckin as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ type: 'checkin' }), { status: 200 }));

        const res = await POST(req);
        expect(res.status).toBe(200);

        // Scanned, recorded, and checked in AS THE SURVIVOR (id 99), not the badge's own id (1).
        expect(processCheckin).toHaveBeenCalledWith(survivor, 'session', expect.anything());
        expect(prisma.rawBadgeLog.create).toHaveBeenCalledWith({ data: { personId: 99, location: 'Main Entrance' } });
        expect(logger.info).toHaveBeenCalledWith('Scan forwarded from merged record', {
            badgeId: 1, tombstoneId: 99, survivorId: 99, hops: 1,
        });
    });

    it('caps the merge chain walk at 5 hops and 409s with a reissue message rather than looping forever', async () => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'session', user: { id: '1' } });
        const req = new Request('http://localhost/api/scan', {
            method: 'POST',
            body: JSON.stringify({ participantId: 1 })
        }) as unknown as import('next/server').NextRequest;

        // A 6-hop chain (1->2->3->4->5->6->7 live) needs a 6th hop to resolve — over the cap.
        const chain: Record<number, { id: number; mergedIntoId: number | null }> = {
            1: { id: 1, mergedIntoId: 2 },
            2: { id: 2, mergedIntoId: 3 },
            3: { id: 3, mergedIntoId: 4 },
            4: { id: 4, mergedIntoId: 5 },
            5: { id: 5, mergedIntoId: 6 },
            6: { id: 6, mergedIntoId: 7 },
            7: { id: 7, mergedIntoId: null },
        };
        (prisma.person.findUnique as jest.Mock).mockImplementation(({ where }: { where: { id: number } }) =>
            Promise.resolve(chain[where.id] ?? null));

        const res = await POST(req);
        expect(res.status).toBe(409);

        const json = await res.json();
        expect(json.error).toContain('merged record');
        expect(json.error).toContain('7');
        expect(prisma.rawBadgeLog.create).not.toHaveBeenCalled();
        expect(prisma.visit.findFirst).not.toHaveBeenCalled();
        // Never fetches past the cap (id 7 itself is never looked up).
        expect(prisma.person.findUnique).not.toHaveBeenCalledWith({ where: { id: 7 } });
    });

    it('does not walk the chain at all for an already-live participant', async () => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'session', user: { id: '1' } });
        const req = new Request('http://localhost/api/scan', {
            method: 'POST',
            body: JSON.stringify({ participantId: 1 })
        }) as unknown as import('next/server').NextRequest;

        (prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 1, mergedIntoId: null });
        (prisma.rawBadgeLog.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
        (processCheckin as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ type: 'checkin' }), { status: 200 }));

        const res = await POST(req);
        expect(res.status).toBe(200);

        expect(prisma.person.findUnique).toHaveBeenCalledTimes(1);
        expect(logger.info).not.toHaveBeenCalled();
    });

    it('should silently ignore repeated scans within 3 seconds', async () => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'session', user: { id: '1' } });
        const req = new Request('http://localhost/api/scan', {
            method: 'POST',
            body: JSON.stringify({ participantId: 1 })
        }) as unknown as import('next/server').NextRequest;

        (prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
        (prisma.rawBadgeLog.findFirst as jest.Mock).mockResolvedValue({ timestamp: new Date(Date.now() - 1000) });

        const res = await POST(req);
        expect(res.status).toBe(200);

        const json = await res.json();
        expect(json.type).toBe('ignored_debounce');
        expect(json.message).toBe('Scan ignored due to debounce.');
    });
});
