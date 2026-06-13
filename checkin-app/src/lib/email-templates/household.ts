import { baseEmailLayout } from './base';

interface HouseholdTemplateParams {
    leadName: string;
    memberName: string;
    type: 'checkin' | 'checkout';
    date: string;
    time: string;
}

/**
 * Email template for household leads when a dependent checks in/out.
 */
export function householdMemberTemplate({ leadName, memberName, type, date, time }: HouseholdTemplateParams): string {
    const emoji = type === 'checkin' ? '✅' : '👋';
    const action = type === 'checkin' ? 'checked in to' : 'checked out of';
    const actionNoun = type === 'checkin' ? 'Arrival' : 'Departure';

    return baseEmailLayout(`
        <h2 style="color: #6366f1;">${emoji} Household Member ${actionNoun}</h2>
        <p>Hi ${leadName},</p>
        <p>Your household member <strong>${memberName}</strong> ${action} Innovation Treehouse.</p>
        <p style="color: #6b7280;">📅 ${date}<br/>🕐 ${time}</p>
    `);
}
