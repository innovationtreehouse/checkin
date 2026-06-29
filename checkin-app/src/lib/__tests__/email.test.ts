import { sendEmail } from '../email';
jest.mock('resend');
jest.mock('../config.ts', () => ({
    config: {
        resendApiKey: () => null,
        emailFrom: () => 'test@test.com'
    }
}));

// process.env.NODE_ENV is typed read-only; tests need to vary it at runtime
const setNodeEnv = (value: string | undefined) => {
    Object.defineProperty(process.env, 'NODE_ENV', { value, configurable: true });
};

describe('Email Logging Security', () => {
    let originalConsoleLog: (...data: unknown[]) => void;
    let originalEnv: string | undefined;

    beforeEach(() => {
        originalConsoleLog = console.log;
        console.log = jest.fn();
        originalEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
        console.log = originalConsoleLog;
        setNodeEnv(originalEnv);
    });

    it('should not log email body in production', async () => {
        setNodeEnv('production');
        const html = 'Sensitive Information <a href="reset">Link</a>';

        await sendEmail('test@test.com', 'Test Subject', html);

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Email (no RESEND_API_KEY)]'));
        expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining(html));
    });

    it('should log email body in development', async () => {
        setNodeEnv('development');
        const html = 'Development Body';

        await sendEmail('test@test.com', 'Test Subject', html);

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Email (no RESEND_API_KEY)]'));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining(html));
    });
});

// The describe above mocks resendApiKey to null, so `resend` is null and only the
// no-key log branch runs. These tests give email.ts a configured key (so `resend`
// is a real client) and exercise the two send-failure paths, which the suite above
// can't reach: Resend returning `{ error }`, and Resend throwing. Both must → false.
describe('sendEmail send-failure contract (Resend configured)', () => {
    const sendMock = jest.fn();
    let errorSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.resetModules();
        sendMock.mockReset();
        // Re-mock the module's deps for the fresh module instance loaded below.
        jest.doMock('../config.ts', () => ({
            config: { resendApiKey: () => 'test-key', emailFrom: () => 'test@test.com' },
        }));
        jest.doMock('resend', () => ({
            Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
        }));
        // Silence the expected error logging from the failure paths.
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
        logSpy.mockRestore();
        jest.dontMock('../config.ts');
        jest.dontMock('resend');
    });

    it('returns false when Resend responds with an { error }', async () => {
        sendMock.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'bad recipient' } });
        // Require AFTER doMock so the fresh module captures a non-null `resend`.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { sendEmail: send } = require('../email');

        const result = await send('test@test.com', 'Subject', '<p>hi</p>');
        expect(result).toBe(false);
        expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('returns false when the Resend call throws', async () => {
        sendMock.mockRejectedValue(new Error('network down'));
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { sendEmail: send } = require('../email');

        const result = await send('test@test.com', 'Subject', '<p>hi</p>');
        expect(result).toBe(false);
        expect(sendMock).toHaveBeenCalledTimes(1);
    });
});
