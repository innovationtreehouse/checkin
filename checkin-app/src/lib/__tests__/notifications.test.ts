import { sendNotification, notifyNewProgramAnnounced } from '../notifications';
import { sendEmail } from '../email';
import prisma from '../prisma';

jest.mock('../email', () => ({ sendEmail: jest.fn() }));
jest.mock('../prisma', () => ({
    __esModule: true,
    default: { person: { findUnique: jest.fn(), findMany: jest.fn() } },
}));

const mockSendEmail = sendEmail as jest.Mock;
const mockFindUnique = (prisma as unknown as { person: { findUnique: jest.Mock } }).person.findUnique;
const mockFindMany = (prisma as unknown as { person: { findMany: jest.Mock } }).person.findMany;

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

describe('notifyNewProgramAnnounced opt-in filtering', () => {
    beforeEach(() => jest.clearAllMocks());

    it('emails only users not opted out, defaulting ON', async () => {
        mockFindMany.mockResolvedValue([
            { email: 'in@b.com', name: 'In', notificationSettings: { notifyNewPrograms: true } },
            { email: 'def@b.com', name: 'Def', notificationSettings: {} },            // default ON
            { email: 'null@b.com', name: 'Null', notificationSettings: null },        // default ON
            { email: 'out@b.com', name: 'Out', notificationSettings: { notifyNewPrograms: false } },
            { email: 'noemail@b.com', name: 'NoE', notificationSettings: { email: false } },
            { email: '', name: 'Empty', notificationSettings: {} },                   // empty address
        ]);
        await notifyNewProgramAnnounced('Robotics');

        expect(mockSendEmail).toHaveBeenCalledTimes(3);
        const recipients = mockSendEmail.mock.calls.map(c => c[0]);
        expect(recipients).toEqual(['in@b.com', 'def@b.com', 'null@b.com']);
    });
});
