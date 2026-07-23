import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { addHouseholdLead, removeHouseholdLead, HouseholdLeadLimitError } from "@/lib/household/leads";
import { reconcileAndWarn } from "@/lib/emergencyContacts/service";
import { isValidPhone, formatPhone, PHONE_ERROR } from "@/lib/phone";
import { HOUSEHOLD_PEER_SELECT } from "@/lib/household/participantProjection";
import { householdLeadship } from "@/lib/household/leads";
import { apiError } from "@/lib/api-response";

export const PATCH = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return apiError("Unauthorized", 401);
            const userId = auth.user.id;

            const body = await req.json();
            const { participantId, name, email, dob, phone, isLead, over25, allergies } = body;

            if (!participantId) {
                return apiError("Participant ID is required", 400);
            }

            // Phone is optional for a member, but if supplied it must be valid.
            if (phone !== undefined && phone !== "" && !isValidPhone(phone)) {
                return apiError(PHONE_ERROR, 400);
            }

            const hh = await householdLeadship(userId);

            if (!hh) {
                return apiError("You must create a household first", 400);
            }
            const householdId = hh.householdId;

            // Leads/sysadmins edit anyone; anyone may edit their own record.
            if (!hh.canManage && participantId !== userId) {
                return apiError("Only household leads can edit household members", 403);
            }

            const targetHouseholdMember = await prisma.person.findUnique({ where: { id: participantId } });
            if (!targetHouseholdMember || targetHouseholdMember.householdId !== householdId) {
                return apiError("That household member was not found", 404);
            }

            const { updatedHouseholdMember, leadRejection, warning } = await prisma.$transaction(async (tx) => {
                const updatedHouseholdMember = await tx.person.update({
                    where: { id: participantId },
                    data: {
                        name: name !== undefined ? name : undefined,
                        email: email !== undefined ? (email === "" ? null : email.toLowerCase()) : undefined,
                        dateOfBirth: dob !== undefined ? (dob === "" ? null : new Date(dob + "T12:00:00Z")) : undefined,
                        phone: phone !== undefined ? (phone === "" ? null : formatPhone(phone)) : undefined,
                        // A real DoB supersedes the 25+ flag; otherwise honor the checkbox.
                        isDeclaredAdult: over25 !== undefined ? (dob ? false : !!over25) : undefined,
                        allergies: allergies !== undefined ? (allergies === "" ? null : allergies) : undefined,
                    },
                    select: HOUSEHOLD_PEER_SELECT,
                });

                // Set when the field edits saved but the requested promotion to lead
                // was declined by the per-household cap (#269). We report this back
                // rather than 400 the whole edit, so the form can say the member's
                // details were saved even though they weren't made a lead.
                let leadRejection: string | null = null;

                if (isLead !== undefined && participantId !== userId) {
                    const currentTarget = await tx.person.findUnique({
                        where: { id: participantId },
                        select: { isHouseholdLead: true }
                    });
                    const currentLead = !!currentTarget?.isHouseholdLead;

                    if (isLead && !currentLead) {
                        try {
                            await addHouseholdLead(tx, householdId, participantId);
                            await tx.auditLog.create({
                                data: {
                                    actorId: userId,
                                    action: "CREATE",
                                    tableName: "Person",
                                    affectedEntityId: participantId,
                                    secondaryAffectedEntity: householdId
                                }
                            });
                        } catch (e) {
                            if (e instanceof HouseholdLeadLimitError) {
                                leadRejection = e.message;
                            } else {
                                throw e;
                            }
                        }
                    } else if (!isLead && currentLead) {
                        // Locked demote (shared with the lead route). Silently a
                        // no-op if this is the household's last lead — the member
                        // edit still saves; leadership just isn't dropped.
                        const result = await removeHouseholdLead(tx, householdId, participantId);
                        if (result.removed) {
                            await tx.auditLog.create({
                                data: {
                                    actorId: userId,
                                    action: "DELETE",
                                    tableName: "Person",
                                    affectedEntityId: participantId,
                                    secondaryAffectedEntity: householdId
                                }
                            });
                        }
                    }
                }

                await tx.auditLog.create({
                    data: {
                        actorId: userId,
                        action: "EDIT",
                        tableName: "Person",
                        affectedEntityId: targetHouseholdMember.id,
                        newData: updatedHouseholdMember
                    }
                });

                // Edits to a member's name/phone/email can make them match an
                // emergency contact (direction B): re-evaluate and warn if so.
                const warning = await reconcileAndWarn(tx, householdId);

                return { updatedHouseholdMember, leadRejection, warning };
            });

            return NextResponse.json({
                householdMember: updatedHouseholdMember,
                message: leadRejection ? "Household member updated, but not added as a lead." : "Household member updated successfully.",
                leadRejection,
                warning,
            }, { status: 200 });

        } catch (error: unknown) {
            if (error instanceof HouseholdLeadLimitError) {
                return apiError(error.message, 400);
            }
            logger.error("Household Member PATCH Error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);
