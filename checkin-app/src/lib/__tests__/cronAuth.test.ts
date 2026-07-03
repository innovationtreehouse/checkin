/**
 * @jest-environment node
 */
/**
 * Unit tests for requireCronSecret — the shared auth gate for all cron routes.
 * No DB: Request objects are constructed directly. This is the primary coverage
 * for cron auth; per-route tests only smoke the valid-token path.
 */
import { requireCronSecret } from '@/lib/cronAuth';

const SECRET = 'unit-cron-secret';

function req(authHeader?: string) {
    return new Request('http://localhost/api/cron/anything', {
        method: 'GET',
        headers: authHeader ? { authorization: authHeader } : {},
    });
}

describe('requireCronSecret', () => {
    const prev = process.env.CRON_SECRET;

    beforeEach(() => {
        process.env.CRON_SECRET = SECRET;
    });

    afterAll(() => {
        if (prev === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = prev;
    });

    it('returns 401 when the Authorization header is missing', () => {
        const res = requireCronSecret(req());
        expect(res?.status).toBe(401);
    });

    it('returns 401 when the bearer token is wrong', () => {
        const res = requireCronSecret(req('Bearer not-the-secret'));
        expect(res?.status).toBe(401);
    });

    it('returns 401 when CRON_SECRET is not configured', () => {
        delete process.env.CRON_SECRET;
        const res = requireCronSecret(req(`Bearer ${SECRET}`));
        expect(res?.status).toBe(401);
    });

    it('returns 401 on a mismatch of a different length (hashes both to fixed length)', () => {
        // timingSafeEqual throws on unequal-length buffers, but since we now hash both
        // inputs using SHA-256 before comparing, we can safely compare strings of
        // differing lengths without leaking length information or crashing.
        const res = requireCronSecret(req('Bearer short'));
        expect(res?.status).toBe(401);
    });

    it('returns null (authorized) for the valid secret', () => {
        const res = requireCronSecret(req(`Bearer ${SECRET}`));
        expect(res).toBeNull();
    });
});
