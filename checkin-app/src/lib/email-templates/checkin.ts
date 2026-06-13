import { baseEmailLayout } from './base';

interface CheckinTemplateParams {
    name: string;
    type: 'checkin' | 'checkout';
    date: string;
    time: string;
}

/**
 * Email template for check-in/checkout receipt sent to the participant.
 */
export function checkinReceiptTemplate({ name, type, date, time }: CheckinTemplateParams): string {
    const emoji = type === 'checkin' ? '✅' : '👋';
    const action = type === 'checkin' ? 'Started' : 'Ended';

    return baseEmailLayout(`
        <h2 style="color: #6366f1;">${emoji} Visit ${action}</h2>
        <p><strong>${name}</strong> ${type === 'checkin' ? 'checked in to' : 'checked out of'} Innovation Treehouse.</p>
        <p style="color: #6b7280;">📅 ${date}<br/>🕐 ${time}</p>
    `);
}
