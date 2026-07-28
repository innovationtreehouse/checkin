import crypto from "crypto";
import { config } from "@/lib/config";

/**
 * Signed, session-less unsubscribe token: HMAC-SHA256 over the bare personId, keyed off
 * NEXTAUTH_SECRET. Mirrors the Shopify webhook HMAC (src/app/api/webhooks/shopify/route.ts)
 * and cronAuth's length-safe compare — NOT verify-kiosk.ts's Ed25519 scheme, which is
 * asymmetric and the wrong model for a server-generated-and-verified token.
 *
 * The URL carries both the id and the signature (`?p=<id>&sig=<hmac>`) rather than trusting
 * a bare id: verify() recomputes sign(id) and timing-safe compares it against the provided
 * sig, so a tampered id fails unless the attacker also forges its signature.
 */

function hmacKey(): Buffer {
    // Derive a distinct key from NEXTAUTH_SECRET rather than using it directly, so this
    // token family can't be replayed against/confused with any other NEXTAUTH_SECRET-keyed use.
    return crypto.createHash("sha256").update(`outreach-unsubscribe:${config.nextAuthSecret()}`).digest();
}

/** The signature for a given personId. */
export function sign(personId: number): string {
    return crypto.createHmac("sha256", hmacKey()).update(String(personId)).digest("base64url");
}

/** Timing-safe check that `token` is the signature for `personId`. */
export function verify(personId: number, token: string | null | undefined): boolean {
    if (!token) return false;
    const expected = sign(personId);
    // Hash both sides to a fixed length before comparing (same idiom as cronAuth.ts /
    // the Shopify webhook verify) so timingSafeEqual never throws on a mismatched-length
    // input and no length information leaks.
    const a = crypto.createHash("sha256").update(token).digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}
