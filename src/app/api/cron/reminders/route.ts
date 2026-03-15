/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";

/**
 * Expected to be called by an external CRON trigger (e.g. Vercel Cron or CloudWatch Events)
 * GET /api/cron/reminders
 */
export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");

    // Fail-closed security check
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new Response("Unauthorized", { status: 401 });
    }

    try {
        const now = new Date();
        const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        // Add a 15-minute window to avoid duplicate triggers if cron is every 15m
        const windowEnd = new Date(twoHoursFromNow.getTime() + 15 * 60 * 1000);

        const upcomingEvents = await prisma.event.findMany({
            where: {
                start: {
                    gte: twoHoursFromNow,
                    lte: windowEnd
                }
            },
            include: {
                rsvps: {
                    where: { status: 'ATTENDING' }
                }
            }
        });

        let notificationsSent = 0;

        for (const event of upcomingEvents) {
            for (const rsvp of event.rsvps) {
                await sendNotification(rsvp.participantId, 'EVENT_STARTING_SOON', {
                    eventName: event.name,
                    hours: 2
                });
                notificationsSent++;
            }
        }

        return NextResponse.json({ success: true, processedEvents: upcomingEvents.length, notificationsSent });
    } catch (error) {
        console.error("Failed to run cron reminders:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
