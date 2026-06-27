/**
 * Unit tests for verifyKioskSignature — the Ed25519 auth boundary between the
 * kiosk client and the server. Previously ONLY the key parser was tested; the
 * actual crypto verify, timestamp-freshness, tamper, and key-rotation paths
 * were mocked away everywhere. These exercise the real primitive end to end.
 *
 * The signing here mirrors client.py / badge.py exactly:
 *   message = `${timestamp}:${method}:${path}:${body}`  (Ed25519, hex signature)
 */
import crypto from 'crypto';
import { verifyKioskSignature } from '../verify-kiosk';

/** Generate an Ed25519 keypair and return the raw 32-byte public key + a signer. */
function makeKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    // SPKI DER for Ed25519 is a 12-byte prefix + the 32-byte raw key.
    const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const sign = (ts: string, method: string, path: string, body: string) =>
        crypto.sign(null, Buffer.from(`${ts}:${method}:${path}:${body}`), privateKey).toString('hex');
    return { rawPublic, sign };
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe('verifyKioskSignature', () => {
    it('accepts a correctly signed, fresh request', () => {
        const { rawPublic, sign } = makeKeypair();
        const ts = String(nowSec());
        const sig = sign(ts, 'POST', '/api/scan', '{"participantId":5}');
        const res = verifyKioskSignature('POST', '/api/scan', '{"participantId":5}', ts, sig, rawPublic);
        expect(res.ok).toBe(true);
    });

    it('rejects when the timestamp header is missing', () => {
        const { rawPublic } = makeKeypair();
        const res = verifyKioskSignature('POST', '/api/scan', '', null, 'deadbeef', rawPublic);
        expect(res).toMatchObject({ ok: false, status: 401, error: 'Missing kiosk signature headers' });
    });

    it('rejects when the signature header is missing', () => {
        const { rawPublic } = makeKeypair();
        const res = verifyKioskSignature('POST', '/api/scan', '', String(nowSec()), null, rawPublic);
        expect(res).toMatchObject({ ok: false, status: 401, error: 'Missing kiosk signature headers' });
    });

    it('rejects a non-numeric timestamp', () => {
        const { rawPublic, sign } = makeKeypair();
        const sig = sign('abc', 'POST', '/api/scan', '');
        const res = verifyKioskSignature('POST', '/api/scan', '', 'abc', sig, rawPublic);
        expect(res).toMatchObject({ ok: false, status: 401, error: 'Invalid timestamp' });
    });

    it('rejects a stale timestamp (replay older than the 60s window)', () => {
        const { rawPublic, sign } = makeKeypair();
        const ts = String(nowSec() - 61);
        const sig = sign(ts, 'POST', '/api/scan', '');
        const res = verifyKioskSignature('POST', '/api/scan', '', ts, sig, rawPublic);
        expect(res).toMatchObject({ ok: false, status: 401 });
        expect((res as { error: string }).error).toMatch(/Timestamp/);
    });

    it('rejects a timestamp too far in the future', () => {
        const { rawPublic, sign } = makeKeypair();
        const ts = String(nowSec() + 61);
        const sig = sign(ts, 'POST', '/api/scan', '');
        const res = verifyKioskSignature('POST', '/api/scan', '', ts, sig, rawPublic);
        expect(res.ok).toBe(false);
    });

    it('accepts at the freshness boundary (exactly 60s old)', () => {
        const { rawPublic, sign } = makeKeypair();
        const ts = String(nowSec() - 60);
        const sig = sign(ts, 'POST', '/api/scan', '');
        const res = verifyKioskSignature('POST', '/api/scan', '', ts, sig, rawPublic);
        expect(res.ok).toBe(true);
    });

    it('rejects when the body was tampered after signing', () => {
        const { rawPublic, sign } = makeKeypair();
        const ts = String(nowSec());
        const sig = sign(ts, 'POST', '/api/scan', '{"participantId":5}');
        // Verify against a different body → signature no longer matches.
        const res = verifyKioskSignature('POST', '/api/scan', '{"participantId":6}', ts, sig, rawPublic);
        expect(res).toMatchObject({ ok: false, status: 401, error: 'Invalid signature' });
    });

    it('rejects a signature made by a different key', () => {
        const signer = makeKeypair();
        const attacker = makeKeypair();
        const ts = String(nowSec());
        const sig = attacker.sign(ts, 'POST', '/api/scan', '');
        const res = verifyKioskSignature('POST', '/api/scan', '', ts, sig, signer.rawPublic);
        expect(res).toMatchObject({ ok: false, status: 401, error: 'Invalid signature' });
    });

    it('rejects garbage in the signature field', () => {
        const { rawPublic } = makeKeypair();
        const ts = String(nowSec());
        const res = verifyKioskSignature('POST', '/api/scan', '', ts, 'nothex!!', rawPublic);
        expect(res.ok).toBe(false);
    });

    it('supports key rotation: accepts if ANY configured key matches', () => {
        const oldKey = makeKeypair();
        const newKey = makeKeypair();
        const ts = String(nowSec());
        const sig = newKey.sign(ts, 'POST', '/api/scan', '');
        // Server still lists the old key first, then the new one.
        const res = verifyKioskSignature('POST', '/api/scan', '', ts, sig, [oldKey.rawPublic, newKey.rawPublic]);
        expect(res.ok).toBe(true);
    });

    it('rejects when none of the configured keys match', () => {
        const a = makeKeypair();
        const b = makeKeypair();
        const signer = makeKeypair();
        const ts = String(nowSec());
        const sig = signer.sign(ts, 'POST', '/api/scan', '');
        const res = verifyKioskSignature('POST', '/api/scan', '', ts, sig, [a.rawPublic, b.rawPublic]);
        expect(res.ok).toBe(false);
    });
});
