let mockIsDevInstance = false;
const mockCapture = jest.fn();
let mockIdentity: { from: string; replyTo?: string } = { from: 'test@test.com' };

jest.mock('resend');
jest.mock('../config.ts', () => ({
    config: {
        resendApiKey: () => null,
        emailFrom: () => 'test@test.com',
        isDevInstance: () => mockIsDevInstance,
    },
}));
jest.mock('../dev/sentMail', () => ({
    captureSentEmail: (...args: unknown[]) => mockCapture(...args),
}));
jest.mock('../emailIdentity', () => ({
    getEmailSenderIdentity: () => Promise.resolve(mockIdentity),
}));

import { sendEmail } from '../email';

// process.env.NODE_ENV is typed read-only; tests need to vary it at runtime
const setNodeEnv = (value: string | undefined) => {
    Object.defineProperty(process.env, 'NODE_ENV', { value, configurable: true });
};

describe('sendEmail no-key logging + capture', () => {
    let originalConsoleLog: (...data: unknown[]) => void;
    let originalEnv: string | undefined;

    beforeEach(() => {
        originalConsoleLog = console.log;
        console.log = jest.fn();
        originalEnv = process.env.NODE_ENV;
        mockIsDevInstance = false;
        mockCapture.mockReset();
        mockIdentity = { from: 'test@test.com' };
    });

    afterEach(() => {
        console.log = originalConsoleLog;
        setNodeEnv(originalEnv);
    });

    it('logs the To/Subject line but never the body (no body logging in any env)', async () => {
        setNodeEnv('development');
        mockIsDevInstance = true;
        mockCapture.mockResolvedValue(true);
        const html = 'Sensitive body <a href="reset">Link</a>';

        await sendEmail('test@test.com', 'Test Subject', html);

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Email (no RESEND_API_KEY)]'));
        expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining(html));
    });

    it('captures and returns true on a dev instance (gating callers get the happy-path)', async () => {
        setNodeEnv('development');
        mockIsDevInstance = true;
        mockCapture.mockResolvedValue(true);
        const html = '<p>Confirm <a href="/x">here</a></p>';

        const result = await sendEmail('to@test.com', 'Subj', html);

        expect(result).toBe(true);
        expect(mockCapture).toHaveBeenCalledWith('test@test.com', 'to@test.com', 'Subj', html);
    });

    it('returns false when the dev capture itself fails (does not mask a broken dev DB)', async () => {
        setNodeEnv('development');
        mockIsDevInstance = true;
        mockCapture.mockResolvedValue(false);

        const result = await sendEmail('to@test.com', 'Subj', '<p>hi</p>');

        expect(result).toBe(false);
    });

    it('does NOT capture and returns false in production even without a key (fail loud)', async () => {
        setNodeEnv('production');
        mockIsDevInstance = true; // guard still fails on NODE_ENV === 'production'

        const result = await sendEmail('to@test.com', 'Subj', '<p>hi</p>');

        expect(result).toBe(false);
        expect(mockCapture).not.toHaveBeenCalled();
    });

    it('does NOT capture and returns false when not a dev instance', async () => {
        setNodeEnv('test');
        mockIsDevInstance = false;

        const result = await sendEmail('to@test.com', 'Subj', '<p>hi</p>');

        expect(result).toBe(false);
        expect(mockCapture).not.toHaveBeenCalled();
    });
});

// The describe above mocks resendApiKey to null, so `resend` is null and only the
// no-key branch runs. These tests give email.ts a configured key (so `resend`
// is a real client) and exercise the two send-failure paths, which the suite above
// can't reach: Resend returning `{ error }`, and Resend throwing. Both must → false.
describe('sendEmail send-failure contract (Resend configured)', () => {
    const sendMock = jest.fn();
    let doMockIdentity: { from: string; replyTo?: string } = { from: 'test@test.com' };
    let errorSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.resetModules();
        sendMock.mockReset();
        doMockIdentity = { from: 'test@test.com' };
        // Re-mock the module's deps for the fresh module instance loaded below.
        jest.doMock('../config.ts', () => ({
            config: { resendApiKey: () => 'test-key', emailFrom: () => 'test@test.com', isDevInstance: () => false },
        }));
        jest.doMock('../dev/sentMail', () => ({ captureSentEmail: jest.fn() }));
        jest.doMock('../emailIdentity', () => ({ getEmailSenderIdentity: () => Promise.resolve(doMockIdentity) }));
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
        jest.dontMock('../dev/sentMail');
        jest.dontMock('../emailIdentity');
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

    it('passes the resolved From and, when set, Reply-To through to Resend', async () => {
        doMockIdentity = { from: 'Org <no-reply@org.test>', replyTo: 'board@org.test' };
        sendMock.mockResolvedValue({ data: { id: '1' }, error: null });
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { sendEmail: send } = require('../email');

        const result = await send('to@org.test', 'Subject', '<p>hi</p>');
        expect(result).toBe(true);
        expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
            from: 'Org <no-reply@org.test>',
            replyTo: 'board@org.test',
        }));
    });

    it('omits Reply-To entirely when the identity has none', async () => {
        doMockIdentity = { from: 'test@test.com' };
        sendMock.mockResolvedValue({ data: { id: '1' }, error: null });
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { sendEmail: send } = require('../email');

        await send('to@test.com', 'Subject', '<p>hi</p>');
        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(sendMock.mock.calls[0][0]).not.toHaveProperty('replyTo');
    });
});
