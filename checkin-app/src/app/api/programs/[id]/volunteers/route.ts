import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";

export const POST = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return apiError("Invalid program ID", 400);
        }

        const body = await req.json();
        const { participantId } = body;

        if (!participantId || typeof participantId !== 'number') {
            return apiError("participantId is required", 400);
        }

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return apiError("Program not found", 404);
        }

        const currentUserId = auth.user.id;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return apiError("Forbidden: Not authorized to assign volunteers", 403);
        }

        // ponytail: no eligibility gate (age/membership) on volunteers — they're
        // volunteers/program leaders, not enrollees. ProgramVolunteer has only isCore; any
        // participant is assignable. Add a gate here only if product asks for one.
        const assignment = await prisma.programVolunteer.create({
            data: {
                programId,
                personId: participantId,
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
                newData: assignment
            }
        });

        return NextResponse.json({ success: true, assignment });
    } catch (error) {
        // P2002 = unique violation on @@id([programId, participantId]). Benign
        // double-submit re-assigns the same volunteer; 409 instead of 500.
        if (isPrismaError(error, 'P2002')) {
            return apiError("Participant is already a volunteer for this program.", 409);
        }
        // P2003 = FK violation: participantId points at no Participant row. Bad
        // input, not a server fault; 400 instead of 500.
        if (isPrismaError(error, 'P2003')) {
            return apiError("Participant not found", 400);
        }
        logger.error("Volunteer assignment error:", error);
        return apiError("Failed to assign volunteer", 500);
    }
});

// Prisma known-request errors carry a string `code`. Duck-typed so we don't
// pull in the generated Prisma namespace just for one check.
function isPrismaError(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
        && (error as { code: unknown }).code === code;
}

export const DELETE = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return apiError("Invalid program ID", 400);
        }

        const body = await req.json();
        const { participantId } = body;

        if (!participantId) {
            return apiError("participantId is required", 400);
        }

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return apiError("Program not found", 404);
        }

        const currentUserId = auth.user.id;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return apiError("Forbidden: Not authorized to remove volunteers", 403);
        }

        const assignment = await prisma.programVolunteer.delete({
            where: {
                programId_personId: {
                    programId,
                    personId: participantId
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
                oldData: assignment
            }
        });

        return NextResponse.json({ success: true, assignment });
    } catch (error) {
        logger.error("Volunteer removal error:", error);
        return apiError("Failed to remove volunteer", 500);
    }
});

export const PATCH = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return apiError("Invalid program ID", 400);
        }

        const body = await req.json();
        const { participantId, isCore } = body;

        if (!participantId || isCore === undefined) {
            return apiError("participantId and isCore are required", 400);
        }

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return apiError("Program not found", 404);
        }

        const currentUserId = auth.user.id;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return apiError("Forbidden: Not authorized to modify volunteers", 403);
        }

        const assignment = await prisma.programVolunteer.update({
            where: {
                programId_personId: {
                    programId,
                    personId: participantId
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
                newData: assignment
            }
        });

        return NextResponse.json({ success: true, assignment });
    } catch (error) {
        logger.error("Volunteer toggle error:", error);
        return apiError("Failed to toggle volunteer", 500);
    }
});
