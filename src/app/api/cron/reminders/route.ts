import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";

/**
 * Expected to be called by an external CRON trigger (e.g. Vercel Cron or CloudWatch Events)
 * GET /api/cron/reminders
 */
export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || !authHeader) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const expectedHeader = `Bearer ${cronSecret}`;
    const expectedBuffer = Buffer.from(expectedHeader);
    const authBuffer = Buffer.from(authHeader);

    if (
        expectedBuffer.length !== authBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, authBuffer)
    ) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        const notificationPromises: Promise<void>[] = [];

        for (const event of upcomingEvents) {
            for (const rsvp of event.rsvps) {
                const promise = Promise.resolve(sendNotification(rsvp.participantId, 'EVENT_STARTING_SOON', {
                    eventName: event.name,
                    hours: 2
                })).then(() => {
                    notificationsSent++;
                });
                notificationPromises.push(promise);
            }
        }

        await Promise.all(notificationPromises);

        return NextResponse.json({ success: true, processedEvents: upcomingEvents.length, notificationsSent });
    } catch (error) {
        console.error("Failed to run cron reminders:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
