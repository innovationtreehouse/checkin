import { sendCheckinNotifications } from '../notifications';
import { sendEmail } from '../email';
import prisma from '../prisma';

jest.mock('../email', () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

jest.mock('../prisma', () => ({
    __esModule: true,
    default: {
        participant: {
            findUnique: jest.fn()
        },
        householdLead: {
            findMany: jest.fn()
        }
    }
}));

// We globally mock the notifications module's sendNotification
jest.mock('../notifications', () => {
    const original = jest.requireActual('../notifications');
    return {
        ...original,
        sendNotification: jest.fn().mockResolvedValue(undefined)
    };
});
import { sendNotification } from '../notifications';

describe('sendCheckinNotifications', () => {
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
        jest.clearAllMocks();

        jest.useFakeTimers();
        jest.setSystemTime(new Date('2024-03-07T14:30:00Z'));

        originalConsoleError = console.error;
        console.error = jest.fn();
    });

    afterEach(() => {
        jest.useRealTimers();
        console.error = originalConsoleError;
    });

    const expectedSelect = {
        id: true,
        name: true,
        email: true,
        notificationSettings: true,
        householdId: true,
        firstName: true,
        lastName: true,
        emergencyContactPhone: true,
        emergencyContactEmail: true,
        notifyEmergencyContact: true,
    };

    it('should do nothing if the participant does not exist', async () => {
        (prisma.participant.findUnique as jest.Mock).mockResolvedValueOnce(null);

        await sendCheckinNotifications(1, 'checkin');

        expect(prisma.participant.findUnique).toHaveBeenCalledWith({
            where: { id: 1 },
            select: expectedSelect
        });
        expect(sendEmail).not.toHaveBeenCalled();
        expect(prisma.householdLead.findMany).not.toHaveBeenCalled();
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('should send an email to the participant if they opt in (checkin)', async () => {
        (prisma.participant.findUnique as jest.Mock).mockResolvedValueOnce({
            id: 1,
            name: 'John Doe',
            email: 'john@example.com',
            notificationSettings: { emailCheckinReceipts: true },
            householdId: null,
            notifyEmergencyContact: false
        });

        await sendCheckinNotifications(1, 'checkin');

        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(sendEmail).toHaveBeenCalledWith(
            'john@example.com',
            expect.stringContaining('✅ John Doe checked in to Innovation Treehouse'),
            expect.stringContaining('John Doe')
        );
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('should notify a household lead when a dependent checks in', async () => {
        (prisma.participant.findUnique as jest.Mock).mockResolvedValueOnce({
            id: 2,
            name: 'Child Dependent',
            email: 'child@example.com',
            notificationSettings: { emailCheckinReceipts: false },
            householdId: 10,
        });

        (prisma.householdLead.findMany as jest.Mock).mockResolvedValueOnce([
            {
                householdId: 10,
                participantId: 1,
                participant: {
                    id: 1,
                    name: 'Parent Lead',
                    email: 'parent@example.com',
                    notificationSettings: { emailDependentCheckins: true }
                }
            }
        ]);

        await sendCheckinNotifications(2, 'checkin');

        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(sendEmail).toHaveBeenCalledWith(
            'parent@example.com',
            expect.stringContaining('✅ Child Dependent checked in to Innovation Treehouse'),
            expect.stringContaining('Child Dependent')
        );
    });

    // --- New Emergency Contact Logic Tests --- //

    it('should not send an emergency notification if notifyEmergencyContact is false', async () => {
        (prisma.participant.findUnique as jest.Mock).mockResolvedValueOnce({
            id: 1,
            firstName: 'John',
            lastName: 'Doe',
            emergencyContactEmail: 'emergency@example.com',
            notifyEmergencyContact: false,
        });

        await sendCheckinNotifications(1, 'checkin');

        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('should send a checkin notification if notifyEmergencyContact is true and email exists', async () => {
        (prisma.participant.findUnique as jest.Mock).mockResolvedValueOnce({
            id: 1,
            firstName: 'John',
            lastName: 'Doe',
            emergencyContactPhone: '555-1234',
            emergencyContactEmail: 'emergency@example.com',
            notifyEmergencyContact: true,
        });

        await sendCheckinNotifications(1, 'checkin');

        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(sendNotification).toHaveBeenCalledWith(1, 'EMERGENCY_CONTACT_ALERT', {
            contactType: 'email',
            contactInfo: 'emergency@example.com',
            message: 'John Doe has checked in to the facility.'
        });
    });

    it('should send a checkout notification if notifyEmergencyContact is true and email exists', async () => {
        (prisma.participant.findUnique as jest.Mock).mockResolvedValueOnce({
            id: 2,
            firstName: 'Jane',
            lastName: 'Smith',
            emergencyContactEmail: 'emergency2@example.com',
            notifyEmergencyContact: true,
        });

        await sendCheckinNotifications(2, 'checkout');

        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(sendNotification).toHaveBeenCalledWith(2, 'EMERGENCY_CONTACT_ALERT', {
            contactType: 'email',
            contactInfo: 'emergency2@example.com',
            message: 'Jane Smith has checked out of the facility.'
        });
    });

    it('should not send a notification if notifyEmergencyContact is true but there is no emergency email', async () => {
        (prisma.participant.findUnique as jest.Mock).mockResolvedValueOnce({
            id: 1,
            firstName: 'John',
            lastName: 'Doe',
            emergencyContactEmail: null,
            notifyEmergencyContact: true,
        });

        await sendCheckinNotifications(1, 'checkin');

        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('should catch and log errors to console.error', async () => {
        const error = new Error('Database down');
        (prisma.participant.findUnique as jest.Mock).mockRejectedValueOnce(error);

        await sendCheckinNotifications(1, 'checkin');

        expect(console.error).toHaveBeenCalledWith('Failed to send checkin notifications:', error);
    });
});
