import prisma from "@/lib/prisma";
import { handler, badRequest, forbidden, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/admin/roles', async () => {
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

    const participants = await prisma.participant.findMany({
        where: {
            OR: [
                { dob: { lte: eighteenYearsAgo } },
                { dob: null }
            ]
        },
        select: {
            id: true,
            email: true,
            name: true,
            sysadmin: true,
            boardMember: true,
            keyholder: true,
            shopSteward: true,
        },
        orderBy: { name: "asc" },
    });
    return { Participant: participants };
});

export const PATCH = handler('PATCH /api/admin/roles', async ({ req, auth }) => {
    const body = await req.json();
    const { targetUserId, ...roleUpdates } = body;

    if (!targetUserId) throw badRequest("Missing 'targetUserId'");

    if (auth.type !== 'session') throw unauthorized();

    // Board Members cannot modify sysadmin privileges
    if (!auth.user.sysadmin && roleUpdates.sysadmin !== undefined) {
        throw forbidden("Only Sysadmins can modify sysadmin privileges");
    }

    const allowedFields = ["sysadmin", "boardMember", "keyholder", "shopSteward"];
    const updateData: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
    for (const field of allowedFields) {
        if (roleUpdates[field] !== undefined) {
            updateData[field] = Boolean(roleUpdates[field]);
        }
    }

    if (Object.keys(updateData).length === 0) {
        throw badRequest("No valid role fields provided");
    }

    const updated = await prisma.participant.update({
        where: { id: targetUserId },
        data: updateData,
        select: {
            id: true,
            email: true,
            name: true,
            sysadmin: true,
            boardMember: true,
            keyholder: true,
            shopSteward: true,
        },
    });

    await prisma.auditLog.create({
        data: {
            actorId: auth.user.id,
            action: "EDIT",
            tableName: "Participant",
            affectedEntityId: targetUserId,
            newData: updateData,
        },
    });

    return { Participant: updated };
});
