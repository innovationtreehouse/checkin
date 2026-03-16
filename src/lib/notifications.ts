/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "./prisma";
import { sendEmail } from "./email";
import { formatTime, formatDate } from "./time";
import { checkinReceiptTemplate } from "./email-templates/checkin";
import { householdMemberTemplate } from "./email-templates/household";

/**
 * Service to handle sending notifications to users via their defined preferences.
 */

export type NotificationEvent =
    | 'RSVP_REMINDER'
    | 'PROGRAM_ENROLLMENT'
    | 'EVENT_STARTING_SOON'
    | 'ATTENDANCE_VALIDATED'
    | 'RSVP_UPDATED'
    | 'PROGRAM_ASSIGNMENT'
    | 'CHECKIN'
    | 'CHECKOUT';

export async function sendNotification(userId: number, eventType: NotificationEvent, payload: Record<string, any>) {
    try {
        const user = await prisma.participant.findUnique({
            where: { id: userId },
            select: { email: true, notificationSettings: true, name: true }
        });

        if (!user || !user.email) return;

        // Construct message based on type
        let message = "";
        let subject = "Treehouse Notification";

        switch (eventType) {
            case 'PROGRAM_ENROLLMENT':
                subject = `Confirmed: Enrollment in ${payload.programName}`;
                message = `Hi ${user.name}, you have been successfully enrolled in ${payload.programName}.`;
                break;
            case 'EVENT_STARTING_SOON':
                subject = `Reminder: ${payload.eventName} starts soon!`;
                message = `Hi ${user.name}, your event ${payload.eventName} is starting in ${payload.hours} hours.`;
                break;
            case 'ATTENDANCE_VALIDATED':
                subject = `Attendance Verified: ${payload.eventName}`;
                message = `Hi ${user.name}, your attendance at ${payload.eventName} has been recorded by administrators.`;
                break;
            case 'CHECKIN':
                subject = `✅ Checked In — ${user.name}`;
                message = `Hi ${user.name}, you arrived at Innovation Treehouse at ${payload.time}.`;
                break;
            case 'CHECKOUT':
                subject = `👋 Checked Out — ${user.name}`;
                message = `Hi ${user.name}, you departed Innovation Treehouse at ${payload.time}.`;
                break;
            default:
                message = `System Action: ${eventType}`;
        }

        // Check user preferences
        const settings = user.notificationSettings as any;
        const wantsEmail = settings?.email !== false; // Active by default

        if (wantsEmail) {
            await sendEmail(user.email, subject, `<p>${message}</p>`);
        }

    } catch (error) {
        console.error("Failed to sequence notification:", error);
    }
}

/**
 * Send check-in/out notifications based on user & household preferences.
 * 
 * Handles two notification settings:
 * - emailCheckinReceipts: send to the participant themselves
 * - emailDependentCheckins: send to household leads when a dependent checks in/out
 */
export async function sendCheckinNotifications(participantId: number, type: 'checkin' | 'checkout') {
    try {
        const participant = await prisma.participant.findUnique({
            where: { id: participantId },
            select: {
                id: true,
                name: true,
                email: true,
                notificationSettings: true,
                householdId: true,
            }
        });

        if (!participant) return;

        const now = new Date();
        const timeStr = formatTime(now, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        const dateStr = formatDate(now, {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });

        const action = type === 'checkin' ? 'checked in to' : 'checked out of';
        const emoji = type === 'checkin' ? '✅' : '👋';
        const name = participant.name || 'A member';

        // 1. Send receipt to the participant themselves if they opted in
        const settings = participant.notificationSettings as any;
        if (settings?.emailCheckinReceipts && participant.email) {
            const subject = `${emoji} ${name} ${action} Innovation Treehouse`;
            const html = checkinReceiptTemplate({ name, type, date: dateStr, time: timeStr });
            await sendEmail(participant.email, subject, html);
        }

        // 2. Notify household leads if the participant is in a household
        if (participant.householdId) {
            const householdLeads = await prisma.householdLead.findMany({
                where: { householdId: participant.householdId },
                include: {
                    participant: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            notificationSettings: true
                        }
                    }
                }
            });

            for (const lead of householdLeads) {
                // Don't double-notify if the lead IS the participant
                if (lead.participant.id === participant.id) continue;

                const leadSettings = lead.participant.notificationSettings as any;
                if (leadSettings?.emailDependentCheckins && lead.participant.email) {
                    const subject = `${emoji} ${name} ${action} Innovation Treehouse`;
                    const html = householdMemberTemplate({
                        leadName: lead.participant.name || 'there',
                        memberName: name,
                        type,
                        date: dateStr,
                        time: timeStr
                    });
                    await sendEmail(lead.participant.email, subject, html);
                }
            }
        }

    } catch (error) {
        console.error("Failed to send checkin notifications:", error);
    }
}
