import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { withAuth } from "@/lib/auth";
import { handler, notFound, forbidden, badRequest } from "@/security/handler";
import { apiError } from "@/lib/api-response";
import { parseVisitTime, departureAfterArrival } from "@/lib/visitTimes";

// FAIL-CLOSED, staff-only. This payload is fundamentally a roster — who is
// enrolled / RSVP'd / attended — and a participant's name, id, and the very
// existence of their enrollment/RSVP/Visit row are all tier 'public'. So the
// handler's per-FIELD stripping (which protects email/phone/dob) CANNOT hide the
// association "person <-> this event": stripping a non-staff caller to 'public'
// still leaks the whole attendee name list (incl. youth). Field-tiering guards
// fields; only admission guards the association. So we gate admission here.
//
// The gate can't live in the registry `authorize`: this route's [id] is an EVENT
// id, but resolveAccess's program-scoped checks key off params.id as a PROGRAM
// id (and fixing that touches the CODEOWNERS-gated access-resolvers). We have the
// fetched event here, so the event->program lead/core-vol check is done inline,
// exactly like the original hand-rolled gate. The registry policy + stripping
// remain as defense-in-depth on the staff tiers (admin -> everyones:*, this
// event's lead/core-vol -> their_program_participants:* via per-row scope).
export const GET = handler<{ id: string }>('GET /api/events/[id]', async ({ auth, params }) => {
    const eventId = parseInt(params.id, 10);
    if (isNaN(eventId)) throw badRequest('Invalid event ID');

    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
            program: {
                include: {
                    volunteers: {
                        include: { person: true }
                    },
                    participants: {
                        include: { person: true }
                    }
                }
            },
            visits: true,
            rsvps: {
                include: { person: true }
            },
            attendanceConfirmedBy: {
                select: { name: true }
            }
        }
    });

    if (!event) throw notFound('Event not found');

    // Roster is staff-only (see header). Non-staff callers never receive it —
    // matches the original inline gate (403 for an existing event they don't staff).
    const isStaff = auth.type === 'session' && (
        auth.user.isSysadmin ||
        auth.user.isBoardMember ||
        event.program?.leadMentorId === auth.user.id ||
        (event.program?.volunteers?.some(v => v.personId === auth.user.id && v.isCore) ?? false)
    );
    if (!isStaff) throw forbidden('Forbidden: Not authorized to view this event');

    return { Event: event };
});

export const PATCH = withAuth({}, async (req: Request, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);

    const resolvedParams = await params;
    const eventId = parseInt(resolvedParams.id, 10);
    if (isNaN(eventId)) return apiError("Invalid event ID", 400);
    const body = await req.json();

    try {
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { program: { include: { volunteers: true } } }
        });

        if (!event) return apiError("Event not found", 404);

        const userId = auth.user.id;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;
        const isLeadMentor = event.program?.leadMentorId === userId;
        const isCoreVolunteer = event.program?.volunteers?.some(v => v.personId === userId && v.isCore) || false;

        // Action: Confirm Attendance
        if (body.action === 'confirmAttendance') {
            if (!isSysAdminOrBoard && !isLeadMentor && !isCoreVolunteer) {
                return apiError("Forbidden: Not authorized to confirm attendance", 403);
            }

            const updatedEvent = await prisma.event.update({
                where: { id: eventId },
                data: { 
                    attendanceConfirmedAt: new Date(),
                    attendanceConfirmedById: userId 
                }
            });

            return NextResponse.json({ success: true, event: updatedEvent });
        }

        // Action: Edit / Cancel Time
        if (body.action === 'editTime' || body.action === 'cancel') {
            // Core volunteers can't edit or cancel events. Only lead mentors, isSysadmin, board.
            if (!isSysAdminOrBoard && !isLeadMentor) {
                return apiError("Forbidden: Only Lead Mentors or Admins can edit/cancel events", 403);
            }

            // Block edits to an event that has already finished — rescheduling a
            // past event is meaningless. Use endAt (not startAt) so an in-progress
            // event still edits.
            if (body.action === 'editTime' && event.endAt.getTime() < Date.now()) {
                return apiError("Cannot edit a past event", 400);
            }

            const { startAt, endAt, applyToFuture } = body;

            const timeShiftStartMs = startAt ? new Date(startAt).getTime() - event.startAt.getTime() : 0;
            const timeShiftEndMs = endAt ? new Date(endAt).getTime() - event.endAt.getTime() : 0;

            if (applyToFuture && event.recurringGroupId) {
                const futureEvents = await prisma.event.findMany({
                    where: {
                        recurringGroupId: event.recurringGroupId,
                        startAt: { gte: event.startAt }
                    }
                });

                if (body.action === 'cancel') {
                    const eventIds = futureEvents.map(e => e.id);
                    // Cleanup RSVPs and Visits first to avoid foreign key constraints.
                    // All three writes in one transaction so a mid-way failure rolls back.
                    await prisma.$transaction([
                        prisma.rSVP.deleteMany({ where: { eventId: { in: eventIds } } }),
                        prisma.visit.updateMany({ where: { associatedEventId: { in: eventIds } }, data: { associatedEventId: null } }),
                        prisma.event.deleteMany({ where: { id: { in: eventIds } } }),
                    ]);

                    return NextResponse.json({ success: true, count: futureEvents.length });
                } else if (body.action === 'editTime') {
                    const ops: Prisma.PrismaPromise<unknown>[] = futureEvents.map(fe => {
                        return prisma.event.update({
                            where: { id: fe.id },
                            data: {
                                startAt: new Date(fe.startAt.getTime() + timeShiftStartMs),
                                endAt: new Date(fe.endAt.getTime() + timeShiftEndMs)
                            }
                        });
                    });

                    await prisma.$transaction(ops);

                    return NextResponse.json({ success: true, count: futureEvents.length });
                }
            } else {
                // Apply ONLY to this single event
                if (body.action === 'cancel') {
                    // All three writes in one transaction so a mid-way failure rolls back.
                    await prisma.$transaction([
                        prisma.rSVP.deleteMany({ where: { eventId: event.id } }),
                        prisma.visit.updateMany({ where: { associatedEventId: event.id }, data: { associatedEventId: null } }),
                        prisma.event.delete({ where: { id: event.id } }),
                    ]);
                    return NextResponse.json({ success: true });
                } else if (body.action === 'editTime') {
                    const updatedEvent = await prisma.event.update({
                        where: { id: event.id },
                        data: {
                            startAt: startAt ? new Date(startAt) : event.startAt,
                            endAt: endAt ? new Date(endAt) : event.endAt
                        }
                    });
                    return NextResponse.json({ success: true, event: updatedEvent });
                }
            }
        }

        // Action: Manual Edit Attendance
        if (body.action === 'manualEditAttendance') {
            if (!isSysAdminOrBoard && !isLeadMentor && !isCoreVolunteer) {
                return apiError("Forbidden: Not authorized to edit attendance", 403);
            }

            const { participantId, status, arrivedAt, departedAt } = body;

            if (!participantId || !status) {
                return apiError("Missing required fields", 400);
            }

            // Authz on the TARGET: the participant must be enrolled or volunteering
            // in this event's program. Without this a lead mentor could write a
            // presence record for anyone in the system (see attendance POST). A
            // program-less event is reachable only by admin/board (lead/core-vol
            // authz above requires a program), so there is no IDOR to guard there.
            const targetId = Number(participantId);
            if (event.programId != null) {
                const [enrolled, volunteering] = await Promise.all([
                    prisma.programParticipant.findFirst({ where: { programId: event.programId, personId: targetId }, select: { personId: true } }),
                    prisma.programVolunteer.findFirst({ where: { programId: event.programId, personId: targetId }, select: { personId: true } }),
                ]);
                if (!enrolled && !volunteering) {
                    return apiError("Participant is not enrolled or volunteering in this program", 400);
                }
            }

            if (status === 'Absent') {
                // An open visit (departedAt = null) means they physically scanned in
                // and are currently on-site. Deleting it would destroy the live
                // roster of who's in the building — reject instead.
                const openVisit = await prisma.visit.findFirst({
                    where: {
                        personId: Number(participantId),
                        associatedEventId: eventId,
                        departedAt: null
                    }
                });
                if (openVisit) {
                    return apiError("Participant is currently checked in — check them out before marking Absent", 400);
                }
                // Only closed visits remain; safe to remove on an Absent correction.
                await prisma.visit.deleteMany({
                    where: {
                        personId: Number(participantId),
                        associatedEventId: eventId
                    }
                });
            } else if (status === 'Present') {
                if (!arrivedAt) {
                    return apiError("Arrival time is required for Present status", 400);
                }

                const now = new Date();
                const ar = parseVisitTime(arrivedAt, "arrival", now);
                if (!ar.ok) return apiError(ar.error, 400);

                let dep: Date | null = null;
                if (departedAt) {
                    const dr = parseVisitTime(departedAt, "departure", now);
                    if (!dr.ok) return apiError(dr.error, 400);
                    if (!departureAfterArrival(ar.value, dr.value)) {
                        return apiError("Departure time must be after arrival time", 400);
                    }
                    dep = dr.value;
                }

                // Check if there is an existing visit
                const existingVisit = await prisma.visit.findFirst({
                    where: {
                        personId: Number(participantId),
                        associatedEventId: eventId
                    }
                });

                if (existingVisit) {
                    await prisma.visit.update({
                        where: { id: existingVisit.id },
                        data: {
                            arrivedAt: ar.value,
                            departedAt: dep,
                            arrivedVia: "WEB",
                            departedVia: departedAt ? "WEB" : null
                        }
                    });
                } else {
                    await prisma.visit.create({
                        data: {
                            personId: Number(participantId),
                            associatedEventId: eventId,
                            arrivedAt: ar.value,
                            departedAt: dep,
                            arrivedVia: "WEB",
                            departedVia: departedAt ? "WEB" : null
                        }
                    });
                }
            }

            return NextResponse.json({ success: true });
        }

        return apiError("Invalid action", 400);

    } catch (error: unknown) {
        logger.error("Failed to update event:", error);
        return apiError("Failed to update event", 500);
    }
});
