/**
 * @jest-environment node
 */
/**
 * Unit tests for the household-denial gate in the site middleware.
 * getToken is mocked so we drive the gate purely off token.denied.
 */

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { ORG_DOMAIN } from '@/lib/config';

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
import { middleware, config as middlewareConfig } from '@/middleware';

const mockToken = (token: unknown) => (getToken as jest.Mock).mockResolvedValue(token);

// The middleware only touches nextUrl.pathname, nextUrl.search, and url.
const reqFor = (pathname: string, search = ''): NextRequest => ({
    nextUrl: { pathname, search },
    url: `http://localhost:4000${pathname}${search}`,
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

/**
 * Dev-instance org-login gate (CHECKIN_ENV=dev). This is the "not world-readable" fence
 * for the public cloud dev instance: every page requires a verified org member, else /signin.
 * Untested before — a regression here silently exposes every page to anonymous visitors.
 */
describe('middleware dev-instance org gate', () => {
    const ORIGINAL_ENV = process.env.CHECKIN_ENV;
    beforeEach(() => { process.env.CHECKIN_ENV = 'dev'; });
    afterEach(() => { process.env.CHECKIN_ENV = ORIGINAL_ENV; });

    type Res = { kind: string; location: string | null };

    it('lets a verified org member through', async () => {
        mockToken({ hd: ORG_DOMAIN, emailVerified: true });

        const res = await middleware(reqFor('/membership-ops/households')) as unknown as Res;

        expect(res.kind).toBe('next');
        expect(res.location).toBeNull();
    });

    it('redirects a non-org email to /signin', async () => {
        mockToken({ hd: 'gmail.com', emailVerified: true });

        const res = await middleware(reqFor('/membership-ops/households')) as unknown as Res;

        expect(res.kind).toBe('redirect');
        expect(res.location).toBe('http://localhost:4000/signin?callbackUrl=%2Fmembership-ops%2Fhouseholds');
    });

    it('redirects an unverified org email to /signin', async () => {
        mockToken({ hd: ORG_DOMAIN, emailVerified: false });

        const res = await middleware(reqFor('/membership-ops/households')) as unknown as Res;

        expect(res.kind).toBe('redirect');
        expect(res.location).toBe('http://localhost:4000/signin?callbackUrl=%2Fmembership-ops%2Fhouseholds');
    });

    it('redirects an anonymous visitor to /signin, preserving callbackUrl with query', async () => {
        mockToken(null);

        const res = await middleware(reqFor('/events', '?tab=roster')) as unknown as Res;

        expect(res.kind).toBe('redirect');
        expect(res.location).toBe('http://localhost:4000/signin?callbackUrl=%2Fevents%3Ftab%3Droster');
    });
});

/**
 * In prod (and unset, which fails safe to prod) the gate is inert — the org check must NOT
 * apply, or public surfaces break. This guards against the gate leaking out of dev.
 */
describe('middleware org gate is inert outside dev', () => {
    const ORIGINAL_ENV = process.env.CHECKIN_ENV;
    beforeEach(() => { process.env.CHECKIN_ENV = 'prod'; });
    afterEach(() => { process.env.CHECKIN_ENV = ORIGINAL_ENV; });

    it('lets a non-org anonymous visitor through in prod', async () => {
        mockToken(null);

        const res = await middleware(reqFor('/membership-ops/households')) as unknown as { kind: string };

        expect(res.kind).toBe('next');
    });
});

/**
 * The matcher — not the function body — is what exempts /api from the gate. Next applies it
 * before invoking middleware(), so assert the regex itself: API/signin/static excluded,
 * real page routes included.
 */
describe('middleware matcher', () => {
    const matches = (path: string) =>
        (middlewareConfig.matcher as string[]).some((p) => new RegExp(`^${p}$`).test(path));

    it('exempts /api routes (they self-enforce auth; never redirect JSON to /signin)', () => {
        expect(matches('/api/scan')).toBe(false);
        expect(matches('/api/auth/callback/google')).toBe(false);
    });

    it('exempts signin and framework/static paths', () => {
        expect(matches('/signin')).toBe(false);
        expect(matches('/_next/static/chunk.js')).toBe(false);
        expect(matches('/favicon.ico')).toBe(false);
        expect(matches('/brand/logo.webp')).toBe(false);
    });

    it('gates real page routes', () => {
        expect(matches('/membership-ops/households')).toBe(true);
        expect(matches('/events')).toBe(true);
    });
});
