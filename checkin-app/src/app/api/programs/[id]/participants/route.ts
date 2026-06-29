import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { lockProgramAndCheckCapacity, ProgramCapacityError } from "@/lib/program/capacity";
import { calculateAge } from "@/lib/time";

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

        // A board/sysadmin enrolling someone OUTSIDE their own household (the
        // program-ops surface) is a real admin comp: it skips payment. A board
        // member enrolling their own self/dependent through the public program
        // page is just a parent — they pay like anyone else. Without this, a
        // board parent got a confusing "bypasses all payment / Force Enroll"
        // prompt and a free enrollment instead of a Shopify checkout.
        const isExternalAdmin = isSysAdminOrBoard && !isSelfEnrollment && !isHouseholdLead;

        if (isExternalAdmin && !override) {
             return NextResponse.json({ error: "This bypasses all payment. Are you sure?", requiresOverride: true }, { status: 400 });
        }

        // ponytail: a confirmed board/sysadmin override INTENTIONALLY bypasses
        // every soft limit — closed enrollment, age, AND capacity — so the board
        // can deliberately overfill a program. This is intent, not a missing
        // guard: see the requiresOverride:true responses the UI turns into a
        // confirm button. Normal users always hit enforceLimits=true and cannot
        // overbook (capacity is locked under FOR UPDATE in the tx below; tested in
        // programsParticipantsConcurrency.integration.test.ts and the FULL-program
        // override test in programsParticipantsAPI.integration.test.ts). Do not
        // narrow this so it also gates normal users.
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
                // Age as of program start; now for dateless programs.
                const age = calculateAge(participantData.dob, currentProgram.begin ?? undefined);
                if (currentProgram.minAge !== null && age < currentProgram.minAge) {
                    return NextResponse.json({ error: `Participant must be at least ${currentProgram.minAge} years old.`, requiresOverride: true }, { status: 400 });
                }
                if (currentProgram.maxAge !== null && age > currentProgram.maxAge) {
                    return NextResponse.json({ error: `Participant maximum age is ${currentProgram.maxAge} years old.`, requiresOverride: true }, { status: 400 });
                }
            }
        }

        const isFree = currentProgram.memberPriceCents === null && currentProgram.nonMemberPriceCents === null;
        
        // PENDING (awaits payment) unless the program is free or an external
        // admin is comping it. A board parent overriding a soft limit for their
        // own household still pays — the override bypasses limits, not the fee.
        const initialStatus = ((isExternalAdmin && override) || isFree) ? 'ACTIVE' : 'PENDING';

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
        // P2002 = unique violation on the @@id([programId, participantId]) PK.
        // Benign double-submit (UI double-click) re-enrolls the same participant;
        // return 409 instead of a 500.
        if (isPrismaError(error, 'P2002')) {
            return NextResponse.json({ error: "Participant is already enrolled in this program." }, { status: 409 });
        }
        console.error("Enrollment creation error:", error);
        return NextResponse.json({ error: "Failed to enroll participant" }, { status: 500 });
    }
}

// Prisma known-request errors carry a string `code`. Duck-typed so we don't
// pull in the generated Prisma namespace just for one check.
function isPrismaError(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
        && (error as { code: unknown }).code === code;
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
        // P2025 = row to delete not found. Benign double-submit (participant
        // already un-enrolled); idempotent 200 instead of a 500.
        if (isPrismaError(error, 'P2025')) {
            return NextResponse.json({ success: true, idempotent: true });
        }
        console.error("Enrollment deletion error:", error);
        return NextResponse.json({ error: "Failed to remove participant" }, { status: 500 });
    }
}
