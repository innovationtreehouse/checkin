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

    it('escapes HTML in the participant name to prevent content injection', () => {
        const result = checkinReceiptTemplate({
            ...defaultParams,
            name: '<img src=x onerror=alert(1)><script>evil()</script>',
            type: 'checkin',
        });

        expect(result).not.toContain('<img src=x');
        expect(result).not.toContain('<script>');
        expect(result).toContain('&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;evil()&lt;/script&gt;');
    });
});
