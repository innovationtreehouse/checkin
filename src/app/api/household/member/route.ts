import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function PATCH(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as {id: number}).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as {id: number}).id;
        const body = await req.json();
        const { participantId, name, email, dob } = body;

        if (!participantId) {
            return NextResponse.json({ error: "Participant ID is required" }, { status: 400 });
        }

        const user = await prisma.participant.findUnique({ where: { id: userId }, include: { householdLeads: true } });

        if (!user?.householdId) {
            return NextResponse.json({ error: "You must create a household first" }, { status: 400 });
        }

        const isLead = user.householdLeads.some(lead => lead.householdId === user.householdId);
        if (!isLead && !user.sysadmin) {
            return NextResponse.json({ error: "Only household leads can edit members" }, { status: 403 });
        }

        const targetMember = await prisma.participant.findUnique({ where: { id: participantId } });
        if (!targetMember || targetMember.householdId !== user.householdId) {
            return NextResponse.json({ error: "Member not found in your household" }, { status: 404 });
        }

        const updatedMember = await prisma.participant.update({
            where: { id: participantId },
            data: {
                name: name !== undefined ? name : undefined,
                email: email !== undefined ? (email === "" ? null : email.toLowerCase()) : undefined,
                dob: dob !== undefined ? (dob === "" ? null : new Date(dob + "T12:00:00Z")) : undefined,
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "EDIT",
                tableName: "Participant",
                affectedEntityId: targetMember.id,
                newData: JSON.stringify(updatedMember)
            }
        });

        return NextResponse.json({ member: updatedMember, message: "Member updated successfully." }, { status: 200 });

    } catch (error: unknown) {
        console.error("Household Member PATCH Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
