import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { config } from "@/lib/config";
import { postEventTemplate } from "@/lib/email-templates/post-event";

interface ProcessPostEventEmailsOptions {
    /**
     * If true, bypasses the 1-hour wait period and processes any events that have already ended.
     * Useful for facility close or nightly cron where we want to forcefully wrap up the day.
     */
    forceImmediate?: boolean;
}

/**
 * Sweeps the database for finished events that haven't had their confirmation emails sent
 * to the program lead. By default, it waits 1 hour after the event ends to ensure all
 * attendance data has settled.
 */
export async function processPostEventEmails(options: ProcessPostEventEmailsOptions = {}) {
    const { forceImmediate = false } = options;
    const now = new Date();
    
    // Determine the cutoff time based on the forceImmediate flag
    const cutoffTime = forceImmediate ? now : new Date(now.getTime() - 1 * 60 * 60 * 1000);

    // Find events that have ended before the cutoff, haven't had an email sent yet, and attendance is not confirmed.
    const finishedEvents = await prisma.event.findMany({
        where: {
            end: {
                lte: cutoffTime
            },
            postEventEmailSent: false,
            attendanceConfirmedAt: null,
            programId: {
                not: null
            }
        },
        include: {
            program: {
                include: {
                    volunteers: {
                        where: { isCore: true },
                        include: { participant: true }
                    }
                }
            },
            rsvps: true,
            visits: true
        }
    });

    let emailsSent = 0;

    for (const event of finishedEvents) {
        const program = event.program;
        if (!program) continue;

        const leadMentorId = program.leadMentorId;
        let recipientEmail: string | null | undefined = null;

        if (leadMentorId) {
            const lead = await prisma.participant.findUnique({
                where: { id: leadMentorId },
                select: { email: true }
            });
            recipientEmail = lead?.email;
        } else {
            // Try to fallback to a core volunteer
            const coreVolunteer = program.volunteers[0]?.participant;
            recipientEmail = coreVolunteer?.email;
        }

        if (!recipientEmail) {
            console.log(`No recipient found for post-event email for event ${event.id}`);
            continue; // Can't send email if we don't know who to send it to
        }

        const attendingRsvps = event.rsvps.filter(r => r.status === 'ATTENDING').length;
        const actualVisits = event.visits.length;

        const baseUrl = config.baseUrl();
        const eventLink = `${baseUrl}/admin/events/${event.id}`;

        const emailHtml = postEventTemplate({
            eventName: event.name,
            attendingRsvps,
            actualVisits,
            eventLink
        });

        const success = await sendEmail(
            recipientEmail,
            `Action Required: Confirm Attendance for ${event.name}`,
            emailHtml
        );

        if (success) {
            await prisma.event.update({
                where: { id: event.id },
                data: { postEventEmailSent: true }
            });
            emailsSent++;
        }
    }

    return { processedEvents: finishedEvents.length, emailsSent };
}
