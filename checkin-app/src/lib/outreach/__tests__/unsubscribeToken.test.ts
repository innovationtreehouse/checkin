import { sign, verify } from '@/lib/outreach/unsubscribeToken';

// NEXTAUTH_SECRET is required by config.nextAuthSecret(); tests set it directly rather
// than relying on .env so this suite is self-contained.
describe('outreach unsubscribe token (HMAC sign/verify)', () => {
    const prevSecret = process.env.NEXTAUTH_SECRET;

    beforeAll(() => { process.env.NEXTAUTH_SECRET = 'unit-test-nextauth-secret'; });
    afterAll(() => {
        if (prevSecret === undefined) delete process.env.NEXTAUTH_SECRET;
        else process.env.NEXTAUTH_SECRET = prevSecret;
    });

    it('verifies a signature it just signed', () => {
        const token = sign(42);
        expect(verify(42, token)).toBe(true);
    });

    it('is deterministic for the same id', () => {
        expect(sign(7)).toBe(sign(7));
    });

    it('differs across ids', () => {
        expect(sign(1)).not.toBe(sign(2));
    });

    it('rejects a signature checked against the wrong id', () => {
        const token = sign(42);
        expect(verify(43, token)).toBe(false);
    });

    it('rejects a tampered signature', () => {
        const token = sign(42);
        const tampered = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
        expect(verify(42, tampered)).toBe(false);
    });

    it('rejects null/undefined/empty tokens without throwing', () => {
        expect(verify(42, null)).toBe(false);
        expect(verify(42, undefined)).toBe(false);
        expect(verify(42, '')).toBe(false);
    });

    it('rejects a token of a completely different length without throwing', () => {
        expect(verify(42, 'x')).toBe(false);
        expect(verify(42, 'x'.repeat(500))).toBe(false);
    });
});
