/**
 * @jest-environment node
 *
 * Direct unit test for the withAuth authorization gate (src/lib/auth.ts).
 * withAuth fronts the ~91 routes not in the security registry; its branches are
 * otherwise only hit incidentally through curated authz integration tests. Pin
 * them here by mocking the request authenticators (kiosk signature + session).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getServerSession } from 'next-auth/next';
import { getKioskPublicKeys, verifyKioskSignature } from '@/lib/verify-kiosk';
import type { SessionUser } from '@/types/participant';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/verify-kiosk', () => ({
    getKioskPublicKeys: jest.fn(),
    verifyKioskSignature: jest.fn(),
}));

const mockSession = getServerSession as jest.Mock;
const mockPubKeys = getKioskPublicKeys as jest.Mock;
const mockVerify = verifyKioskSignature as jest.Mock;

// A handler we can assert was / wasn't reached. Returns 200 so a pass is distinguishable.
// Typed args so mock.calls tuples expose the (req, auth) the gate forwards.
const handler = jest.fn(
    async (_req: unknown, _auth: unknown) =>
        NextResponse.json({ ok: true }, { status: 200 })
);

const sessionReq = () => new Request('http://localhost/api/whatever') as never;
const kioskReq = () =>
    new Request('http://localhost/api/whatever', {
        headers: { 'x-kiosk-signature': 'sig' },
    }) as never;

function user(overrides: Partial<SessionUser> = {}): SessionUser {
    return { id: 1, householdId: 10, ...overrides } as SessionUser;
}

beforeEach(() => {
    jest.clearAllMocks();
    // Default: no kiosk keys configured → kiosk signature path is inert.
    mockPubKeys.mockReturnValue([]);
    mockVerify.mockReturnValue({ ok: false });
    mockSession.mockResolvedValue(null);
});

describe('withAuth', () => {
    it('returns 401 and skips the handler for an unauthenticated request', async () => {
        const route = withAuth({}, handler);
        const res = await route(sessionReq());

        expect(res.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 401 for a denied household, treating it as unauthenticated', async () => {
        mockSession.mockResolvedValue({ user: user({ denied: true, sysadmin: true }) });
        // Even a route that would otherwise admit this user is locked out.
        const route = withAuth({ roles: ['sysadmin'] }, handler);
        const res = await route(sessionReq());

        expect(res.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 403 for a kiosk request on a route without allowKiosk', async () => {
        mockPubKeys.mockReturnValue(['key']);
        mockVerify.mockReturnValue({ ok: true });
        const route = withAuth({}, handler);
        const res = await route(kioskReq());

        expect(res.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 403 for a session lacking all required roles', async () => {
        mockSession.mockResolvedValue({ user: user({ sysadmin: false, boardMember: false }) });
        const route = withAuth({ roles: ['sysadmin', 'boardMember'] }, handler);
        const res = await route(sessionReq());

        expect(res.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('invokes the handler for a kiosk request on an allowKiosk route', async () => {
        mockPubKeys.mockReturnValue(['key']);
        mockVerify.mockReturnValue({ ok: true });
        const route = withAuth({ allowKiosk: true }, handler);
        const res = await route(kioskReq());

        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][1]).toEqual({ type: 'kiosk' });
    });

    it('invokes the handler for a session holding a required role', async () => {
        mockSession.mockResolvedValue({ user: user({ boardMember: true }) });
        const route = withAuth({ roles: ['sysadmin', 'boardMember'] }, handler);
        const res = await route(sessionReq());

        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
