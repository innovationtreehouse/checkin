/**
 * @jest-environment node
 */
/**
 * Unit tests for POST /api/membership/renew — auth gating and the
 * RenewalError → HTTP status mapping (404 not_found / 409 wrong_phase),
 * which had no coverage. The renewal business logic is mocked; this pins the
 * route's auth + error translation contract.
 */
import { POST } from '../route';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

jest.mock('@/lib/membership/renewal', () => {
    class RenewalError extends Error {
        constructor(public readonly code: 'not_found' | 'wrong_phase', message: string) {
            super(message);
            this.name = 'RenewalError';
        }
    }
    return { beginRenewalForUser: jest.fn(), RenewalError };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const renewal = require('@/lib/membership/renewal');

function renewReq() {
    return new Request('http://localhost/api/membership/renew', { method: 'POST' }) as unknown as import('next/server').NextRequest;
}

describe('POST /api/membership/renew', () => {
    beforeEach(() => jest.clearAllMocks());

    it('401 when unauthenticated', async () => {
        mockSession.mockResolvedValue(null);
        const res = await POST(renewReq());
        expect(res.status).toBe(401);
        expect(renewal.beginRenewalForUser).not.toHaveBeenCalled();
    });

    it('200 and returns the process on success', async () => {
        mockSession.mockResolvedValue({ user: { id: 7 } });
        renewal.beginRenewalForUser.mockResolvedValue({ id: 99, status: 'PENDING_PAYMENT' });
        const res = await POST(renewReq());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.process.id).toBe(99);
        expect(renewal.beginRenewalForUser).toHaveBeenCalledWith(7);
    });

    it('404 when there is no membership to renew (RenewalError not_found)', async () => {
        mockSession.mockResolvedValue({ user: { id: 7 } });
        renewal.beginRenewalForUser.mockRejectedValue(new renewal.RenewalError('not_found', 'No membership'));
        const res = await POST(renewReq());
        expect(res.status).toBe(404);
        expect((await res.json()).code).toBe('not_found');
    });

    it('409 when the membership is in the wrong phase (RenewalError wrong_phase)', async () => {
        mockSession.mockResolvedValue({ user: { id: 7 } });
        renewal.beginRenewalForUser.mockRejectedValue(new renewal.RenewalError('wrong_phase', 'Not renewable yet'));
        const res = await POST(renewReq());
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('wrong_phase');
    });

    it('500 on an unexpected error', async () => {
        mockSession.mockResolvedValue({ user: { id: 7 } });
        renewal.beginRenewalForUser.mockRejectedValue(new Error('db down'));
        const res = await POST(renewReq());
        expect(res.status).toBe(500);
    });
});
