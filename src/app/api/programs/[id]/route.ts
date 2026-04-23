import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

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

        const sessionUser = session?.user as unknown as { id: number; sysadmin?: boolean; boardMember?: boolean } | undefined;
        const isSysAdminOrBoard = !!(sessionUser?.sysadmin || sessionUser?.boardMember);
        const isLeadMentor = !!sessionUser && sessionUser.id === program.leadMentorId;
        const isCoreVolunteer = !!sessionUser && program.volunteers.some(v => v.participantId === sessionUser.id && v.isCore);
        const isPrivileged = isSysAdminOrBoard || isLeadMentor || isCoreVolunteer;

        if (program.memberOnly && !isPrivileged) {
            // Unauthenticated callers: return 404 to avoid existence disclosure
            if (!sessionUser) {
                return NextResponse.json({ error: "Program not found" }, { status: 404 });
            }
            const participant = await prisma.participant.findUnique({
                where: { id: sessionUser.id },
                include: { memberships: { where: { active: true } } }
            });
            const hasActiveMembership = !!(participant && participant.memberships.length > 0);
            if (!hasActiveMembership) {
                return NextResponse.json({ error: "Forbidden: Member-Only Program" }, { status: 403 });
            }
        }

        const leadMentorFull = program.leadMentorId
            ? await prisma.participant.findUnique({
                where: { id: program.leadMentorId },
                select: { id: true, name: true, email: true }
            })
            : null;

        if (isPrivileged) {
            return NextResponse.json({ ...program, leadMentor: leadMentorFull });
        }

        const publicShape = {
            id: program.id,
            name: program.name,
            leadMentorId: program.leadMentorId,
            begin: program.begin,
            end: program.end,
            phase: program.phase,
            enrollmentStatus: program.enrollmentStatus,
            memberOnly: program.memberOnly,
            minAge: program.minAge,
            maxAge: program.maxAge,
            maxParticipants: program.maxParticipants,
            memberPrice: program.memberPrice,
            nonMemberPrice: program.nonMemberPrice,
            shopifyProductId: program.shopifyProductId,
            shopifyMemberVariantId: program.shopifyMemberVariantId,
            shopifyNonMemberVariantId: program.shopifyNonMemberVariantId,
            leadMentor: leadMentorFull ? { id: leadMentorFull.id, name: leadMentorFull.name } : null,
            participants: program.participants.map(p => ({
                participantId: p.participantId,
                status: p.status,
            })),
            fees: program.fees,
            _count: {
                participants: program.participants.length,
                volunteers: program.volunteers.length,
            },
        };

        return NextResponse.json(publicShape);
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
