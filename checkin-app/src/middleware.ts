import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { config as appConfig, isStagingAccessAllowed, ORG_DOMAIN } from '@/lib/config';

/**
 * Site-wide org-login gate for the cloud dev instance (see DEV_INSTANCE_DESIGN.md §4)
 * — and the ops-stg ACCESS GATE (see docs on the staging access gate).
 *
 * When CHECKIN_ENV=dev, every page route requires a session whose Google hosted-domain (`hd`)
 * claim is the org domain and whose email is verified. Anonymous visitors and bots are bounced
 * to Google login and can read nothing else — delivering both "reachable by org members" and
 * "not world-readable".
 *
 * In `prod` and `local` the gate is inert (public surfaces stay public; local work needs no Google).
 *
 * On ops-stg (isStaging()) the predicate is the same verified-org-member check, OR'd with
 * canAccessStaging (the sysadmin-settable escape hatch) — but a failing caller is bounced to
 * the bare /access-denied page, not /signin: ops-stg runs a scrubbed copy of PRODUCTION data
 * behind PROD's Google OAuth client, deliberately unrestricted to the org workspace, so ANY
 * Google account can complete sign-in. This is only ONE of three surfaces the gate covers —
 * see isStagingAccessAllowed's callers in lib/auth.ts (authenticateRequest, the API chokepoint)
 * and security/access-resolvers.ts (resolveAccess, the `authorize: 'public'` path this
 * middleware's matcher can never reach because /api is exempt below).
 */
export async function middleware(req: NextRequest) {
    // The bare "Access Denied" page must stay reachable in every env, or a denied
    // user would loop on the redirect below (and an anonymous hit just sees the words).
    if (req.nextUrl.pathname.startsWith('/access-denied')) {
        return NextResponse.next();
    }

    // Household-denial login gate — runs in ALL envs (prod included), unlike the dev org
    // gate further down. A board "Deny Membership" stamps token.denied via the jwt callback;
    // bounce every page navigation to the bare /access-denied screen. APIs self-enforce
    // (authenticateRequest treats denied sessions as unauthenticated), so they're exempt
    // via the matcher and don't need handling here.
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (token?.denied) {
        return NextResponse.redirect(new URL('/access-denied', req.url));
    }

    if (appConfig.isStaging()) {
        // ACCEPTED WINDOW (not a bug, documented 2026-07-20): getToken() decodes the
        // session cookie directly and does NOT run the jwt callback, so a revoked
        // hd/emailVerified/canAccessStaging claim can keep admitting page navigation
        // for up to the 8h session maxAge — identical to how the dev-instance org
        // gate below has always behaved. The API surfaces do NOT have this window:
        // authenticateRequest goes through getServerSession, which DOES re-run the
        // jwt callback every request (auth-options.ts re-syncs from the DB), so an
        // explicit canAccessStaging revocation takes effect immediately there.
        if (isStagingAccessAllowed(token)) {
            return NextResponse.next();
        }
        return NextResponse.redirect(new URL('/access-denied', req.url));
    }

    if (appConfig.checkinEnv() !== 'dev') {
        return NextResponse.next();
    }

    const isVerifiedOrgMember = token?.hd === ORG_DOMAIN && token?.emailVerified === true;
    if (isVerifiedOrgMember) {
        return NextResponse.next();
    }

    const signInUrl = new URL('/signin', req.url);
    signInUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
}

export const config = {
    // Gate page navigation only. Exempt:
    //  - api/*       — routes self-enforce auth (withAuth / kiosk signature). Skipping them also
    //                  lets a keyed kiosk reach /api/scan on dev, keeps NextAuth's own sign-in +
    //                  Google callback reachable, and avoids redirecting JSON clients to HTML.
    //  - signin      — the custom sign-in screen itself, or anonymous visitors would loop forever.
    //  - _next/*, favicon — framework internals.
    //  - any path with a file extension (`.*\..*`) — public static assets under /public (the brand
    //    logo/mark, svgs, the import template). They must stay reachable on the dev instance, and
    //    next/image optimizes via an origin fetch of its source — so a gated /brand/*.webp source
    //    makes /_next/image return 400 (the broken dev-instance logo).
    matcher: ['/((?!api|signin|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
