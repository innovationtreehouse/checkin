import { NextRequest, NextResponse } from "next/server";
// In testing environment, use the mocked getServerSession from next-auth directly, but in Next 15 App router tests it can fail if called without a request. NextAuth is mocked in adminParticipants.test.ts, but we must use it from next-auth.
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    const user = session?.user as any;

    if (!user || (!user.sysadmin && !user.boardMember)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    try {
        const resolvedParams = await params;
        const id = parseInt(resolvedParams.id, 10);
        if (isNaN(id)) {
            return NextResponse.json({ error: "Invalid participant ID" }, { status: 400 });
        }

        const body = await request.json();
        
        // Build the update object with only provided fields
        const updateData: any = {};
        if (body.name !== undefined) updateData.name = body.name;
        if (body.email !== undefined) updateData.email = body.email;
        if (body.phone !== undefined) updateData.phone = body.phone;

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: "No fields to update provided" }, { status: 400 });
        }

        const updatedParticipant = await prisma.participant.update({
            where: { id },
            data: updateData,
            include: {
                household: true
            }
        });

        const formatted = {
            id: updatedParticipant.id,
            name: updatedParticipant.name,
            email: updatedParticipant.email,
            phone: updatedParticipant.phone,
            boardMember: updatedParticipant.boardMember,
            shopSteward: updatedParticipant.shopSteward,
            keyholder: updatedParticipant.keyholder,
            household: updatedParticipant.household,
        };

        return NextResponse.json({ participant: formatted });
    } catch (error) {
        console.error("Failed to update participant:", error);
        return NextResponse.json({ error: "Failed to update participant" }, { status: 500 });
    }
}
