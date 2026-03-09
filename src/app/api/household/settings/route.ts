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
        const { emergencyContactName, emergencyContactPhone, address } = body;

        const user = await prisma.participant.findUnique({
            where: { id: userId },
            include: { householdLeads: true }
        });

        if (!user || !user.householdId) {
            return NextResponse.json({ error: "Household not found" }, { status: 404 });
        }

        const isLead = user.householdLeads.some(lead => lead.householdId === user.householdId);
        if (!isLead && !user.sysadmin) {
            return NextResponse.json({ error: "Only household leads can edit household settings" }, { status: 403 });
        }

        const updatedHousehold = await prisma.household.update({
            where: { id: user.householdId },
            data: {
                emergencyContactName: emergencyContactName !== undefined ? emergencyContactName : undefined,
                emergencyContactPhone: emergencyContactPhone !== undefined ? emergencyContactPhone : undefined,
                address: address !== undefined ? address : undefined,
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "EDIT",
                tableName: "Household",
                affectedEntityId: user.householdId,
                newData: JSON.stringify({ emergencyContactName, emergencyContactPhone, address })
            }
        });

        return NextResponse.json({ household: updatedHousehold }, { status: 200 });

    } catch (error: unknown) {
        console.error("Household Settings PATCH Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
