import crypto from "crypto";
import { config } from "./config";

/**
 * Verify an Ed25519 signature from the kiosk client.
 *
 * The kiosk signs: `${timestamp}:${method}:${path}:${body}`
 * Headers: X-Kiosk-Timestamp, X-Kiosk-Signature (hex-encoded)
 *
 * Rejects if:
 *  - Missing headers
 *  - Timestamp older than MAX_AGE_SECONDS
 *  - Invalid signature against ALL configured public keys
 *
 * Supports multiple comma-separated public keys in KIOSK_PUBLIC_KEY env var.
 * Each key should be a hex-encoded 32-byte Ed25519 public key.
 */

const MAX_AGE_SECONDS = 60;

/**
 * Parse KIOSK_PUBLIC_KEY env var into an array of Buffers.
 * Supports comma-separated keys for multiple kiosks / key rotation.
 * Returns empty array if not configured.
 */
export function getKioskPublicKeys(): Buffer[] {
    const raw = config.kioskPublicKey();
    if (!raw) return [];
    return raw
        .split(",")
        .map(k => k.trim())
        .filter(k => k.length > 0)
        .map(k => Buffer.from(k, "hex"));
}

export type VerifyResult =
    | { ok: true }
    | { ok: false; status: number; error: string };

export function verifyKioskSignature(
    method: string,
    path: string,
    body: string,
    timestampHeader: string | null,
    signatureHeader: string | null,
    publicKeys: Buffer | Buffer[]
): VerifyResult {
    if (!timestampHeader || !signatureHeader) {
        return { ok: false, status: 401, error: "Missing kiosk signature headers" };
    }

    // Normalize to array
    const keys = Array.isArray(publicKeys) ? publicKeys : [publicKeys];

    // Check timestamp freshness
    const ts = parseInt(timestampHeader, 10);
    if (isNaN(ts)) {
        return { ok: false, status: 401, error: "Invalid timestamp" };
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > MAX_AGE_SECONDS) {
        return { ok: false, status: 401, error: "Timestamp too old or too far in the future" };
    }

    // Reconstruct signed message
    const message = Buffer.from(`${timestampHeader}:${method}:${path}:${body}`);

    // Decode signature from hex
    let sigBytes: Buffer;
    try {
        sigBytes = Buffer.from(signatureHeader, "hex");
    } catch {
        return { ok: false, status: 401, error: "Malformed signature" };
    }

    // Try each public key — succeed if ANY matches
    for (const publicKey of keys) {
        try {
            const ok = crypto.verify(
                null, // Ed25519 doesn't use a separate hash algorithm
                message,
                {
                    key: crypto.createPublicKey({
                        key: Buffer.concat([
                            // Ed25519 DER prefix for a 32-byte public key
                            Buffer.from("302a300506032b6570032100", "hex"),
                            publicKey,
                        ]),
                        format: "der",
                        type: "spki",
                    }),
                },
                sigBytes
            );
            if (ok) return { ok: true };
        } catch (e) {
            // Key failed — try next one
            console.error("Signature verification error with key:", e);
        }
    }

    return { ok: false, status: 401, error: "Invalid signature" };
}
