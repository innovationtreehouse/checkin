import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

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
                }
            }
        });

        if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

        return NextResponse.json(event);
    } catch (error: unknown) {
        const err = error as Error;
        return NextResponse.json({ error: err.message || "Failed to fetch event" }, { status: 500 });
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

        const user = session.user as unknown as { id: number; sysadmin?: boolean; boardMember?: boolean };
        const userId = user.id;
        const isSysAdminOrBoard = user?.sysadmin || user?.boardMember;
        const isLeadMentor = event.program?.leadMentorId === userId;
        const isCoreVolunteer = event.program?.volunteers.some(v => v.participantId === userId && v.isCore) || false;

        // Action: Confirm Attendance
        if (body.action === 'confirmAttendance') {
            if (!isSysAdminOrBoard && !isLeadMentor && !isCoreVolunteer) {
                return NextResponse.json({ error: "Forbidden: Not authorized to confirm attendance" }, { status: 403 });
            }

            const updatedEvent = await prisma.event.update({
                where: { id: eventId },
                data: { attendanceConfirmedAt: new Date() }
            });

            return NextResponse.json({ success: true, event: updatedEvent });
        }

        // Action: Edit / Cancel Time
        if (body.action === 'editTime' || body.action === 'cancel') {
            // Core volunteers can't edit or cancel events. Only lead mentors, sysadmin, board.
            if (!isSysAdminOrBoard && !isLeadMentor) {
                return NextResponse.json({ error: "Forbidden: Only Lead Mentors or Admins can edit/cancel events" }, { status: 403 });
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
                    // Cleanup RSVPs and Visits first to avoid foreign key constraints
                    await prisma.rSVP.deleteMany({ where: { eventId: { in: eventIds } } });
                    await prisma.visit.updateMany({ where: { associatedEventId: { in: eventIds } }, data: { associatedEventId: null } });
                    // Delete all future events in series
                    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
                    
                    return NextResponse.json({ success: true, count: futureEvents.length });
                } else if (body.action === 'editTime') {
                    for (const fe of futureEvents) {
                        await prisma.event.update({
                            where: { id: fe.id },
                            data: {
                                start: new Date(fe.start.getTime() + timeShiftStartMs),
                                end: new Date(fe.end.getTime() + timeShiftEndMs)
                            }
                        });
                    }
                    return NextResponse.json({ success: true, count: futureEvents.length });
                }
            } else {
                // Apply ONLY to this single event
                if (body.action === 'cancel') {
                    await prisma.rSVP.deleteMany({ where: { eventId: event.id } });
                    await prisma.visit.updateMany({ where: { associatedEventId: event.id }, data: { associatedEventId: null } });
                    await prisma.event.delete({ where: { id: event.id } });
                    return NextResponse.json({ success: true });
                } else if (body.action === 'editTime') {
                    const updatedEvent = await prisma.event.update({
                        where: { id: event.id },
                        data: {
                            start: start ? new Date(start) : event.start,
                            end: end ? new Date(end) : event.end
                        }
                    });
                    return NextResponse.json({ success: true, event: updatedEvent });
                }
            }
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });

    } catch (error: unknown) {
        const err = error as Error;
        return NextResponse.json({ error: err.message || "Failed to update event" }, { status: 500 });
    }
}
