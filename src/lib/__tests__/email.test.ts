import { sendEmail } from '../email.ts';
jest.mock('resend');
jest.mock('../config.ts', () => ({
    config: {
        resendApiKey: () => null,
        emailFrom: () => 'test@test.com'
    }
}));

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
        process.env.NODE_ENV = originalEnv;
    });

    it('should not log email body in production', async () => {
        process.env.NODE_ENV = 'production';
        const html = 'Sensitive Information <a href="reset">Link</a>';

        await sendEmail('test@test.com', 'Test Subject', html);

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Email (no RESEND_API_KEY)]'));
        expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining(html));
    });

    it('should log email body in development', async () => {
        process.env.NODE_ENV = 'development';
        const html = 'Development Body';

        await sendEmail('test@test.com', 'Test Subject', html);

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Email (no RESEND_API_KEY)]'));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining(html));
    });
});
