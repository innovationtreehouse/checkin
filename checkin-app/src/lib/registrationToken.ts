import crypto from "crypto";

// Confirmation token for the public-registration double-opt-in flow.
//
// The token carries the entire pending registration (parents, participants,
// emergency contact) so NO database row is written until the email is confirmed.
// It is AES-256-GCM encrypted, which gives us three things at once:
//   - confidentiality: child PII never appears in the emailed URL (mail-server
//     logs, browser history, Referer headers see only ciphertext);
//   - integrity: any tampering fails the auth tag, so the payload can't be
//     edited to enroll under a different program or skip validation;
//   - self-expiry: the `exp` field inside the encrypted body bounds the window.
//
// ponytail: stateless — no DB row, no GC cron. Trade-off: tokens aren't
// single-use, so a confirm link can be replayed. The confirm route is
// idempotent (the unique participant.email constraint + existing-email
// short-circuit make a replay a no-op), which covers it. If strict single-use
// is ever needed (e.g. revocation), add a consumed-token table then.

const ALGO = "aes-256-gcm";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h to click the confirmation link

function key(): Buffer {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error("NEXTAUTH_SECRET is required to encrypt registration tokens");
    // Derive a 32-byte key from the app secret (the secret itself is variable length).
    return crypto.createHash("sha256").update(secret).digest();
}

export function encodeRegistrationToken(payload: Record<string, unknown>, now = Date.now()): string {
    const body = JSON.stringify({ ...payload, exp: now + TTL_MS });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, key(), iv);
    const ct = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    // [12-byte iv][16-byte tag][ciphertext], URL-safe.
    return Buffer.concat([iv, tag, ct]).toString("base64url");
}

/**
 * Decrypt and validate a token. Returns the payload, or null if the token is
 * malformed, tampered, encrypted under a different key, or expired.
 */
export function decodeRegistrationToken<T = Record<string, unknown>>(token: string, now = Date.now()): T | null {
    try {
        const raw = Buffer.from(token, "base64url");
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const ct = raw.subarray(28);
        const decipher = crypto.createDecipheriv(ALGO, key(), iv);
        decipher.setAuthTag(tag);
        const body = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
        const obj = JSON.parse(body);
        if (typeof obj.exp !== "number" || obj.exp < now) return null;
        return obj as T;
    } catch {
        return null;
    }
}
