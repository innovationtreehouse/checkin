/**
 * @jest-environment node
 */
/**
 * Unit tests for the household-denial gate in the site middleware.
 * getToken is mocked so we drive the gate purely off token.denied.
 */

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));

// next/jest shims next/server and its NextResponse statics aren't callable under jest.
// Replace them with a minimal functional stub so we can assert which branch the
// middleware takes (redirect target vs. pass-through) without the real edge runtime.
jest.mock('next/server', () => ({
    NextResponse: {
        redirect: (url: URL) => ({ kind: 'redirect', location: url.toString() }),
        next: () => ({ kind: 'next', location: null }),
    },
}));

// Imported after the mocks so the middleware binds to the stubbed NextResponse.
import { middleware } from '@/middleware';

const mockToken = (token: unknown) => (getToken as jest.Mock).mockResolvedValue(token);

// The middleware only touches nextUrl.pathname, nextUrl.search, and url.
const reqFor = (pathname: string): NextRequest => ({
    nextUrl: { pathname, search: '' },
    url: `http://localhost:4000${pathname}`,
} as unknown as NextRequest);

describe('middleware household-denial gate', () => {
    it('redirects a denied session to /access-denied', async () => {
        mockToken({ denied: true });

        const res = await middleware(reqFor('/membership-ops/households')) as unknown as { kind: string; location: string };

        expect(res.kind).toBe('redirect');
        expect(res.location).toBe('http://localhost:4000/access-denied');
    });

    it('does not loop — a denied session already on /access-denied is let through', async () => {
        mockToken({ denied: true });

        const res = await middleware(reqFor('/access-denied')) as unknown as { kind: string };

        expect(res.kind).toBe('next');
    });

    it('does not send a non-denied session to /access-denied', async () => {
        mockToken({ denied: false, hd: 'example.org', emailVerified: true });

        const res = await middleware(reqFor('/membership-ops/households')) as unknown as { location: string | null };

        expect(res.location).not.toBe('http://localhost:4000/access-denied');
    });
});
