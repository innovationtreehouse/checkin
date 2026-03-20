import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { sendNotification } from "@/lib/notifications";

export async function POST(req: Request, { params }: { params: Promise<{ id: string, participantId: string }> }) {
    const { id, participantId } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const programId = parseInt(id, 10);
        const partId = parseInt(participantId, 10);
        
        if (isNaN(programId) || isNaN(partId)) {
            return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
        }

        const currentProgram = await prisma.program.findUnique({
            where: { id: programId }
        });

        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = (session.user as { id: number }).id;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = (session.user as { sysadmin?: boolean, boardMember?: boolean })?.sysadmin || (session.user as { sysadmin?: boolean, boardMember?: boolean })?.boardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Not authorized to offer spots" }, { status: 403 });
        }

        const currentEnrollment = await prisma.programParticipant.findUnique({
            where: {
                programId_participantId: {
                    programId,
                    participantId: partId
                }
            },
            include: {
                participant: {
                    include: {
                        household: {
                            include: {
                                leads: true
                            }
                        }
                    }
                }
            }
        });

        if (!currentEnrollment || (currentEnrollment.status as string) !== 'WAITLISTED') {
            return NextResponse.json({ error: "Participant is not waitlisted for this program." }, { status: 400 });
        }

        const updatedEnrollment = await prisma.programParticipant.update({
            where: {
                programId_participantId: {
                    programId,
                    participantId: partId
                }
            },
            data: {
                status: 'OFFERED' as any
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: currentUserId,
                action: 'EDIT',
                tableName: 'ProgramParticipant',
                affectedEntityId: partId,
                secondaryAffectedEntity: programId,
                oldData: JSON.stringify({ status: 'WAITLISTED' }),
                newData: JSON.stringify(updatedEnrollment)
            }
        });

        // Notify Household Leads
        const leads = currentEnrollment.participant.household?.leads;
        if (leads && leads.length > 0) {
            for (const lead of leads) {
                await sendNotification(lead.participantId, 'WAITLIST_OFFER', { 
                    programName: currentProgram.name,
                    programId: currentProgram.id,
                    participantName: currentEnrollment.participant.name || 'Unnamed'
                });
            }
        } else {
            // Unlikely, but fallback to the participant themselves if no household leads
            await sendNotification(partId, 'WAITLIST_OFFER', { 
                programName: currentProgram.name,
                programId: currentProgram.id,
                participantName: currentEnrollment.participant.name || 'Unnamed'
            });
        }

        return NextResponse.json({ success: true, enrollment: updatedEnrollment });
    } catch (error) {
        console.error("Offer spot error:", error);
        return NextResponse.json({ error: "Failed to offer spot" }, { status: 500 });
    }
}
