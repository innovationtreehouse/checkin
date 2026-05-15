import prisma from "@/lib/prisma";
import { handler, badRequest, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/admin/visits', async () => {
    const visits = await prisma.visit.findMany({
        take: 50,
        orderBy: { arrived: "desc" },
        include: {
            participant: {
                select: { email: true, name: true, sysadmin: true, keyholder: true },
            },
        },
    });
    return { Visit: visits };
});

export const PATCH = handler('PATCH /api/admin/visits', async ({ req, auth }) => {
    const { visitId, arrived, departed } = await req.json();

    if (!visitId) throw badRequest("visitId is required.");

    const updatedVisit = await prisma.visit.update({
        where: { id: visitId },
        data: {
            ...(arrived ? { arrived: new Date(arrived) } : {}),
            ...(departed ? { departed: new Date(departed) } : {}),
        },
    });

    // Log the manual edit in the audit trail
    if (auth.type !== 'session') throw unauthorized();
    await prisma.auditLog.create({
        data: {
            actorId: auth.user.id,
            action: "EDIT",
            tableName: "Visit",
            affectedEntityId: visitId,
            newData: JSON.parse(JSON.stringify(updatedVisit)),
        },
    });

    return { Visit: updatedVisit };
});
