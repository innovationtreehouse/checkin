import { householdMemberTemplate } from '../household';

describe('householdMemberTemplate', () => {
    const defaultParams = {
        leadName: 'Jane Lead',
        memberName: 'John Doe',
        date: '2023-10-27',
        time: '14:30',
    };

    it('generates a checkin email for the household lead', () => {
        const result = householdMemberTemplate({ ...defaultParams, type: 'checkin' });

        expect(result).toContain('✅ Household Member Arrival');
        expect(result).toContain('Hi Jane Lead,');
        expect(result).toContain('<strong>John Doe</strong> checked in to Innovation Treehouse.');
        expect(result).toContain('📅 2023-10-27');
        expect(result).toContain('🕐 14:30');
    });

    it('generates a checkout email for the household lead', () => {
        const result = householdMemberTemplate({ ...defaultParams, type: 'checkout' });

        expect(result).toContain('👋 Household Member Departure');
        expect(result).toContain('<strong>John Doe</strong> checked out of Innovation Treehouse.');
    });

    it('indicates the check-in source when provided', () => {
        expect(householdMemberTemplate({ ...defaultParams, type: 'checkin', source: 'SCANNER' }))
            .toContain('via badge scan');
        expect(householdMemberTemplate({ ...defaultParams, type: 'checkin', source: 'WEB' }))
            .toContain('via the web app');
        expect(householdMemberTemplate({ ...defaultParams, type: 'checkin' }))
            .not.toContain('📍 via');
    });

    it('escapes HTML in lead and member names to prevent content injection', () => {
        const result = householdMemberTemplate({
            ...defaultParams,
            leadName: '<script>evil()</script>',
            memberName: '<img src=x onerror=alert(1)>',
            type: 'checkin',
        });

        expect(result).not.toContain('<script>');
        expect(result).not.toContain('<img src=x');
    });
});
