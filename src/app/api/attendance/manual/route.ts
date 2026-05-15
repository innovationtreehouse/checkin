import prisma from "@/lib/prisma";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { logBackendError } from "@/lib/logger";
import { ApiResponseError, handler, badRequest, unauthorized } from "@/security/handler";

export const POST = handler('POST /api/attendance/manual', async ({ req, auth }) => {
    try {
        if (auth.type !== 'session') throw unauthorized();
        const userId = auth.user.id;

        const body = await req.json();
        const { arrived, departed } = body;

        if (!arrived) {
            throw badRequest("Arrival time is required");
        }

        const arrivalTime = new Date(arrived);
        const departureTime = departed ? new Date(departed) : null;

        if (departureTime && departureTime <= arrivalTime) {
            throw badRequest("Departure time must be after arrival time");
        }

        const eventId = await findAssociatedEventAt(userId, arrivalTime);

        const visit = await prisma.visit.create({
            data: {
                participantId: userId,
                arrived: arrivalTime,
                departed: departureTime,
                associatedEventId: eventId
            }
        });

        if (departureTime) {
            await processVisitCheckout(visit.id, departureTime);
        }

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "CREATE",
                tableName: "Visit",
                affectedEntityId: visit.id,
                newData: JSON.stringify({ arrived, departed, type: "manual_entry" })
            }
        });

        return { Visit: visit };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "POST /api/attendance/manual");
        throw err;
    }
});
