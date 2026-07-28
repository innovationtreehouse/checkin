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
        const { publish } = body;

        if (publish !== true) {
            return apiError("publish must be true", 400);
        }

        const currentProgram = await prisma.program.findUnique({
            where: { id: programId },
            include: { events: true }
        });

        if (!currentProgram) {
            return apiError("Program not found", 404);
        }

        const currentUserId = auth.user.id;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;

        if (!isSysAdminOrBoard && !isLeadMentor) {
            return apiError("Forbidden: Not authorized to publish this program", 403);
        }

        if (publish) {
            // Publishing resets phase->UPCOMING, enrollment->OPEN. Only valid out of a
            // pre-launch phase (PLANNING/UPCOMING). Re-publishing a RUNNING or FINISHED
            // program would silently resurrect it — reject terminal/active phases.
            if (currentProgram.phase === 'RUNNING' || currentProgram.phase === 'FINISHED') {
                return apiError(`Cannot publish a program that is already ${currentProgram.phase.toLowerCase()}.`, 409);
            }
            // Validation rules for publishing
            if (!currentProgram.leadMentorId) {
                return apiError("Cannot publish a program without a Lead Mentor assigned", 400);
            }
            if (currentProgram.events.length === 0) {
                return apiError("Cannot publish a program without any scheduled events", 400);
            }
        }

        const updatedProgram = await prisma.program.update({
            where: { id: programId },
            data: { phase: 'UPCOMING', enrollmentStatus: 'OPEN' }
        });

        await prisma.auditLog.create({
            data: {
                actorId: currentUserId,
                action: 'EDIT',
                tableName: 'Program',
                affectedEntityId: programId,
                newData: { phase: 'UPCOMING', enrollmentStatus: 'OPEN' } as unknown as never
            }
        });

        return NextResponse.json({ success: true, program: updatedProgram });
    } catch (error) {
        logger.error("Program publish error:", error);
        return apiError("Failed to set publish state", 500);
    }
});
