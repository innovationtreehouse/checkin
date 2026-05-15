import prisma from "@/lib/prisma";
import { handler, badRequest, notFound } from "@/security/handler";

export const GET = handler<{ id: string }>('GET /api/programs/[id]/eligible-participants', async ({ req, params }) => {
    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) {
        throw badRequest("Invalid program ID");
    }

    const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const q = new URL(req.url).searchParams.get("q") || "";

    const andClauses: Record<string, unknown>[] = [
        {
            NOT: {
                OR: [
                    { programParticipants: { some: { programId } } },
                    { programVolunteers: { some: { programId } } }
                ]
            }
        }
    ];

    if (q) {
        andClauses.push({
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } }
            ]
        });
    }

    if (currentProgram.memberOnly) {
        andClauses.push({
            OR: [
                { memberships: { some: { active: true } } },
                { household: { memberships: { some: { active: true } } } }
            ]
        });
    }

    const members = await prisma.participant.findMany({
        where: andClauses.length > 0 ? { AND: andClauses } : undefined,
        select: { id: true, name: true, email: true, dob: true, householdId: true },
        orderBy: { name: 'asc' },
        take: 50
    });

    return { Participant: members };
});
