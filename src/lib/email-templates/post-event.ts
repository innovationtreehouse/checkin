import { baseEmailLayout } from './base';

interface PostEventTemplateParams {
    eventName: string;
    attendingRsvps: number;
    actualVisits: number;
    eventLink: string;
}

/**
 * Email template for post-event attendance confirmation requests
 * sent to the lead mentor or core volunteer.
 */
export function postEventTemplate({ eventName, attendingRsvps, actualVisits, eventLink }: PostEventTemplateParams): string {
    return baseEmailLayout(`
        <h2>Event Completed: ${eventName}</h2>
        <p>The event <strong>${eventName}</strong> has finished.</p>
        <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Attendance Summary</h3>
            <ul style="margin-bottom: 0;">
                <li><strong>RSVPs (Attending):</strong> ${attendingRsvps}</li>
                <li><strong>Logged Check-ins:</strong> ${actualVisits}</li>
            </ul>
        </div>
        <p>Please review the automatically gathered attendance data and officially confirm it for our records. You can make any manual adjustments needed before confirming.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="${eventLink}" style="background-color: #38bdf8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Review & Confirm Attendance</a>
        </div>
    `);
}
