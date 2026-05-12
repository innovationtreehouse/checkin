import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { getKioskPublicKeys, verifyKioskSignature } from './verify-kiosk';
import { config } from './config';
import type { SessionUser } from '@/types/participant';
import type { AuthResult } from '@/types/auth';

/**
 * Authenticate a request — tries kiosk signature first, then session.
 *
 * Pass `body` (raw text) for routes whose kiosk-signature covers the body.
 * The security handler does this automatically for `authorize: 'kiosk'` and
 * `authorize: { anyOf: [..., 'kiosk', ...] }` routes via ctx.rawBody.
 */
export async function authenticateRequest(
    req: NextRequest,
    body?: string,
): Promise<AuthResult> {
    // 1. Try kiosk signature
    const pubKeys = getKioskPublicKeys();
    const hasKioskHeaders = req.headers.get('x-kiosk-signature');

    if (pubKeys.length > 0 && hasKioskHeaders) {
        const method = req.method;
        const path = new URL(req.url).pathname;
        const result = verifyKioskSignature(
            method, path, body || '',
            req.headers.get('x-kiosk-timestamp'),
            req.headers.get('x-kiosk-signature'),
            pubKeys,
        );
        if (result.ok) return { type: 'kiosk' };
    } else if (pubKeys.length === 0 && config.isDev && process.env.NODE_ENV !== 'test') {
        // Dev mode: treat as kiosk if no key configured.
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
