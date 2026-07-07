/**
 * @jest-environment node
 */
/**
 * Route-level auth-gate tests for GET /api/cron/trusted-adult-expiry.
 *
 * The sweep SERVICE (runExpirySweep) is unit-tested elsewhere; nothing exercised
 * the ROUTE's `requireCronSecret` gate or its success envelope. The service is
 * mocked here so this is a pure unit test (no DB): we only assert the gate
 * (missing / wrong secret → 401) and the 200 envelope when authorized.
 */
import { GET } from '../route';

jest.mock('@/lib/trusted-adult/service', () => ({
    runExpirySweep: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runExpirySweep } = require('@/lib/trusted-adult/service');

const SECRET = 'cron-secret-under-test';

function req(authHeader?: string) {
    return new Request('http://localhost/api/cron/trusted-adult-expiry', {
        method: 'GET',
        ...(authHeader ? { headers: { authorization: authHeader } } : {}),
    });
}

describe('GET /api/cron/trusted-adult-expiry — auth gate', () => {
    const prev = process.env.CRON_SECRET;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CRON_SECRET = SECRET;
    });

    afterAll(() => {
        if (prev === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = prev;
    });

    it('401 when the Authorization header is missing', async () => {
        const res = await GET(req());
        expect(res.status).toBe(401);
        expect(runExpirySweep).not.toHaveBeenCalled();
    });

    it('401 when the bearer secret is wrong', async () => {
        const res = await GET(req('Bearer not-the-secret'));
        expect(res.status).toBe(401);
        expect(runExpirySweep).not.toHaveBeenCalled();
    });

    it('200 with the success envelope when the secret is correct', async () => {
        (runExpirySweep as jest.Mock).mockResolvedValue({ expired: 1 });

        const res = await GET(req(`Bearer ${SECRET}`));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, expired: 1 });
        expect(runExpirySweep).toHaveBeenCalledTimes(1);
    });
});
