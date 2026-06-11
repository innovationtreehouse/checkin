import { checkinReceiptTemplate } from '../checkin';

describe('checkinReceiptTemplate', () => {
    const defaultParams = {
        name: 'John Doe',
        date: '2023-10-27',
        time: '14:30',
    };

    it('generates a checkin email template with correct text and emoji', () => {
        const result = checkinReceiptTemplate({
            ...defaultParams,
            type: 'checkin',
        });

        expect(result).toContain('✅ Visit Started');
        expect(result).toContain('<strong>John Doe</strong> checked in to Innovation Treehouse.');
        expect(result).toContain('📅 2023-10-27');
        expect(result).toContain('🕐 14:30');
    });

    it('generates a checkout email template with correct text and emoji', () => {
        const result = checkinReceiptTemplate({
            ...defaultParams,
            type: 'checkout',
        });

        expect(result).toContain('👋 Visit Ended');
        expect(result).toContain('<strong>John Doe</strong> checked out of Innovation Treehouse.');
        expect(result).toContain('📅 2023-10-27');
        expect(result).toContain('🕐 14:30');
    });
});
