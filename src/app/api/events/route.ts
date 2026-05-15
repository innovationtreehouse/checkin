import prisma from "@/lib/prisma";
import { addDays, parseISO, isBefore, isEqual, getDay, setHours, setMinutes } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { handler, badRequest, forbidden, unauthorized } from "@/security/handler";

export const POST = handler('POST /api/events', async ({ req, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const body = await req.json();
    const { name, description, programId, startDate, startTime, endTime, recurrence } = body;

    if (!name || !startDate || !startTime || !endTime) {
        throw badRequest("Missing required fields");
    }

    const user = auth.user;
    const isSysAdminOrBoard = user.sysadmin || user.boardMember;
    let isLeadMentor = false;

    if (programId) {
        const currentProgram = await prisma.program.findUnique({ where: { id: parseInt(programId, 10) } });
        if (currentProgram && currentProgram.leadMentorId === user.id) {
            isLeadMentor = true;
        }
    }

    if (!isSysAdminOrBoard && !isLeadMentor) {
        throw forbidden("Forbidden: Not authorized to create events");
    }

    const baseDateString = startDate.includes("T") ? startDate.split("T")[0] : startDate;

    let currentIterDate = parseISO(baseDateString);

    const [startHr, startMin] = startTime.split(':').map(Number);
    const [endHr, endMin] = endTime.split(':').map(Number);

    const eventsToCreate = [];

    if (!recurrence || !recurrence.daysOfWeek || recurrence.daysOfWeek.length === 0 || !recurrence.until) {
        const startLocal = setMinutes(setHours(currentIterDate, startHr), startMin);
        const endLocal = setMinutes(setHours(currentIterDate, endHr), endMin);

        const startD = fromZonedTime(startLocal, 'America/Chicago');
        const endD = fromZonedTime(endLocal, 'America/Chicago');

        eventsToCreate.push({
            name,
            description: description || null,
            programId: programId ? parseInt(programId, 10) : null,
            start: startD,
            end: endD
        });
    } else {
        const untilDate = parseISO(recurrence.until.includes("T") ? recurrence.until.split("T")[0] : recurrence.until);
        let loopGuard = 0;
        const recurringGroupId = crypto.randomUUID();

        while ((isBefore(currentIterDate, untilDate) || isEqual(currentIterDate, untilDate)) && loopGuard < 365) {
            const dayOfWeek = getDay(currentIterDate);

            if (recurrence.daysOfWeek.includes(dayOfWeek)) {
                const startLocal = setMinutes(setHours(currentIterDate, startHr), startMin);
                const endLocal = setMinutes(setHours(currentIterDate, endHr), endMin);

                const startD = fromZonedTime(startLocal, 'America/Chicago');
                const endD = fromZonedTime(endLocal, 'America/Chicago');

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
        throw badRequest("No events generated from constraints.");
    }

    const insertedEvents = await prisma.event.createMany({
        data: eventsToCreate
    });

    await prisma.auditLog.create({
        data: {
            actorId: user.id,
            action: 'CREATE',
            tableName: 'Event',
            affectedEntityId: programId ? parseInt(programId) : 0,
            newData: JSON.stringify({ count: insertedEvents.count, sample: eventsToCreate[0] })
        }
    });

    return { count: insertedEvents.count };
});
