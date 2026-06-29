import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateRequest } from "@/lib/auth";
import { isValidPhone, PHONE_ERROR } from "@/lib/phone";

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await authenticateRequest(request);
    if (auth.type !== 'session') {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!auth.user.sysadmin && !auth.user.boardMember) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const resolvedParams = await params;
        const id = parseInt(resolvedParams.id, 10);
        if (isNaN(id)) {
            return NextResponse.json({ error: "Invalid participant ID" }, { status: 400 });
        }

        const body = await request.json();
        
        const updateData: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
        if (body.name !== undefined) updateData.name = body.name;
        if (body.email !== undefined) updateData.email = body.email;
        if (body.phone !== undefined) {
            if (body.phone !== "" && body.phone !== null && !isValidPhone(body.phone)) {
                return NextResponse.json({ error: PHONE_ERROR }, { status: 400 });
            }
            updateData.phone = body.phone;
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: "No fields to update provided" }, { status: 400 });
        }

        const prior = await prisma.participant.findUnique({
            where: { id },
            select: { name: true, email: true, phone: true },
        });

        const updatedParticipant = await prisma.participant.update({
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
            boardMember: updatedParticipant.boardMember,
            keyholder: updatedParticipant.keyholder,
            household: updatedParticipant.household,
        };

        return NextResponse.json({ participant: formatted });
    } catch (error) {
        console.error("Failed to update participant:", error);
        return NextResponse.json({ error: "Failed to update participant" }, { status: 500 });
    }
}
