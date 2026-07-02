import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";

export const dynamic = 'force-dynamic';

export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
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
                const updates: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
                const fields = ['googleId', 'email', 'phone', 'name', 'dateOfBirth', 'image', 'lastWaiverSign', 'lastBackgroundCheck'];
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

                const moved = {
                    visits: 0,
                    programParticipants: { migrated: 0, deleted: 0 },
                    programVolunteers: { migrated: 0, deleted: 0 },
                    rsvps: { migrated: 0, deleted: 0 },
                    feePayments: { migrated: 0, deleted: 0 },
                    toolStatuses: { migrated: 0, deleted: 0 },
                };

                moved.visits = (await tx.visit.updateMany({
                    where: { participantId: mergeId },
                    data: { participantId: keepId }
                })).count;

                // Instead of failing on unique constraints, we migrate manually:
                for (const pp of mergeParticipant.programParticipants) {
                    if (!keepParticipant.programParticipants.find(k => k.programId === pp.programId)) {
                        await tx.programParticipant.update({
                            where: { programId_participantId: { programId: pp.programId, participantId: mergeId } },
                            data: { participantId: keepId }
                        });
                        moved.programParticipants.migrated++;
                    } else {
                        await tx.programParticipant.delete({
                            where: { programId_participantId: { programId: pp.programId, participantId: mergeId } }
                        });
                        moved.programParticipants.deleted++;
                    }
                }

                for (const pv of mergeParticipant.programVolunteers) {
                    if (!keepParticipant.programVolunteers.find(k => k.programId === pv.programId)) {
                        await tx.programVolunteer.update({
                            where: { programId_participantId: { programId: pv.programId, participantId: mergeId } },
                            data: { participantId: keepId }
                        });
                        moved.programVolunteers.migrated++;
                    } else {
                        await tx.programVolunteer.delete({
                            where: { programId_participantId: { programId: pv.programId, participantId: mergeId } }
                        });
                        moved.programVolunteers.deleted++;
                    }
                }

                for (const rsvp of mergeParticipant.rsvps) {
                    if (!keepParticipant.rsvps.find(k => k.eventId === rsvp.eventId)) {
                        await tx.rSVP.update({
                            where: { eventId_personId: { eventId: rsvp.eventId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.rsvps.migrated++;
                    } else {
                        await tx.rSVP.delete({
                            where: { eventId_personId: { eventId: rsvp.eventId, personId: mergeId } }
                        });
                        moved.rsvps.deleted++;
                    }
                }

                for (const fee of mergeParticipant.feePayments) {
                    if (!keepParticipant.feePayments.find(k => k.feeId === fee.feeId)) {
                        await tx.feePayment.update({
                            where: { feeId_personId: { feeId: fee.feeId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.feePayments.migrated++;
                    } else {
                        await tx.feePayment.delete({
                            where: { feeId_personId: { feeId: fee.feeId, personId: mergeId } }
                        });
                        moved.feePayments.deleted++;
                    }
                }

                for (const tool of mergeParticipant.toolStatuses) {
                    if (!keepParticipant.toolStatuses.find(k => k.toolId === tool.toolId)) {
                        await tx.toolStatus.update({
                            where: { personId_toolId: { toolId: tool.toolId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.toolStatuses.migrated++;
                    } else {
                        await tx.toolStatus.delete({
                            where: { personId_toolId: { toolId: tool.toolId, personId: mergeId } }
                        });
                        moved.toolStatuses.deleted++;
                    }
                }

                await tx.householdLead.deleteMany({
                    where: { personId: mergeId }
                });

                // householdId stays pointing at the old household: every
                // participant must belong to a household, and merged-away
                // records are tombstoned rather than deleted.
                await tx.participant.update({
                    where: { id: mergeId },
                    data: {
                        googleId: null,
                        email: `merged-${mergeId}@deleted.checkme.in`,
                        phone: null,
                        name: `${mergeParticipant.name || 'Unknown'} (Merged into ${keepId})`,
                    }
                });

                // ponytail: audit only — undo is unimplemented; merge is still irreversible.
                if (auth.type === 'session') {
                    await tx.auditLog.create({
                        data: {
                            actorId: auth.user.id,
                            action: "DELETE",
                            tableName: "Participant",
                            affectedEntityId: keepId,
                            secondaryAffectedEntity: mergeId,
                            oldData: {
                                id: mergeParticipant.id,
                                name: mergeParticipant.name,
                                email: mergeParticipant.email,
                            },
                            newData: { keepId, moved },
                        }
                    });
                }
            });

            return NextResponse.json({ success: true });
        } catch (error: unknown) {
            await logBackendError(error, "POST /api/membership-ops/participants/merge");
            return NextResponse.json({ error: "Failed to merge participants" }, { status: 500 });
        }
    }
);
