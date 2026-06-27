import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { lockProgramAndCheckCapacity, ProgramCapacityError } from "@/lib/program/capacity";

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

        // Capacity is counted under a row lock inside the enroll transaction
        // below, so no _count is fetched here.
        const currentProgram = await prisma.program.findUnique({
            where: { id: programId }
        });
        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = (session.user as { id: number }).id;
        const isSelfEnrollment = currentUserId === participantId;
        const isSysAdminOrBoard = (session.user as { sysadmin?: boolean, boardMember?: boolean })?.sysadmin || (session.user as { sysadmin?: boolean, boardMember?: boolean })?.boardMember;

        const participantData = await prisma.participant.findUnique({
            where: { id: participantId },
            select: { dob: true, householdId: true }
        });

        let isHouseholdLead = false;
        if (participantData?.householdId) {
            const leadRecord = await prisma.householdLead.findUnique({
                where: {
                    householdId_participantId: {
                        householdId: participantData.householdId,
                        participantId: currentUserId
                    }
                }
            });
            isHouseholdLead = !!leadRecord;
        }

        if (!isSelfEnrollment && !isSysAdminOrBoard && !isHouseholdLead) {
            return NextResponse.json({ error: "Forbidden: Not authorized to enroll this participant. Program leads cannot manually add participants." }, { status: 403 });
        }

        const override = body.override === true;

        if (!isSelfEnrollment && isSysAdminOrBoard && !override) {
             return NextResponse.json({ error: "This bypasses all payment. Are you sure?", requiresOverride: true }, { status: 400 });
        }

        // When true, capacity/enrollment-status/age limits apply (a board
        // override skips them). Capacity itself is re-checked under a row lock
        // inside the transaction below — the _count read above is racy.
        const enforceLimits = !override || (!isSysAdminOrBoard);

        // Validation Checks
        if (enforceLimits) {
            // Check Enrollment Status
            if (currentProgram.enrollmentStatus === 'CLOSED') {
                return NextResponse.json({ error: "Program enrollment is currently closed.", requiresOverride: true }, { status: 400 });
            }

            // Check Age
            if (currentProgram.minAge !== null || currentProgram.maxAge !== null) {
                if (!participantData?.dob) {
                    return NextResponse.json({ error: "Participant Date of Birth is missing.", requiresOverride: true }, { status: 400 });
                }
                const ageDifMs = Date.now() - new Date(participantData.dob).getTime();
                const ageDate = new Date(ageDifMs);
                const age = Math.abs(ageDate.getUTCFullYear() - 1970);
                if (currentProgram.minAge !== null && age < currentProgram.minAge) {
                    return NextResponse.json({ error: `Participant must be at least ${currentProgram.minAge} years old.`, requiresOverride: true }, { status: 400 });
                }
                if (currentProgram.maxAge !== null && age > currentProgram.maxAge) {
                    return NextResponse.json({ error: `Participant maximum age is ${currentProgram.maxAge} years old.`, requiresOverride: true }, { status: 400 });
                }
            }
        }

        const isFree = currentProgram.memberPriceCents === null && currentProgram.nonMemberPriceCents === null;
        
        // Default status is PENDING, unless board is bypassing or the program is free
        const initialStatus = ((isSysAdminOrBoard && override) || isFree) ? 'ACTIVE' : 'PENDING';

        const enrollment = await prisma.$transaction(async (tx) => {
            // Re-check capacity under a row lock right before insert, so
            // concurrent enrollers can't both pass a stale count and overfill.
            if (enforceLimits) {
                await lockProgramAndCheckCapacity(tx, programId, 1, currentProgram.maxParticipants);
            }
            return tx.programParticipant.create({
                data: {
                    programId,
                    participantId,
                    status: initialStatus
                }
            });
        });

        await prisma.auditLog.create({
            data: {
                actorId: currentUserId,
                action: 'CREATE',
                tableName: 'ProgramParticipant',
                affectedEntityId: participantId,
                secondaryAffectedEntity: programId,
                newData: JSON.stringify(enrollment)
            }
        });

        // Trigger notification
        await sendNotification(participantId, 'PROGRAM_ENROLLMENT', { programName: currentProgram.name });

        return NextResponse.json({ success: true, enrollment });
    } catch (error) {
        if (error instanceof ProgramCapacityError) {
            return NextResponse.json({ error: "Program has reached maximum capacity.", requiresOverride: true }, { status: 400 });
        }
        console.error("Enrollment creation error:", error);
        return NextResponse.json({ error: "Failed to enroll participant" }, { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

        const currentProgram = await prisma.program.findUnique({
            where: { id: programId }
        });

        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = (session.user as { id: number }).id;
        const isSelfRemoval = currentUserId === participantId;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = (session.user as { sysadmin?: boolean, boardMember?: boolean })?.sysadmin || (session.user as { sysadmin?: boolean, boardMember?: boolean })?.boardMember;

        if (!isSelfRemoval && !isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Not authorized to remove this participant" }, { status: 403 });
        }

        const enrollment = await prisma.programParticipant.delete({
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
                tableName: 'ProgramParticipant',
                affectedEntityId: participantId,
                secondaryAffectedEntity: programId,
                oldData: JSON.stringify(enrollment)
            }
        });

        return NextResponse.json({ success: true, enrollment });
    } catch (error) {
        console.error("Enrollment deletion error:", error);
        return NextResponse.json({ error: "Failed to remove participant" }, { status: 500 });
    }
}
