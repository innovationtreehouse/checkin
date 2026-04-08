import { isAuthorizedCron } from '../cron-auth';

// Mock logger to avoid console spew during tests
jest.mock('@/lib/logger', () => ({
    logger: {
        error: jest.fn(),
    },
}));

describe('isAuthorizedCron', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('returns true for a valid authorization header', () => {
        process.env.CRON_SECRET = 'valid-secret';
        const req = {
            headers: new Headers({
                authorization: 'Bearer valid-secret',
            }),
        } as unknown as Request;

        expect(isAuthorizedCron(req)).toBe(true);
    });

    it('returns false for an invalid authorization header', () => {
        process.env.CRON_SECRET = 'valid-secret';
        const req = {
            headers: new Headers({
                authorization: 'Bearer invalid-secret',
            }),
        } as unknown as Request;

        expect(isAuthorizedCron(req)).toBe(false);
    });

    it('returns false if the authorization header is missing', () => {
        process.env.CRON_SECRET = 'valid-secret';
        const req = {
            headers: new Headers(),
        } as unknown as Request;

        expect(isAuthorizedCron(req)).toBe(false);
    });

    it('returns false if CRON_SECRET is missing', () => {
        delete process.env.CRON_SECRET;
        const req = {
            headers: new Headers({
                authorization: 'Bearer any-secret',
            }),
        } as unknown as Request;

        expect(isAuthorizedCron(req)).toBe(false);
    });
});
