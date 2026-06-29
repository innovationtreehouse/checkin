import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resolvedParams = await params;
    const eventId = parseInt(resolvedParams.id, 10);

    try {
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

        if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

        // Authorization: this response embeds full participant records (email, phone,
        // dob, googleId — including minors) for everyone enrolled in / RSVP'd to the
        // program. Restrict it to event staff, matching the PATCH handler below.
        // Without this gate any authenticated user could harvest roster PII by
        // enumerating sequential event IDs.
        const user = session.user as unknown as { id: number; isSysadmin?: boolean; isBoardMember?: boolean };
        const userId = user.id;
        const isSysAdminOrBoard = user?.isSysadmin || user?.isBoardMember;
        const isLeadMentor = event.program?.leadMentorId === userId;
        const isCoreVolunteer = event.program?.volunteers?.some(v => v.participantId === userId && v.isCore) || false;
        if (!isSysAdminOrBoard && !isLeadMentor && !isCoreVolunteer) {
            return NextResponse.json({ error: "Forbidden: Not authorized to view this event" }, { status: 403 });
        }

        return NextResponse.json(event);
    } catch (error: unknown) {
        console.error("Failed to fetch event:", error);
        return NextResponse.json({ error: "Failed to fetch event" }, { status: 500 });
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resolvedParams = await params;
    const eventId = parseInt(resolvedParams.id, 10);
    const body = await req.json();

    try {
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { program: { include: { volunteers: true } } }
        });

        if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

        const user = session.user as unknown as { id: number; isSysadmin?: boolean; isBoardMember?: boolean };
        const userId = user.id;
        const isSysAdminOrBoard = user?.isSysadmin || user?.isBoardMember;
        const isLeadMentor = event.program?.leadMentorId === userId;
        const isCoreVolunteer = event.program?.volunteers?.some(v => v.participantId === userId && v.isCore) || false;

        // Action: Confirm Attendance
        if (body.action === 'confirmAttendance') {
            if (!isSysAdminOrBoard && !isLeadMentor && !isCoreVolunteer) {
                return NextResponse.json({ error: "Forbidden: Not authorized to confirm attendance" }, { status: 403 });
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
                return NextResponse.json({ error: "Forbidden: Only Lead Mentors or Admins can edit/cancel events" }, { status: 403 });
            }

            // Block edits to an event that has already finished. Re-clearing
            // reminderSentAt on a past event is meaningless and would re-arm a
            // stale reminder; today only the cron's future-only window stops it
            // from firing. Use endAt (not startAt) so an in-progress event still edits.
            if (body.action === 'editTime' && event.endAt.getTime() < Date.now()) {
                return NextResponse.json({ error: "Cannot edit a past event" }, { status: 400 });
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

                    // Rescheduled to a new start → clear reminders for the shifted events
                    // so attendees get a fresh 2h reminder. End-only shifts keep state.
                    if (timeShiftStartMs !== 0) {
                        ops.push(prisma.rSVP.updateMany({
                            where: { eventId: { in: futureEvents.map(e => e.id) }, reminderSentAt: { not: null } },
                            data: { reminderSentAt: null }
                        }));
                    }

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
                    const startChanged = timeShiftStartMs !== 0;
                    const updatedEvent = await prisma.event.update({
                        where: { id: event.id },
                        data: {
                            startAt: startAt ? new Date(startAt) : event.startAt,
                            endAt: endAt ? new Date(endAt) : event.endAt
                        }
                    });
                    // Rescheduled to a new start → attendees become eligible for a fresh
                    // 2h reminder. End-only edits keep the existing reminder state.
                    if (startChanged) {
                        await prisma.rSVP.updateMany({
                            where: { eventId: event.id, reminderSentAt: { not: null } },
                            data: { reminderSentAt: null }
                        });
                    }
                    return NextResponse.json({ success: true, event: updatedEvent });
                }
            }
        }

        // Action: Manual Edit Attendance
        if (body.action === 'manualEditAttendance') {
            if (!isSysAdminOrBoard && !isLeadMentor && !isCoreVolunteer) {
                return NextResponse.json({ error: "Forbidden: Not authorized to edit attendance" }, { status: 403 });
            }

            const { participantId, status, arrivedAt, departedAt } = body;

            if (!participantId || !status) {
                return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
            }

            if (status === 'Absent') {
                // An open visit (departedAt = null) means they physically scanned in
                // and are currently on-site. Deleting it would destroy the live
                // roster of who's in the building — reject instead.
                const openVisit = await prisma.visit.findFirst({
                    where: {
                        participantId: Number(participantId),
                        associatedEventId: eventId,
                        departedAt: null
                    }
                });
                if (openVisit) {
                    return NextResponse.json({ error: "Participant is currently checked in — check them out before marking Absent" }, { status: 400 });
                }
                // Only closed visits remain; safe to remove on an Absent correction.
                await prisma.visit.deleteMany({
                    where: {
                        participantId: Number(participantId),
                        associatedEventId: eventId
                    }
                });
            } else if (status === 'Present') {
                if (!arrivedAt) {
                    return NextResponse.json({ error: "Arrival time is required for Present status" }, { status: 400 });
                }

                // Check if there is an existing visit
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
                            arrivedAt: new Date(arrivedAt),
                            departedAt: departedAt ? new Date(departedAt) : null,
                            arrivedVia: "WEB",
                            departedVia: departedAt ? "WEB" : null
                        }
                    });
                } else {
                    await prisma.visit.create({
                        data: {
                            participantId: Number(participantId),
                            associatedEventId: eventId,
                            arrivedAt: new Date(arrivedAt),
                            departedAt: departedAt ? new Date(departedAt) : null,
                            arrivedVia: "WEB",
                            departedVia: departedAt ? "WEB" : null
                        }
                    });
                }
            }

            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });

    } catch (error: unknown) {
        console.error("Failed to update event:", error);
        return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
    }
}
