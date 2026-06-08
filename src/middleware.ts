import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { config as appConfig, ORG_DOMAIN } from '@/lib/config';

/**
 * Site-wide org-login gate for the cloud dev instance (see DEV_INSTANCE_DESIGN.md §4).
 *
 * When CHECKIN_ENV=dev, every page route requires a session whose Google hosted-domain (`hd`)
 * claim is the org domain and whose email is verified. Anonymous visitors and bots are bounced
 * to Google login and can read nothing else — delivering both "reachable by org members" and
 * "not world-readable".
 *
 * In `prod` and `local` the gate is inert (public surfaces stay public; local work needs no Google).
 */
export async function middleware(req: NextRequest) {
    if (appConfig.checkinEnv() !== 'dev') {
        return NextResponse.next();
    }

    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const isVerifiedOrgMember = token?.hd === ORG_DOMAIN && token?.emailVerified === true;
    if (isVerifiedOrgMember) {
        return NextResponse.next();
    }

    const signInUrl = new URL('/api/auth/signin', req.url);
    signInUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
}

export const config = {
    // Gate page navigation only. Exempt:
    //  - api/*       — routes self-enforce auth (withAuth / kiosk signature). Skipping them also
    //                  lets a keyed kiosk reach /api/scan on dev, keeps NextAuth's own sign-in +
    //                  Google callback reachable, and avoids redirecting JSON clients to HTML.
    //  - _next/*, favicon — framework internals + static assets.
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
