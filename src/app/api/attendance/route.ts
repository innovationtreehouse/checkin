import prisma from "@/lib/prisma";
import { getFullAttendance } from "@/lib/getFullAttendance";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { logBackendError } from "@/lib/logger";
import { ApiResponseError, handler, badRequest, forbidden, notFound, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/attendance', async ({ auth }) => {
    try {
        if (auth.type !== 'session' && auth.type !== 'kiosk') throw unauthorized();

        const isKiosk = auth.type === 'kiosk';
        const user = auth.type === 'session' ? auth.user : undefined;

        const { attendance, counts, safety } = await getFullAttendance();

        const isAdmin = isKiosk || user?.sysadmin || user?.boardMember || user?.keyholder;

        if (isAdmin) {
            return {
                access: "full",
                attendance,
                counts,
                safety,
                signedRequest: isKiosk,
            };
        }

        const selfVisit = user ? attendance.find(v => v.participant.id === Number(user.id)) || null : null;
        const householdVisits = (user?.householdId)
            ? attendance.filter(v => v.participant.householdId === user.householdId)
            : [];

        return {
            access: "limited",
            counts,
            safety,
            self: selfVisit,
            household: householdVisits,
            signedRequest: isKiosk,
        };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "GET /api/attendance");
        throw err;
    }
});

export const DELETE = handler('DELETE /api/attendance', async ({ req, auth }) => {
    try {
        if (auth.type !== 'session') throw unauthorized();
        const user = auth.user;

        const body = await req.json();
        const { visitId } = body;

        if (!visitId) {
            throw badRequest("visitId is required");
        }

        const visit = await prisma.visit.findUnique({
            where: { id: visitId },
            include: { participant: true }
        });

        if (!visit) {
            throw notFound("Visit not found");
        }

        const isSelf = visit.participantId === Number(user.id);
        const isHouseholdCheckOut = Boolean(user.householdId && visit.participant.householdId === user.householdId && user.householdLead);
        const isAdmin = user.sysadmin || user.keyholder || user.boardMember;

        if (!isSelf && !isHouseholdCheckOut && !isAdmin) {
            throw forbidden("Forbidden: You are not authorized to check out this user.");
        }

        const finalVisits = await processVisitCheckout(visitId, new Date());
        const updatedVisit = finalVisits.length > 0 ? finalVisits[finalVisits.length - 1] : visit;

        return { Visit: updatedVisit };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "DELETE /api/attendance");
        throw err;
    }
});

export const POST = handler('POST /api/attendance', async ({ req, auth }) => {
    try {
        if (auth.type !== 'session') throw unauthorized();
        const user = auth.user;
        const isAdmin = user.sysadmin || user.keyholder || user.boardMember;

        const body = await req.json();
        const { type, message, participantId } = body;

        if (type === 'MANUAL_CHECKIN') {
            if (!participantId) {
                throw badRequest("participantId is required");
            }

            const participant = await prisma.participant.findUnique({
                where: { id: participantId }
            });

            if (!participant) {
                throw notFound("Participant not found");
            }

            const isSelf = participant.id === Number(user.id);
            const isHouseholdCheckIn = Boolean(user.householdId && participant.householdId === user.householdId && user.householdLead);
            if (!isSelf && !isHouseholdCheckIn && !isAdmin) {
                throw forbidden("Forbidden: You are not authorized to check in this user.");
            }

            const activeVisit = await prisma.visit.findFirst({
                where: {
                    participantId: participant.id,
                    departed: null
                }
            });

            if (activeVisit) {
                throw badRequest("User is already checked in");
            }

            const arrivalTime = new Date();
            const eventId = await findAssociatedEventAt(participant.id, arrivalTime);

            const newVisit = await prisma.visit.create({
                data: {
                    participantId: participant.id,
                    arrived: arrivalTime,
                    associatedEventId: eventId
                }
            });

            return { Visit: newVisit };
        }

        if (type === 'TWO_DEEP_VIOLATION') {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const recentLog = await prisma.auditLog.findFirst({
                where: {
                    tableName: 'SYSTEM_NOTIFY',
                    action: 'CREATE',
                    time: { gte: fiveMinutesAgo }
                }
            });

            if (recentLog) {
                return { success: false, message: "Notification already sent recently." };
            }

            const boardMembers = await prisma.participant.findMany({
                where: { boardMember: true },
                select: { email: true, name: true }
            });

            await prisma.auditLog.create({
                data: {
                    actorId: 0,
                    action: 'CREATE',
                    tableName: 'SYSTEM_NOTIFY',
                    affectedEntityId: 0,
                    newData: { message: `Sent Two-Deep warning to ${boardMembers.length} board member(s).` } as unknown as never
                }
            });

            console.log("CRITICAL NOTIFICATION TO BOARD MEMBERS:", boardMembers.map(m => m.email).join(', '));
            console.log("Message:", message);

            return { notified: boardMembers.length };
        }

        throw badRequest("Unknown notification type");
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "POST /api/attendance");
        throw err;
    }
});
