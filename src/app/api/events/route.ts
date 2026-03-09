import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";
import { addDays, parseISO, isBefore, isEqual, getDay, setHours, setMinutes } from 'date-fns';

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { name, description, programId, startDate, startTime, endTime, recurrence } = body;

        if (!name || !startDate || !startTime || !endTime) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const user = session.user as unknown as { id: number; sysadmin?: boolean; boardMember?: boolean };
        const isSysAdminOrBoard = user?.sysadmin || user?.boardMember;
        let isLeadMentor = false;

        if (programId) {
            const currentProgram = await prisma.program.findUnique({ where: { id: parseInt(programId, 10) } });
            if (currentProgram && currentProgram.leadMentorId === user.id) {
                isLeadMentor = true;
            }
        }

        if (!isSysAdminOrBoard && !isLeadMentor) {
            return NextResponse.json({ error: "Forbidden: Not authorized to create events" }, { status: 403 });
        }

        // Parse baseline dates
        const baseDateString = startDate.includes("T") ? startDate.split("T")[0] : startDate; // YYYY-MM-DD
        let currentIterDate = parseISO(baseDateString);

        const [startHr, startMin] = startTime.split(':').map(Number);
        const [endHr, endMin] = endTime.split(':').map(Number);

        const eventsToCreate = [];

        if (!recurrence || !recurrence.daysOfWeek || recurrence.daysOfWeek.length === 0 || !recurrence.until) {
            // Single event
            const startD = setMinutes(setHours(currentIterDate, startHr), startMin);
            const endD = setMinutes(setHours(currentIterDate, endHr), endMin);

            eventsToCreate.push({
                name,
                description: description || null,
                programId: programId ? parseInt(programId, 10) : null,
                start: startD,
                end: endD
            });
        } else {
            // Recurring events
            const untilDate = parseISO(recurrence.until.includes("T") ? recurrence.until.split("T")[0] : recurrence.until);
            // Limit recurrence to 365 days maximum to prevent infinite loop errors
            let loopGuard = 0;
            const recurringGroupId = crypto.randomUUID();

            while ((isBefore(currentIterDate, untilDate) || isEqual(currentIterDate, untilDate)) && loopGuard < 365) {
                const dayOfWeek = getDay(currentIterDate); // 0 = Sun, 1 = Mon ...

                if (recurrence.daysOfWeek.includes(dayOfWeek)) {
                    const startD = setMinutes(setHours(currentIterDate, startHr), startMin);
                    const endD = setMinutes(setHours(currentIterDate, endHr), endMin);

                    eventsToCreate.push({
                        name,
                        description: description || null,
                        programId: programId ? parseInt(programId, 10) : null,
                        start: startD,
                        end: endD,
                        recurringGroupId
                    });
                }

                currentIterDate = addDays(currentIterDate, 1);
                loopGuard++;
            }
        }

        if (eventsToCreate.length === 0) {
            return NextResponse.json({ error: "No events generated from constraints." }, { status: 400 });
        }

        const insertedEvents = await prisma.event.createMany({
            data: eventsToCreate
        });

        // We don't individually audit log massive lists in bulk.
        // We log the action summary.
        await prisma.auditLog.create({
            data: {
                actorId: user.id,
                action: 'CREATE',
                tableName: 'Event',
                affectedEntityId: programId ? parseInt(programId) : 0,
                newData: JSON.stringify({ count: insertedEvents.count, sample: eventsToCreate[0] })
            }
        });

        return NextResponse.json({ success: true, count: insertedEvents.count });
    } catch (error: unknown) {
        console.error("Event creation error:", error);
        const err = error as Error;
        return NextResponse.json({ error: err.message || "Failed to create event(s)" }, { status: 500 });
    }
}
