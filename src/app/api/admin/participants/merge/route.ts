import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export const POST = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async (req) => {
        try {
            const body = await req.json();
            const { keepId, mergeId } = body;

            if (!keepId || !mergeId || keepId === mergeId) {
                return NextResponse.json({ error: "Invalid participant IDs provided." }, { status: 400 });
            }

            const keepParticipant = await prisma.participant.findUnique({
                where: { id: keepId },
                include: {
                    programParticipants: true,
                    programVolunteers: true,
                    rsvps: true,
                    toolStatuses: true,
                    feePayments: true
                }
            });

            const mergeParticipant = await prisma.participant.findUnique({
                where: { id: mergeId },
                include: {
                    programParticipants: true,
                    programVolunteers: true,
                    rsvps: true,
                    toolStatuses: true,
                    feePayments: true,
                    householdLeads: true,
                    household: {
                        include: {
                            participants: true
                        }
                    }
                }
            });

            if (!keepParticipant || !mergeParticipant) {
                return NextResponse.json({ error: "Participant(s) not found." }, { status: 404 });
            }

            const isLead = mergeParticipant.householdLeads.length > 0;
            const householdOthersCount = mergeParticipant.household?.participants.filter(p => p.id !== mergeId).length || 0;

            if (isLead && householdOthersCount > 0) {
                return NextResponse.json({ error: "Cannot merge: the to-be-deleted participant is the lead of a household with other members." }, { status: 400 });
            }

            await prisma.$transaction(async (tx) => {
                const updates: any = {};
                const fields = ['googleId', 'email', 'phone', 'name', 'dob', 'homeAddress', 'image', 'lastWaiverSign', 'lastBackgroundCheck'];
                for (const field of fields) {
                    const keepVal = keepParticipant[field as keyof typeof keepParticipant];
                    const mergeVal = mergeParticipant[field as keyof typeof mergeParticipant];
                    if (!keepVal && mergeVal) {
                        updates[field] = mergeVal;
                    }
                }

                if (Object.keys(updates).length > 0) {
                    await tx.participant.update({
                        where: { id: keepId },
                        data: updates
                    });
                }

                await tx.visit.updateMany({
                    where: { participantId: mergeId },
                    data: { participantId: keepId }
                });

                // Instead of failing on unique constraints, we migrate manually:
                for (const pp of mergeParticipant.programParticipants) {
                    if (!keepParticipant.programParticipants.find(k => k.programId === pp.programId)) {
                        await tx.programParticipant.update({
                            where: { programId_participantId: { programId: pp.programId, participantId: mergeId } },
                            data: { participantId: keepId }
                        });
                    } else {
                        await tx.programParticipant.delete({
                            where: { programId_participantId: { programId: pp.programId, participantId: mergeId } }
                        });
                    }
                }

                for (const pv of mergeParticipant.programVolunteers) {
                    if (!keepParticipant.programVolunteers.find(k => k.programId === pv.programId)) {
                        await tx.programVolunteer.update({
                            where: { programId_participantId: { programId: pv.programId, participantId: mergeId } },
                            data: { participantId: keepId }
                        });
                    } else {
                        await tx.programVolunteer.delete({
                            where: { programId_participantId: { programId: pv.programId, participantId: mergeId } }
                        });
                    }
                }

                for (const rsvp of mergeParticipant.rsvps) {
                    if (!keepParticipant.rsvps.find(k => k.eventId === rsvp.eventId)) {
                        await tx.rSVP.update({
                            where: { eventId_participantId: { eventId: rsvp.eventId, participantId: mergeId } },
                            data: { participantId: keepId }
                        });
                    } else {
                        await tx.rSVP.delete({
                            where: { eventId_participantId: { eventId: rsvp.eventId, participantId: mergeId } }
                        });
                    }
                }

                for (const fee of mergeParticipant.feePayments) {
                    if (!keepParticipant.feePayments.find(k => k.feeId === fee.feeId)) {
                        await tx.feePayment.update({
                            where: { feeId_participantId: { feeId: fee.feeId, participantId: mergeId } },
                            data: { participantId: keepId }
                        });
                    } else {
                        await tx.feePayment.delete({
                            where: { feeId_participantId: { feeId: fee.feeId, participantId: mergeId } }
                        });
                    }
                }

                for (const tool of mergeParticipant.toolStatuses) {
                    if (!keepParticipant.toolStatuses.find(k => k.toolId === tool.toolId)) {
                        await tx.toolStatus.update({
                            where: { userId_toolId: { toolId: tool.toolId, userId: mergeId } },
                            data: { userId: keepId }
                        });
                    } else {
                        await tx.toolStatus.delete({
                            where: { userId_toolId: { toolId: tool.toolId, userId: mergeId } }
                        });
                    }
                }

                await tx.householdLead.deleteMany({
                    where: { participantId: mergeId }
                });

                await tx.participant.update({
                    where: { id: mergeId },
                    data: {
                        googleId: null,
                        email: `merged-${mergeId}@deleted.checkme.in`,
                        phone: null,
                        name: `${mergeParticipant.name || 'Unknown'} (Merged into ${keepId})`,
                        householdId: null,
                    }
                });
            });

            return NextResponse.json({ success: true });
        } catch (error: any) {
            console.error("Merge error:", error);
            return NextResponse.json({ error: error.message || "Failed to merge participants" }, { status: 500 });
        }
    }
);
