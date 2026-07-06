const mockFindUnique = jest.fn();
jest.mock('../prisma', () => ({ __esModule: true, default: { boardSettings: { findUnique: (...a: unknown[]) => mockFindUnique(...a) } } }));
jest.mock('../config', () => ({ config: { emailFrom: () => 'env-default@example.com' } }));

import { getEmailSenderIdentity } from '../emailIdentity';

describe('getEmailSenderIdentity', () => {
    beforeEach(() => mockFindUnique.mockReset());

    it('falls back to the env From with no Reply-To when nothing is configured', async () => {
        mockFindUnique.mockResolvedValue(null);
        expect(await getEmailSenderIdentity()).toEqual({ from: 'env-default@example.com', replyTo: undefined });
    });

    it('lets BoardSettings override the From and set a Reply-To', async () => {
        mockFindUnique.mockResolvedValue({ emailFromAddress: 'Org <no-reply@org.test>', emailReplyToAddress: 'board@org.test' });
        expect(await getEmailSenderIdentity()).toEqual({ from: 'Org <no-reply@org.test>', replyTo: 'board@org.test' });
    });

    it('treats blank/whitespace values as unset (env From, no Reply-To)', async () => {
        mockFindUnique.mockResolvedValue({ emailFromAddress: '   ', emailReplyToAddress: '' });
        expect(await getEmailSenderIdentity()).toEqual({ from: 'env-default@example.com', replyTo: undefined });
    });

    it('never blocks mail: falls back to the env From if the settings read throws', async () => {
        mockFindUnique.mockRejectedValue(new Error('db down'));
        expect(await getEmailSenderIdentity()).toEqual({ from: 'env-default@example.com' });
    });
});
