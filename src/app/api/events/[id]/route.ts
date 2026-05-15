import prisma from "@/lib/prisma";
import { handler, badRequest, forbidden, notFound, unauthorized } from "@/security/handler";

export const GET = handler<{ id: string }>('GET /api/events/[id]', async ({ params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const eventId = parseInt(params.id, 10);
    if (isNaN(eventId)) throw badRequest("Invalid event ID");

    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
            program: {
                include: {
                    volunteers: {
                        include: { participant: true }
                    },
                    participants: {
                        include: { participant: true }
                    }
                }
            },
            visits: true,
            rsvps: {
                include: { participant: true }
            },
            attendanceConfirmedBy: {
                select: { name: true }
            }
        }
    });

    if (!event) throw notFound("Event not found");

    return { Event: event };
});

export const PATCH = handler<{ id: string }>('PATCH /api/events/[id]', async ({ req, params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const eventId = parseInt(params.id, 10);
    const body = await req.json();

    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: { program: { include: { volunteers: true } } }
    });

    if (!event) throw notFound("Event not found");

    const user = auth.user;
    const userId = user.id;
    const isSysAdminOrBoard = user.sysadmin || user.boardMember;
    const isLeadMentor = event.program?.leadMentorId === userId;
    const isCoreVolunteer = event.program?.volunteers?.some(v => v.participantId === userId && v.isCore) || false;

    if (body.action === 'confirmAttendance') {
        if (!isSysAdminOrBoard && !isLeadMentor && !isCoreVolunteer) {
            throw forbidden("Forbidden: Not authorized to confirm attendance");
        }

        const updatedEvent = await prisma.event.update({
            where: { id: eventId },
            data: {
                attendanceConfirmedAt: new Date(),
                attendanceConfirmedById: userId
            }
        });

        return { Event: updatedEvent };
    }

    if (body.action === 'editTime' || body.action === 'cancel') {
        if (!isSysAdminOrBoard && !isLeadMentor) {
            throw forbidden("Forbidden: Only Lead Mentors or Admins can edit/cancel events");
        }

        const { start, end, applyToFuture } = body;

        const timeShiftStartMs = start ? new Date(start).getTime() - event.start.getTime() : 0;
        const timeShiftEndMs = end ? new Date(end).getTime() - event.end.getTime() : 0;

        if (applyToFuture && event.recurringGroupId) {
            const futureEvents = await prisma.event.findMany({
                where: {
                    recurringGroupId: event.recurringGroupId,
                    start: { gte: event.start }
                }
            });

            if (body.action === 'cancel') {
                const eventIds = futureEvents.map(e => e.id);
                await prisma.rSVP.deleteMany({ where: { eventId: { in: eventIds } } });
                await prisma.visit.updateMany({ where: { associatedEventId: { in: eventIds } }, data: { associatedEventId: null } });
                await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

                return { count: futureEvents.length };
            } else if (body.action === 'editTime') {
                const updatePromises = futureEvents.map(fe => {
                    return prisma.event.update({
                        where: { id: fe.id },
                        data: {
                            start: new Date(fe.start.getTime() + timeShiftStartMs),
                            end: new Date(fe.end.getTime() + timeShiftEndMs)
                        }
                    });
                });

                await prisma.$transaction(updatePromises);

                return { count: futureEvents.length };
            }
        } else {
            if (body.action === 'cancel') {
                await prisma.rSVP.deleteMany({ where: { eventId: event.id } });
                await prisma.visit.updateMany({ where: { associatedEventId: event.id }, data: { associatedEventId: null } });
                await prisma.event.delete({ where: { id: event.id } });
                return { success: true };
            } else if (body.action === 'editTime') {
                const updatedEvent = await prisma.event.update({
                    where: { id: event.id },
                    data: {
                        start: start ? new Date(start) : event.start,
                        end: end ? new Date(end) : event.end
                    }
                });
                return { Event: updatedEvent };
            }
        }
    }

    if (body.action === 'manualEditAttendance') {
        if (!isSysAdminOrBoard && !isLeadMentor && !isCoreVolunteer) {
            throw forbidden("Forbidden: Not authorized to edit attendance");
        }

        const { participantId, status, arrived, departed } = body;

        if (!participantId || !status) {
            throw badRequest("Missing required fields");
        }

        if (status === 'Absent') {
            await prisma.visit.deleteMany({
                where: {
                    participantId: Number(participantId),
                    associatedEventId: eventId
                }
            });
        } else if (status === 'Present') {
            if (!arrived) {
                throw badRequest("Arrival time is required for Present status");
            }

            const existingVisit = await prisma.visit.findFirst({
                where: {
                    participantId: Number(participantId),
                    associatedEventId: eventId
                }
            });

            if (existingVisit) {
                await prisma.visit.update({
                    where: { id: existingVisit.id },
                    data: {
                        arrived: new Date(arrived),
                        departed: departed ? new Date(departed) : null
                    }
                });
            } else {
                await prisma.visit.create({
                    data: {
                        participantId: Number(participantId),
                        associatedEventId: eventId,
                        arrived: new Date(arrived),
                        departed: departed ? new Date(departed) : null
                    }
                });
            }
        }

        return { success: true };
    }

    throw badRequest("Invalid action");
});
