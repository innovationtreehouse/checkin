import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { handler, notFound, forbidden, badRequest } from "@/security/handler";
import { isActiveMember } from "@/lib/membership";

export const GET = handler<{ id: string }>('GET /api/programs/[id]', async ({ auth, params }) => {
    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) throw badRequest('Invalid program ID');

    const program = await prisma.program.findUnique({
        where: { id: programId },
        include: {
            volunteers: { include: { participant: true } },
            participants: {
                include: {
                    participant: {
                        include: {
                            household: {
                                include: {
                                    emergencyContacts: {
                                        where: { conflictParticipantId: null, name: { not: "" }, phone: { not: "" } },
                                        orderBy: [{ priority: "asc" }, { id: "asc" }],
                                        select: { id: true, name: true, phone: true, relationship: true },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            events: { orderBy: { start: 'asc' } },
            fees: true,
            leadMentor: true,
        },
    });

    if (!program) throw notFound('Program not found');

    const isSessionUser = auth.type === 'session';
    const sessionUser = isSessionUser ? auth.user : undefined;
    const isSysAdminOrBoard = !!(sessionUser?.sysadmin || sessionUser?.boardMember);
    const isLeadMentor = !!sessionUser && sessionUser.id === program.leadMentorId;
    const isCoreVolunteer = !!sessionUser && program.volunteers.some(v => v.participantId === sessionUser.id && v.isCore);
    const isPrivileged = isSysAdminOrBoard || isLeadMentor || isCoreVolunteer;

    if (program.memberOnly && !isPrivileged) {
        if (!sessionUser) throw notFound('Program not found');
        const hasActiveMembership = await isActiveMember(sessionUser.id);
        if (!hasActiveMembership) throw forbidden('Forbidden: Member-Only Program');
    }

    return { Program: program };
});

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

        const updateData: Record<string, unknown> = {
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
