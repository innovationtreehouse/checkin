import { sendNotification } from '../notifications';
import { sendEmail } from '../email';
import prisma from '../prisma';

jest.mock('../email', () => ({ sendEmail: jest.fn() }));
jest.mock('../prisma', () => ({
    __esModule: true,
    default: { person: { findUnique: jest.fn() } },
}));

const mockSendEmail = sendEmail as jest.Mock;
const mockFindUnique = (prisma as unknown as { person: { findUnique: jest.Mock } }).person.findUnique;

describe('sendNotification return contract', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns true and sends nothing when email is disabled (no forever-retry)', async () => {
        mockFindUnique.mockResolvedValue({ email: 'a@b.com', name: 'A', notificationSettings: { email: false } });
        await expect(sendNotification(1, 'EVENT_STARTING_SOON', {})).resolves.toBe(true);
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('returns sendEmail boolean when enabled', async () => {
        mockFindUnique.mockResolvedValue({ email: 'a@b.com', name: 'A', notificationSettings: {} });
        mockSendEmail.mockResolvedValue(true);
        await expect(sendNotification(1, 'EVENT_STARTING_SOON', {})).resolves.toBe(true);

        mockSendEmail.mockResolvedValue(false);
        await expect(sendNotification(1, 'EVENT_STARTING_SOON', {})).resolves.toBe(false);
    });

    it('returns false when sendEmail throws (retryable)', async () => {
        mockFindUnique.mockResolvedValue({ email: 'a@b.com', name: 'A', notificationSettings: {} });
        mockSendEmail.mockRejectedValue(new Error('boom'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        await expect(sendNotification(1, 'EVENT_STARTING_SOON', {})).resolves.toBe(false);
    });

    it('returns true when user not found (nothing to ever send)', async () => {
        mockFindUnique.mockResolvedValue(null);
        await expect(sendNotification(1, 'EVENT_STARTING_SOON', {})).resolves.toBe(true);
        expect(mockSendEmail).not.toHaveBeenCalled();
    });
});
