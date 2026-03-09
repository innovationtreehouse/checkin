import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const user = session.user as any;
        if (!user.sysadmin && !user.boardMember) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const participantId = parseInt(id);
        if (isNaN(participantId)) {
            console.error(`Invalid participant ID from params: ${id}`);
            return NextResponse.json({ error: `Invalid participant ID: ${id}` }, { status: 400 });
        }

        const { householdId, createNew } = await req.json();

        if (!householdId && !createNew) {
            return NextResponse.json({ error: "Must provide either householdId or createNew boolean" }, { status: 400 });
        }

        const participant = await prisma.participant.findUnique({ where: { id: participantId } });
        if (!participant) {
            return NextResponse.json({ error: "Participant not found" }, { status: 404 });
        }

        let targetHouseholdId: number;

        if (createNew) {
            const newHousehold = await prisma.household.create({
                data: {
                    name: `${participant.name || 'User'}'s Household`,
                    leads: {
                        create: {
                            participantId: participant.id
                        }
                    }
                }
            });
            targetHouseholdId = newHousehold.id;

            await prisma.membership.create({
                data: {
                    householdId: targetHouseholdId,
                    type: 'HOUSEHOLD',
                    active: true,
                }
            });
        } else {
            targetHouseholdId = parseInt(householdId);
            if (isNaN(targetHouseholdId)) {
                return NextResponse.json({ error: "Invalid household ID" }, { status: 400 });
            }

            const household = await prisma.household.findUnique({ where: { id: targetHouseholdId } });
            if (!household) {
                return NextResponse.json({ error: "Household not found" }, { status: 404 });
            }
        }

        const updatedParticipant = await prisma.participant.update({
            where: { id: participantId },
            data: { householdId: targetHouseholdId },
            include: { household: true }
        });

        if (participant.householdId && participant.householdId !== targetHouseholdId) {
            await prisma.householdLead.deleteMany({
                where: {
                    participantId: participant.id,
                    householdId: participant.householdId
                }
            });
        }

        return NextResponse.json({ success: true, participant: updatedParticipant });
    } catch (error: any) {
        console.error("Error updating participant household:", error);
        return NextResponse.json({ error: `Internal server error: ${error.message}` }, { status: 500 });
    }
}
