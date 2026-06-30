import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const POST = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return NextResponse.json({ error: "Invalid program ID" }, { status: 400 });
        }

        const body = await req.json();
        const { participantId } = body;

        if (!participantId || typeof participantId !== 'number') {
            return NextResponse.json({ error: "participantId is required" }, { status: 400 });
        }

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = auth.user.id;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Not authorized to assign volunteers" }, { status: 403 });
        }

        // ponytail: no eligibility gate (age/membership) on volunteers — they're
        // staff/mentors, not enrollees. ProgramVolunteer has only isCore; any
        // participant is assignable. Add a gate here only if product asks for one.
        const assignment = await prisma.programVolunteer.create({
            data: {
                programId,
                participantId,
                isCore: false
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: currentUserId,
                action: 'CREATE',
                tableName: 'ProgramVolunteer',
                affectedEntityId: participantId,
                secondaryAffectedEntity: programId,
                newData: JSON.stringify(assignment)
            }
        });

        return NextResponse.json({ success: true, assignment });
    } catch (error) {
        // P2002 = unique violation on @@id([programId, participantId]). Benign
        // double-submit re-assigns the same volunteer; 409 instead of 500.
        if (isPrismaError(error, 'P2002')) {
            return NextResponse.json({ error: "Participant is already a volunteer for this program." }, { status: 409 });
        }
        // P2003 = FK violation: participantId points at no Participant row. Bad
        // input, not a server fault; 400 instead of 500.
        if (isPrismaError(error, 'P2003')) {
            return NextResponse.json({ error: "Participant not found" }, { status: 400 });
        }
        console.error("Volunteer assignment error:", error);
        return NextResponse.json({ error: "Failed to assign volunteer" }, { status: 500 });
    }
});

// Prisma known-request errors carry a string `code`. Duck-typed so we don't
// pull in the generated Prisma namespace just for one check.
function isPrismaError(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
        && (error as { code: unknown }).code === code;
}

export const DELETE = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

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

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = auth.user.id;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Not authorized to remove volunteers" }, { status: 403 });
        }

        const assignment = await prisma.programVolunteer.delete({
            where: {
                programId_participantId: {
                    programId,
                    participantId
                }
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: currentUserId,
                action: 'DELETE',
                tableName: 'ProgramVolunteer',
                affectedEntityId: participantId,
                secondaryAffectedEntity: programId,
                oldData: JSON.stringify(assignment)
            }
        });

        return NextResponse.json({ success: true, assignment });
    } catch (error) {
        console.error("Volunteer removal error:", error);
        return NextResponse.json({ error: "Failed to remove volunteer" }, { status: 500 });
    }
});

export const PATCH = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return NextResponse.json({ error: "Invalid program ID" }, { status: 400 });
        }

        const body = await req.json();
        const { participantId, isCore } = body;

        if (!participantId || isCore === undefined) {
            return NextResponse.json({ error: "participantId and isCore are required" }, { status: 400 });
        }

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = auth.user.id;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Not authorized to modify volunteers" }, { status: 403 });
        }

        const assignment = await prisma.programVolunteer.update({
            where: {
                programId_participantId: {
                    programId,
                    participantId
                }
            },
            data: {
                isCore
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: currentUserId,
                action: 'EDIT',
                tableName: 'ProgramVolunteer',
                affectedEntityId: participantId,
                secondaryAffectedEntity: programId,
                newData: JSON.stringify(assignment)
            }
        });

        return NextResponse.json({ success: true, assignment });
    } catch (error) {
        console.error("Volunteer toggle error:", error);
        return NextResponse.json({ error: "Failed to toggle volunteer" }, { status: 500 });
    }
});
