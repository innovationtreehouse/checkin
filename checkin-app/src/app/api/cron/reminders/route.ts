import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cronAuth";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";

/**
 * Expected to be called by an external CRON trigger (e.g. Vercel Cron or CloudWatch Events)
 * GET /api/cron/reminders
 *
 * Delivery guarantee: at-least-once with best-effort dedup, NOT exactly-once.
 * `reminderSentAt` is stamped only after `sendNotification` resolves, so a send
 * failure leaves the RSVP eligible next run rather than silently dropping it.
 * The one residual double-send window is send-succeeds-then-stamp-fails: the
 * notification went out but the stamp write threw, so the next run re-sends.
 * That's fundamental — an external send can't be transactionally bound to a DB
 * write. Likewise, this assumes the platform never runs the job concurrently
 * with itself; two overlapping runs could both read `reminderSentAt: null`
 * before either stamps and double-send.
 */
export async function GET(req: Request) {
    const denied = requireCronSecret(req);
    if (denied) return denied;

    try {
        const now = new Date();
        const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        // Look 15 minutes past the 2h mark so a 15m-interval cron can't miss an event.
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
                    // Only RSVPs that haven't been reminded yet — the window can overlap
                    // across runs, so reminderSentAt is what makes this idempotent.
                    where: { status: 'ATTENDING', reminderSentAt: null }
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
                })).then(async (ok) => {
                    // Mark sent only when the notification actually delivered, so a send
                    // failure leaves it eligible for the next run rather than silently dropped.
                    if (!ok) return;
                    await prisma.rSVP.update({
                        where: {
                            eventId_participantId: {
                                eventId: event.id,
                                participantId: rsvp.participantId
                            }
                        },
                        data: { reminderSentAt: new Date() }
                    });
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
