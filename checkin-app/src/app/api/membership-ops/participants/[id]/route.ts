import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { isValidPhone, formatPhone, PHONE_ERROR } from "@/lib/phone";
import { apiError } from "@/lib/api-response";

export const PUT = withAuth<{ params: Promise<{ id: string }> }>(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (request: NextRequest, auth, { params }) => {
    if (auth.type !== 'session') {
        return apiError("Unauthorized", 401);
    }

    try {
        const resolvedParams = await params;
        const id = parseInt(resolvedParams.id, 10);
        if (isNaN(id)) {
            return apiError("Invalid participant ID", 400);
        }

        const body = await request.json();
        
        const updateData: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
        if (body.name !== undefined) updateData.name = body.name;
        if (body.email !== undefined) updateData.email = body.email;
        if (body.phone !== undefined) {
            if (body.phone !== "" && body.phone !== null && !isValidPhone(body.phone)) {
                return apiError(PHONE_ERROR, 400);
            }
            updateData.phone = body.phone === "" || body.phone === null ? null : formatPhone(body.phone);
        }
        if (body.isDeclaredAdult !== undefined) updateData.isDeclaredAdult = Boolean(body.isDeclaredAdult);

        if (Object.keys(updateData).length === 0) {
            return apiError("No fields to update provided", 400);
        }

        const prior = await prisma.person.findUnique({
            where: { id },
            select: { name: true, email: true, phone: true, isDeclaredAdult: true },
        });

        const updatedParticipant = await prisma.person.update({
            where: { id },
            data: updateData,
            include: {
                household: true
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: "EDIT",
                tableName: "Participant",
                affectedEntityId: id,
                oldData: prior ?? undefined,
                newData: updateData,
            },
        });

        const formatted = {
            id: updatedParticipant.id,
            name: updatedParticipant.name,
            email: updatedParticipant.email,
            phone: updatedParticipant.phone,
            dateOfBirth: updatedParticipant.dateOfBirth,
            isDeclaredAdult: updatedParticipant.isDeclaredAdult,
            isBoardMember: updatedParticipant.isBoardMember,
            isKeyholder: updatedParticipant.isKeyholder,
            household: updatedParticipant.household,
        };

        return NextResponse.json({ participant: formatted });
    } catch (error) {
        logger.error("Failed to update participant:", error);
        return apiError("Failed to update participant", 500);
    }
});
