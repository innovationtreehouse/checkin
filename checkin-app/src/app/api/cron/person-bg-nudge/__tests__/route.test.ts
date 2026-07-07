/**
 * @jest-environment node
 */
/**
 * Route-level auth-gate test for GET /api/cron/person-bg-nudge. The sweep SERVICE
 * (runPersonBgNudgeSweep) is unit/integration-tested elsewhere; the service is mocked
 * here so this is a pure unit test of the withCron gate + success envelope. Mirrors
 * the trusted-adult-expiry route test.
 */
import { GET } from '../route';

jest.mock('@/lib/membership/personBgNudge', () => ({
    runPersonBgNudgeSweep: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runPersonBgNudgeSweep } = require('@/lib/membership/personBgNudge');

const SECRET = 'cron-secret-under-test';

function req(authHeader?: string) {
    return new Request('http://localhost/api/cron/person-bg-nudge', {
        method: 'GET',
        ...(authHeader ? { headers: { authorization: authHeader } } : {}),
    });
}

describe('GET /api/cron/person-bg-nudge — auth gate', () => {
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
        expect(runPersonBgNudgeSweep).not.toHaveBeenCalled();
    });

    it('401 when the bearer secret is wrong', async () => {
        const res = await GET(req('Bearer not-the-secret'));
        expect(res.status).toBe(401);
        expect(runPersonBgNudgeSweep).not.toHaveBeenCalled();
    });

    it('200 with the success envelope when the secret is correct', async () => {
        (runPersonBgNudgeSweep as jest.Mock).mockResolvedValue({ nudged: 3 });

        const res = await GET(req(`Bearer ${SECRET}`));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, nudged: 3 });
        expect(runPersonBgNudgeSweep).toHaveBeenCalledTimes(1);
    });
});
