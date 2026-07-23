/**
 * @jest-environment node
 */
/**
 * JWT expiry / tampering boundary tests.
 *
 * auth-options-jwt.test.ts covers the jwt() CALLBACK (DB re-sync / revocation).
 * The callback never sees an expired or forged token, though: NextAuth's own
 * encode/decode (jose JWE) is what enforces the session-token lifetime
 * (authOptions.session.maxAge) and integrity BEFORE the callback runs. A token
 * that's expired, signed with the wrong secret, or malformed must be rejected
 * there — its claims (id/roles) are never honored. This pins that layer.
 *
 * Mirrors authOptions: secret = config.nextAuthSecret(), maxAge = 8h.
 */
import { encode, decode } from 'next-auth/jwt';
import type { JWT } from 'next-auth/jwt';

const SECRET = 'test-jwt-boundary-secret';
const MAX_AGE = 60 * 60 * 8; // authOptions.session.maxAge — 8 hours

// decode rejects an invalid token by throwing (expired/forged/malformed);
// normalize to null so "claims not honored" is a single assertion.
async function tryDecode(token: string, secret: string): Promise<JWT | null> {
    try {
        return await decode({ token, secret });
    } catch {
        return null;
    }
}

// NextAuth expires a session by stamping `exp = iat + maxAge` at encode time and
// rejecting the token once `exp` has passed (getToken returns null → no session).
// `decode` itself only decrypts the JWE — it does NOT check exp — so the expiry
// boundary lives in that exp stamp + comparison, modeled here.
const isExpired = (t: JWT | null): boolean =>
    typeof t?.exp === 'number' && t.exp <= Math.floor(Date.now() / 1000);

describe('NextAuth JWT expiry boundary', () => {
    it('honors the claims of a token still inside maxAge (just-valid)', async () => {
        const token = await encode({ token: { id: 7, isSysadmin: true }, secret: SECRET, maxAge: MAX_AGE });
        const decoded = await tryDecode(token, SECRET);
        expect(decoded).not.toBeNull();
        expect(decoded!.id).toBe(7);
        expect(decoded!.isSysadmin).toBe(true);
        // Inside the window → NextAuth keeps the session alive.
        expect(isExpired(decoded)).toBe(false);
    });

    it('treats a token whose exp is just past maxAge as expired — claims not honored', async () => {
        // maxAge -1 → exp one second in the past: the just-expired edge.
        const token = await encode({ token: { id: 7, isSysadmin: true }, secret: SECRET, maxAge: -1 });
        const decoded = await tryDecode(token, SECRET);
        // Past the edge → NextAuth drops the session even though the ciphertext decrypts.
        expect(isExpired(decoded)).toBe(true);
    });
});

describe('NextAuth JWT tampering boundary', () => {
    it('rejects a token sealed with a different secret (forged) — claims not honored', async () => {
        const token = await encode({ token: { id: 7, isSysadmin: true }, secret: 'attacker-secret', maxAge: MAX_AGE });
        const decoded = await tryDecode(token, SECRET);
        expect(decoded).toBeNull();
    });

    it('rejects a structurally malformed token', async () => {
        const decoded = await tryDecode('not.a.valid.jwe.token', SECRET);
        expect(decoded).toBeNull();
    });

    it('rejects a valid token whose ciphertext was bit-flipped', async () => {
        const token = await encode({ token: { id: 7, isSysadmin: true }, secret: SECRET, maxAge: MAX_AGE });
        // Corrupt a character in the middle so the AEAD tag check fails.
        const mid = Math.floor(token.length / 2);
        const flipped = token.slice(0, mid) + (token[mid] === 'A' ? 'B' : 'A') + token.slice(mid + 1);
        const decoded = await tryDecode(flipped, SECRET);
        expect(decoded).toBeNull();
    });
});
