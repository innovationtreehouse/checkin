/**
 * @jest-environment node
 */
import { POST } from '../route';
import { authenticateRequest } from '@/lib/auth';
import prisma from '@/lib/prisma';

jest.mock('@/lib/auth', () => ({
    authenticateRequest: jest.fn(),
}));

jest.mock('@/lib/prisma', () => {
    const mock = {
        person: {
            findUnique: jest.fn(),
        },
        // Archived-household guard (assertHouseholdActive); null == active by default.
        household: {
            findUnique: jest.fn().mockResolvedValue(null),
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
