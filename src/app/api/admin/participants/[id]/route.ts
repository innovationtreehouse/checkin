import prisma from "@/lib/prisma";
import { handler, badRequest } from "@/security/handler";

export const PUT = handler<{ id: string }>('PUT /api/admin/participants/[id]', async ({ req, params }) => {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) throw badRequest("Invalid participant ID");

    const body = await req.json();

    const updateData: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;

    if (Object.keys(updateData).length === 0) {
        throw badRequest("No fields to update provided");
    }

    const updatedParticipant = await prisma.participant.update({
        where: { id },
        data: updateData,
        include: {
            household: true
        }
    });

    return { Participant: updatedParticipant };
});
