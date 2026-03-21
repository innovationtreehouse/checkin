import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

        const program = await prisma.program.findUnique({
            where: { id: programId },
            include: {
                volunteers: {
                    include: { participant: true }
                },
                participants: {
                    include: {
                        participant: {
                            include: { household: true }
                        }
                    }
                },
                events: {
                    orderBy: {
                        start: 'asc'
                    }
                },
                fees: true
            }
        });

        if (!program) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        // Apply memberOnly visibility checks
        if (program.memberOnly) {
            let canSeeMemberOnly = false;
            
            // Check if user is lead mentor
            const isLeadMentor = session?.user && (session.user as unknown as { id: number }).id === program.leadMentorId;

            // Check if user is core volunteer
            const isCoreVolunteer = session?.user && program.volunteers.some(v => v.participantId === (session.user as unknown as { id: number }).id && v.isCore);

            if (session && session.user) {
                const user = session.user as unknown as { id: number; sysadmin?: boolean; boardMember?: boolean };
                if (user.sysadmin || user.boardMember || isLeadMentor || isCoreVolunteer) {
                    canSeeMemberOnly = true;
                } else {
                    const participant = await prisma.participant.findUnique({
                        where: { id: user.id },
                        include: {
                            memberships: {
                                where: { active: true }
                            }
                        }
                    });
                    if (participant && participant.memberships.length > 0) {
                        canSeeMemberOnly = true;
                    }
                }
            }

            if (!canSeeMemberOnly) {
                return NextResponse.json({ error: "Forbidden: Member-Only Program" }, { status: 403 });
            }
        }

        let leadMentor = null;
        if (program.leadMentorId) {
            leadMentor = await prisma.participant.findUnique({
                where: { id: program.leadMentorId },
                select: { id: true, name: true, email: true }
            });
        }
        const programWithMentor = { ...program, leadMentor };

        return NextResponse.json(programWithMentor);
    } catch (error) {
        console.error("Failed to fetch program:", error);
        return NextResponse.json({ error: "Failed to fetch program" }, { status: 500 });
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const user = session.user as unknown as { id: number; sysadmin?: boolean; boardMember?: boolean };
        const isLeadMentor = currentProgram.leadMentorId === user.id;
        const isSysAdminOrBoard = user.sysadmin || user.boardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Only Admin, Board Members, or Lead Mentors can edit" }, { status: 403 });
        }

        const body = await req.json();
        let { leadMentorId } = body;
        const { name, begin, end, memberOnly, phase, enrollmentStatus, minAge, maxAge, maxParticipants, leadMentorNotificationSettings } = body;

        if (body.hasOwnProperty('leadMentorId')) {
            if (!leadMentorId) {
                return NextResponse.json({ error: "Lead Mentor is required" }, { status: 400 });
            }
            leadMentorId = parseInt(leadMentorId);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {
            ...(name !== undefined && { name }),
            ...(leadMentorId !== undefined && { leadMentorId }),
            ...(begin !== undefined && { begin: begin ? new Date(begin) : null }),
            ...(end !== undefined && { end: end ? new Date(end) : null }),
            ...(memberOnly !== undefined && { memberOnly }),
            ...(phase !== undefined && { phase }),
            ...(enrollmentStatus !== undefined && { enrollmentStatus }),
            ...(minAge !== undefined && { minAge }),
            ...(maxAge !== undefined && { maxAge }),
            ...(maxParticipants !== undefined && { maxParticipants }),
            ...(leadMentorNotificationSettings !== undefined && { leadMentorNotificationSettings }),
        };

        const updatedProgram = await prisma.program.update({
            where: { id: programId },
            data: updateData
        });

        await prisma.auditLog.create({
            data: {
                actorId: (session.user as unknown as { id: number }).id,
                action: 'EDIT',
                tableName: 'Program',
                affectedEntityId: updatedProgram.id,
                oldData: JSON.stringify(currentProgram),
                newData: JSON.stringify(updatedProgram)
            }
        });

        return NextResponse.json({ success: true, program: updatedProgram });
    } catch (error) {
        console.error("Program update error:", error);
        return NextResponse.json({ error: "Failed to update program" }, { status: 500 });
    }
}
