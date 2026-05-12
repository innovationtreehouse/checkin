import prisma from "@/lib/prisma";
import { handler, badRequest, notFound, unauthorized } from "@/security/handler";

export const POST = handler<{ id: string }>('POST /api/programs/[id]/events', async ({ req, params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) {
        throw badRequest("Invalid program ID");
    }

    const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const body = await req.json();
    const { name, start, end, description } = body;

    if (!name || !start || !end) {
        throw badRequest("Event name, start, and end are required");
    }

    const newEvent = await prisma.event.create({
        data: {
            programId,
            name,
            start: new Date(start),
            end: new Date(end),
            description: description || null
        }
    });

    await prisma.auditLog.create({
        data: {
            actorId: auth.user.id,
            action: 'CREATE',
            tableName: 'Event',
            affectedEntityId: newEvent.id,
            newData: JSON.stringify(newEvent)
        }
    });

    return { Event: newEvent };
});
