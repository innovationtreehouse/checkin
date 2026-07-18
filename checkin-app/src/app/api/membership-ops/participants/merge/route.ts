import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

export const dynamic = 'force-dynamic';

export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const body = await req.json();
            const { keepId, mergeId } = body;

            if (!keepId || !mergeId || keepId === mergeId) {
                return apiError("Invalid participant IDs provided.", 400);
            }

            const keepParticipant = await prisma.person.findUnique({
                where: { id: keepId },
                include: {
                    programParticipants: true,
                    programVolunteers: true,
                    rsvps: true,
                    toolStatuses: true,
                    feePayments: true
                }
            });

            const mergeParticipant = await prisma.person.findUnique({
                where: { id: mergeId },
                include: {
                    programParticipants: true,
                    programVolunteers: true,
                    rsvps: true,
                    toolStatuses: true,
                    feePayments: true,
                    household: {
                        include: {
                            householdMembers: true
                        }
                    }
                }
            });

            if (!keepParticipant || !mergeParticipant) {
                return apiError("Participant(s) not found.", 404);
            }

            const isLead = mergeParticipant.isHouseholdLead;
            const householdOthersCount = mergeParticipant.household?.householdMembers.filter(p => p.id !== mergeId).length || 0;

            if (isLead && householdOthersCount > 0) {
                return apiError("Cannot merge: the to-be-deleted participant is the lead of a household with other members.", 400);
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

                // Clear the merged person's unique identity fields FIRST, before
                // backfilling those same values onto the keeper below. Postgres
                // checks non-deferrable unique constraints per-statement, so
                // clearing mergeId's googleId/email in this statement means the
                // keeper's backfill statement (same values, captured pre-tx) no
                // longer collides with it. Reordering these two was the fix for
                // the P2002 that produced the prod 500 (a1).
                //
                // householdId stays pointing at the old household: every
                // participant must belong to a household, and merged-away
                // records are tombstoned rather than deleted. Leadership is
                // cleared (a1): the tombstone is no longer a lead of anything.
                await tx.person.update({
                    where: { id: mergeId },
                    data: {
                        googleId: null,
                        email: `merged-${mergeId}@deleted.checkme.in`,
                        phone: null,
                        name: `${mergeParticipant.name || 'Unknown'} (Merged into ${keepId})`,
                        isHouseholdLead: false,
                    }
                });

                if (Object.keys(updates).length > 0) {
                    await tx.person.update({
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
                    where: { personId: mergeId },
                    data: { personId: keepId }
                })).count;

                // Instead of failing on unique constraints, we migrate manually:
                for (const pp of mergeParticipant.programParticipants) {
                    if (!keepParticipant.programParticipants.find(k => k.programId === pp.programId)) {
                        await tx.programParticipant.update({
                            where: { programId_personId: { programId: pp.programId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.programParticipants.migrated++;
                    } else {
                        await tx.programParticipant.delete({
                            where: { programId_personId: { programId: pp.programId, personId: mergeId } }
                        });
                        moved.programParticipants.deleted++;
                    }
                }

                for (const pv of mergeParticipant.programVolunteers) {
                    if (!keepParticipant.programVolunteers.find(k => k.programId === pv.programId)) {
                        await tx.programVolunteer.update({
                            where: { programId_personId: { programId: pv.programId, personId: mergeId } },
                            data: { personId: keepId }
                        });
                        moved.programVolunteers.migrated++;
                    } else {
                        await tx.programVolunteer.delete({
                            where: { programId_personId: { programId: pv.programId, personId: mergeId } }
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

                // ponytail: audit only — undo is unimplemented; merge is still irreversible.
                if (auth.type === 'session') {
                    await tx.auditLog.create({
                        data: {
                            actorId: auth.user.id,
                            action: "DELETE",
                            tableName: "Person",
                            affectedEntityId: keepId,
                            secondaryAffectedEntity: mergeId,
                            // Full pre-image of every field the merge rewrites (tombstone)
                            // or moves (backfill) on the merged-away Person, captured
                            // before either update ran.
                            oldData: {
                                id: mergeParticipant.id,
                                googleId: mergeParticipant.googleId,
                                email: mergeParticipant.email,
                                phone: mergeParticipant.phone,
                                name: mergeParticipant.name,
                                dateOfBirth: mergeParticipant.dateOfBirth,
                                image: mergeParticipant.image,
                                lastWaiverSign: mergeParticipant.lastWaiverSign,
                                lastBackgroundCheck: mergeParticipant.lastBackgroundCheck,
                                isHouseholdLead: mergeParticipant.isHouseholdLead,
                                householdId: mergeParticipant.householdId,
                            },
                            newData: { keepId, moved },
                        }
                    });
                }
            });

            return NextResponse.json({ success: true });
        } catch (error: unknown) {
            const field = prismaUniqueConflictField(error);
            if (field) {
                const label = field === 'googleId' ? 'the Google identity'
                    : field === 'email' ? 'the email address'
                    : field === 'phone' ? 'the phone number'
                    : `the ${field} field`;
                return apiError(`Merge conflict: ${label} is already attached to another record.`, 409);
            }
            await logBackendError(error, "POST /api/membership-ops/participants/merge");
            return apiError("Failed to merge participants — check server logs for details.", 500);
        }
    }
);

// Prisma known-request errors carry a string `code` and, for P2002, a
// `meta.target` naming the colliding column(s). Duck-typed so we don't pull
// in the generated Prisma namespace just for one check. Returns the first
// colliding field name, or undefined if this isn't a P2002.
function prismaUniqueConflictField(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || (error as { code?: unknown }).code !== 'P2002') {
        return undefined;
    }
    const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
    if (Array.isArray(target)) return target[0];
    if (typeof target === 'string') return target;
    return 'unique';
}
