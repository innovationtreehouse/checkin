import { baseEmailLayout, escapeHtml, sourceLine, type VisitSource } from './base';

interface CheckinTemplateParams {
    name: string;
    type: 'checkin' | 'checkout';
    date: string;
    time: string;
    source?: VisitSource | null;
}

/**
 * Email template for check-in/checkout receipt sent to the participant.
 */
export function checkinReceiptTemplate({ name, type, date, time, source }: CheckinTemplateParams): string {
    const emoji = type === 'checkin' ? '✅' : '👋';
    const action = type === 'checkin' ? 'Started' : 'Ended';

    return baseEmailLayout(`
        <h2 style="color: #6366f1;">${emoji} Visit ${action}</h2>
        <p><strong>${escapeHtml(name)}</strong> ${type === 'checkin' ? 'checked in to' : 'checked out of'} Innovation Treehouse.</p>
        <p style="color: #6b7280;">📅 ${date}<br/>🕐 ${time}</p>
        ${sourceLine(source)}
    `);
}
