/**
 * @jest-environment node
 */
/**
 * Route-level auth-gate test for GET /api/cron/membership-lapse-cascade. The
 * sweep (runLapseCascadeSweep) is integration-tested against a real DB elsewhere;
 * here the sweep is mocked so this is a pure unit test of the withCron gate and
 * the success envelope.
 */
import { GET } from '../route';

jest.mock('@/lib/membership/lapse', () => ({
    runLapseCascadeSweep: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runLapseCascadeSweep } = require('@/lib/membership/lapse');

const SECRET = 'cron-secret-under-test';

function req(authHeader?: string) {
    return new Request('http://localhost/api/cron/membership-lapse-cascade', {
        method: 'GET',
        ...(authHeader ? { headers: { authorization: authHeader } } : {}),
    });
}

describe('GET /api/cron/membership-lapse-cascade — auth gate', () => {
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
        expect(runLapseCascadeSweep).not.toHaveBeenCalled();
    });

    it('401 when the bearer secret is wrong', async () => {
        const res = await GET(req('Bearer not-the-secret'));
        expect(res.status).toBe(401);
        expect(runLapseCascadeSweep).not.toHaveBeenCalled();
    });

    it('200 with the success envelope when the secret is correct', async () => {
        (runLapseCascadeSweep as jest.Mock).mockResolvedValue({
            candidates: 3, lapsed: 2, newlyFlagged: 2, withdrawn: 1, cleared: 0, autoWithdrawEnabled: true,
        });

        const res = await GET(req(`Bearer ${SECRET}`));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, candidates: 3, lapsed: 2, newlyFlagged: 2, withdrawn: 1, cleared: 0, autoWithdrawEnabled: true });
        expect(runLapseCascadeSweep).toHaveBeenCalledTimes(1);
    });
});
