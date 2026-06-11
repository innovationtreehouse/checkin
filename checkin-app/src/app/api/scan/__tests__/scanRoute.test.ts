/**
 * @jest-environment node
 */
import { POST } from '../route';
import { authenticateRequest } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({
    authenticateRequest: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
    participant: {
        findUnique: jest.fn(),
    },
    rawBadgeEvent: {
        create: jest.fn(),
        findFirst: jest.fn(),
    },
    visit: {
        findFirst: jest.fn(),
    },
    systemMetric: {
        create: jest.fn().mockResolvedValue({}),
    },
}));

jest.mock('@/lib/logger', () => ({
    logBackendError: jest.fn(),
}));

jest.mock('@/lib/scan-service', () => ({
    processCheckin: jest.fn(),
    processCheckout: jest.fn(),
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

        const prisma = require('@/lib/prisma');
        prisma.participant.findUnique.mockResolvedValue({ id: 1 });
        prisma.rawBadgeEvent.findFirst.mockResolvedValue({ time: new Date(Date.now() - 1000) });

        const res = await POST(req);
        expect(res.status).toBe(200);

        const json = await res.json();
        expect(json.type).toBe('ignored_debounce');
        expect(json.message).toBe('Scan ignored due to debounce.');
    });
});
