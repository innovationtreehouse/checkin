import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { getKioskPublicKey, verifyKioskSignature } from './verify-kiosk';
import { config } from './config';
import type { SessionUser } from '@/types/participant';
import type { BusinessRole, AuthResult } from '@/types/auth';

/**
 * Authenticate a request — tries kiosk signature first, then session.
 */
export async function authenticateRequest(
    req: NextRequest,
    body?: string
): Promise<AuthResult> {
    // 1. Try kiosk signature
    const pubKey = getKioskPublicKey();
    const hasKioskHeaders = req.headers.get('x-kiosk-signature');

    if (pubKey && hasKioskHeaders) {
        const method = req.method;
        const path = new URL(req.url).pathname;
        const result = verifyKioskSignature(
            method, path, body || '',
            req.headers.get('x-kiosk-timestamp'),
            req.headers.get('x-kiosk-signature'),
            pubKey
        );
        if (result.ok) return { type: 'kiosk' };
    } else if (!pubKey && config.isDev) {
        // Dev mode: treat as kiosk if no key configured
        if (hasKioskHeaders || !req.headers.get('cookie')) {
            return { type: 'kiosk' };
        }
    }

    // 2. Try session
    const session = await getServerSession(authOptions);
    if (session?.user) {
        return { type: 'session', user: session.user as SessionUser };
    }

    return { type: 'unauthenticated' };
}

/**
 * Higher-order function for route handlers with auth.
 * `roles` uses the actual Prisma business role field names — no abstract groupings.
 *
 * Example usage:
 *   export const GET = withAuth(
 *       { roles: ['sysadmin', 'boardMember'] },
 *       async (req, auth) => { ... }
 *   );
 */
export function withAuth(
    options: {
        roles?: BusinessRole[];
        allowKiosk?: boolean;
    },
    handler: (req: NextRequest, auth: AuthResult) => Promise<NextResponse>
) {
    return async (req: NextRequest) => {
        const auth = await authenticateRequest(req);

        if (auth.type === 'unauthenticated') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (auth.type === 'kiosk' && !options.allowKiosk) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (options.roles && auth.type === 'session') {
            const user = auth.user;
            const hasRole = options.roles.some(role => user[role] === true);
            if (!hasRole) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        return handler(req, auth);
    };
}
