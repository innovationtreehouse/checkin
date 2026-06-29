import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return NextResponse.json({ error: "Invalid program ID" }, { status: 400 });
        }

        const body = await req.json();
        const { participantId } = body;

        if (!participantId) {
            return NextResponse.json({ error: "participantId is required" }, { status: 400 });
        }

        const participant = await prisma.programParticipant.findUnique({
            where: {
                programId_participantId: {
                    programId,
                    participantId
                }
            },
            include: { participant: true, program: true }
        });

        if (!participant) {
            return NextResponse.json({ error: "Participant not found in program" }, { status: 404 });
        }

        // Authorization: only the participant themselves, a lead of their household,
        // the program's lead mentor, or a isSysadmin/board member may request a payment
        // plan for this enrollment. Without this gate any authenticated user could flip
        // isPaymentPlanRequested on an arbitrary participant's enrollment (IDOR).
        const currentUserId = (session.user as { id: number }).id;
        const isSelf = currentUserId === participantId;
        const isSysAdminOrBoard = (session.user as { isSysadmin?: boolean, isBoardMember?: boolean })?.isSysadmin
            || (session.user as { isSysadmin?: boolean, isBoardMember?: boolean })?.isBoardMember;
        const isLeadMentor = participant.program?.leadMentorId === currentUserId;

        let isHouseholdLead = false;
        if (!isSelf && !isSysAdminOrBoard && !isLeadMentor && participant.participant?.householdId) {
            const leadRecord = await prisma.householdLead.findUnique({
                where: {
                    householdId_participantId: {
                        householdId: participant.participant.householdId,
                        participantId: currentUserId
                    }
                }
            });
            isHouseholdLead = !!leadRecord;
        }

        if (!isSelf && !isSysAdminOrBoard && !isLeadMentor && !isHouseholdLead) {
            return NextResponse.json({ error: "Forbidden: Not authorized to request a payment plan for this participant" }, { status: 403 });
        }

        const updatedParticipant = await prisma.programParticipant.update({
            where: {
                programId_participantId: { programId, participantId }
            },
            data: {
                isPaymentPlanRequested: true
            }
        });

        // Send email to finances
        // In a real implementation this would trigger an actual email via SendGrid, NodeMailer, etc.
        console.log(`[EMAIL DISPATCH] To: finances@innovationtreehouse.org, Subject: Payment Plan Request for ${participant.participant?.name || 'User'} in ${participant.program?.name || 'Program'}`);

        return NextResponse.json({ success: true, participant: updatedParticipant });
    } catch (error) {
        console.error("Payment plan request error:", error);
        return NextResponse.json({ error: "Failed to request payment plan" }, { status: 500 });
    }
}
