/**
 * @jest-environment node
 */
import { POST } from '../route';
import { authenticateRequest } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { processCheckin, processCheckout } from '@/lib/scan-service';

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
            findUnique: jest.fn(),
        },
        visit: {
            findFirst: jest.fn(),
            aggregate: jest.fn(),
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
        expect(processCheckin).toHaveBeenCalledWith(survivor, 'session', expect.anything(), expect.any(Date));
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

    // §2 D2/D3/D4 (docs/designs/KIOSK_RESILIENCE.md) — replayed-scan idempotency.
    // `replay: true` marks a redelivery; D4's try-first rule puts clientEventId
    // on the live attempt too, so the id alone never implies a replay.
    describe('replayed scans (clientEventId/scannedAt)', () => {
        function replayReq(overrides: Record<string, unknown> = {}) {
            return new Request('http://localhost/api/scan', {
                method: 'POST',
                body: JSON.stringify({ participantId: 1, clientEventId: 'evt-1', scannedAt: new Date().toISOString(), replay: true, ...overrides })
            }) as unknown as import('next/server').NextRequest;
        }

        beforeEach(() => {
            (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'kiosk' });
            (prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 1, mergedIntoId: null });
            (prisma.rawBadgeLog.findFirst as jest.Mock).mockResolvedValue(null);
        });

        it('acks a redelivered clientEventId as duplicate_ignored without re-toggling', async () => {
            (prisma.rawBadgeLog.findUnique as jest.Mock).mockResolvedValue({ id: 5, clientEventId: 'evt-1' });

            const res = await POST(replayReq());
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.type).toBe('duplicate_ignored');
            expect(prisma.rawBadgeLog.create).not.toHaveBeenCalled();
            expect(processCheckin).not.toHaveBeenCalled();
        });

        it('dedups on clientEventId regardless of the replay flag (try-first contract)', async () => {
            (prisma.rawBadgeLog.findUnique as jest.Mock).mockResolvedValue({ id: 5, clientEventId: 'evt-1' });

            const res = await POST(replayReq({ replay: undefined }));
            expect((await res.json()).type).toBe('duplicate_ignored');
            expect(prisma.rawBadgeLog.create).not.toHaveBeenCalled();
        });

        it('rejects a non-boolean replay flag rather than guessing its truthiness', async () => {
            const res = await POST(replayReq({ replay: 'true' }));
            expect(res.status).toBe(400);
            expect((await res.json()).error).toContain('replay');
        });

        it('rejects replay:true without a clientEventId — it could neither dedup nor park', async () => {
            const res = await POST(replayReq({ clientEventId: undefined }));
            expect(res.status).toBe(400);
            expect(prisma.rawBadgeLog.create).not.toHaveBeenCalled();
        });

        // Without a usable scannedAt a replay would silently inherit server-now:
        // the freshness check passes trivially and the out-of-order guard
        // compares against now, so a stale replay toggles instead of parking.
        it('rejects replay:true without a scannedAt', async () => {
            const res = await POST(replayReq({ scannedAt: undefined }));
            expect(res.status).toBe(400);
            expect((await res.json()).error).toContain('scannedAt');
            expect(prisma.rawBadgeLog.create).not.toHaveBeenCalled();
        });

        it('rejects replay:true with an unparseable scannedAt', async () => {
            const res = await POST(replayReq({ scannedAt: 'not-a-date' }));
            expect(res.status).toBe(400);
            expect((await res.json()).error).toContain('scannedAt');
            expect(prisma.rawBadgeLog.create).not.toHaveBeenCalled();
        });

        it('toggles a fresh replay using scannedAt as the visit time', async () => {
            (prisma.rawBadgeLog.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.visit.aggregate as jest.Mock).mockResolvedValue({ _max: { arrivedAt: null, departedAt: null } });
            (processCheckin as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ type: 'checkin' }), { status: 200 }));

            const scannedAt = new Date(Date.now() - 60_000).toISOString();
            const res = await POST(replayReq({ scannedAt }));
            expect(res.status).toBe(200);

            expect(prisma.rawBadgeLog.create).toHaveBeenCalledWith({
                data: { personId: 1, location: 'Main Entrance', clientEventId: 'evt-1', timestamp: new Date(scannedAt) },
            });
            expect(processCheckin).toHaveBeenCalledWith({ id: 1, mergedIntoId: null }, 'kiosk', expect.anything(), new Date(scannedAt));
        });

        it('parks a replay older than the freshness window instead of toggling', async () => {
            (prisma.rawBadgeLog.findUnique as jest.Mock).mockResolvedValue(null);

            const scannedAt = new Date(Date.now() - 20 * 60_000).toISOString(); // 20 min ago > 10 min W
            const res = await POST(replayReq({ scannedAt }));
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.type).toBe('parked');

            expect(prisma.rawBadgeLog.create).toHaveBeenCalledWith({
                data: { personId: 1, location: 'Main Entrance', clientEventId: 'evt-1', timestamp: new Date(scannedAt), reviewReason: 'stale_replay' },
            });
            expect(prisma.visit.findFirst).not.toHaveBeenCalled();
            expect(processCheckin).not.toHaveBeenCalled();
            expect(processCheckout).not.toHaveBeenCalled();
        });

        it('parks a fresh replay whose scannedAt is older than newer visit activity (out-of-order guard)', async () => {
            (prisma.rawBadgeLog.findUnique as jest.Mock).mockResolvedValue(null);
            const scannedAt = new Date(Date.now() - 5 * 60_000); // within W
            (prisma.visit.aggregate as jest.Mock).mockResolvedValue({
                _max: {
                    arrivedAt: new Date(Date.now() - 2 * 60_000),
                    departedAt: new Date(Date.now() - 60_000), // newer than scannedAt
                },
            });

            const res = await POST(replayReq({ scannedAt: scannedAt.toISOString() }));
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.type).toBe('parked');
            expect(prisma.rawBadgeLog.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ reviewReason: 'out_of_order' }) })
            );
            expect(processCheckin).not.toHaveBeenCalled();
            expect(processCheckout).not.toHaveBeenCalled();
        });

        it('a same-body legacy scan (no clientEventId) is unaffected — no dedup pre-read, no park branch', async () => {
            (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
            (processCheckin as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ type: 'checkin' }), { status: 200 }));

            const res = await POST(replayReq({ clientEventId: undefined, scannedAt: undefined, replay: undefined }));
            expect(res.status).toBe(200);

            expect(prisma.rawBadgeLog.findUnique).not.toHaveBeenCalled();
            expect(prisma.rawBadgeLog.create).toHaveBeenCalledWith({ data: { personId: 1, location: 'Main Entrance' } });
        });

        it('an empty-string clientEventId normalizes to null and is treated as a live scan, not a replay', async () => {
            (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
            (processCheckin as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ type: 'checkin' }), { status: 200 }));

            const res = await POST(replayReq({ clientEventId: '', replay: undefined }));
            expect(res.status).toBe(200);

            expect(prisma.rawBadgeLog.findUnique).not.toHaveBeenCalled();
            expect(prisma.rawBadgeLog.create).toHaveBeenCalledWith({ data: { personId: 1, location: 'Main Entrance' } });
        });
    });

    // The live kiosk scan carries clientEventId (D4 try-first) but no replay
    // flag: it must dedup, and otherwise behave exactly like a legacy live scan.
    describe('live scans carrying a clientEventId (no replay flag)', () => {
        function liveReq(overrides: Record<string, unknown> = {}) {
            return new Request('http://localhost/api/scan', {
                method: 'POST',
                body: JSON.stringify({ participantId: 1, clientEventId: 'evt-live', scannedAt: new Date().toISOString(), ...overrides })
            }) as unknown as import('next/server').NextRequest;
        }

        beforeEach(() => {
            (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'kiosk' });
            (prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 1, mergedIntoId: null });
            (prisma.rawBadgeLog.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.rawBadgeLog.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
            (processCheckin as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ type: 'checkin' }), { status: 200 }));
        });

        it('records the dedup key but stamps server-now, never the kiosk scannedAt', async () => {
            const res = await POST(liveReq({ scannedAt: new Date(Date.now() - 60_000).toISOString() }));
            expect(res.status).toBe(200);

            // No `timestamp` override -> the column default (now).
            expect(prisma.rawBadgeLog.create).toHaveBeenCalledWith({
                data: { personId: 1, location: 'Main Entrance', clientEventId: 'evt-live' },
            });
        });

        it('is never parked by the freshness window, however old its scannedAt', async () => {
            const res = await POST(liveReq({ scannedAt: new Date(Date.now() - 20 * 60_000).toISOString() }));
            expect((await res.json()).type).toBe('checkin');
            expect(prisma.visit.aggregate).not.toHaveBeenCalled();
            expect(processCheckin).toHaveBeenCalled();
        });

        it('is never parked by the out-of-order guard, and checks out as live (no replay id)', async () => {
            (prisma.visit.findFirst as jest.Mock).mockResolvedValue({ id: 7 });
            (prisma.visit.aggregate as jest.Mock).mockResolvedValue({
                _max: { arrivedAt: new Date(), departedAt: new Date() },
            });
            (processCheckout as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ type: 'checkout' }), { status: 200 }));

            const res = await POST(liveReq());
            expect((await res.json()).type).toBe('checkout');
            // Last arg null => processCheckout takes the live warn/confirm path.
            expect(processCheckout).toHaveBeenCalledWith({ id: 1, mergedIntoId: null }, 7, 'kiosk', expect.anything(), expect.any(Date), null);
        });

        it('still dedups a clientEventId already recorded server-side', async () => {
            (prisma.rawBadgeLog.findUnique as jest.Mock).mockResolvedValue({ id: 5, clientEventId: 'evt-live' });

            const res = await POST(liveReq());
            expect((await res.json()).type).toBe('duplicate_ignored');
            expect(prisma.rawBadgeLog.create).not.toHaveBeenCalled();
        });
    });
});
