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
