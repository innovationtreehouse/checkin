import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";

export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user as { sysadmin?: boolean, boardMember?: boolean };
    
    // Explicitly require Board Member (or sysadmin with self-attestation handled on front-end)
    if (!user.boardMember && !user.sysadmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const requests = await prisma.programParticipant.findMany({
            where: {
                paymentPlanRequested: true,
                status: 'PENDING'
            },
            include: {
                participant: true,
                program: true
            },
            orderBy: {
                pendingSince: 'asc'
            }
        });

        return NextResponse.json(requests);
    } catch (error) {
        console.error("Failed to fetch payment plan requests:", error);
        return NextResponse.json({ error: "Failed to fetch payment plan requests" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user as { sysadmin?: boolean, boardMember?: boolean };
    
    if (!user.boardMember && !user.sysadmin) {
        return NextResponse.json({ error: "Forbidden: Only Board Members can approve payment plans." }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { programId, participantId } = body;

        const updated = await prisma.programParticipant.update({
            where: {
                programId_participantId: {
                    programId: parseInt(programId, 10),
                    participantId: parseInt(participantId, 10)
                }
            },
            data: {
                status: 'ACTIVE',
                paymentPlanRequested: false, // cleared since it's approved
                pendingSince: null // reset
            }
        });

        return NextResponse.json({ success: true, participant: updated });
    } catch (error) {
        console.error("Failed to approve payment plan:", error);
        return NextResponse.json({ error: "Failed to approve payment plan" }, { status: 500 });
    }
}
