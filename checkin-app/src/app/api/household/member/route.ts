import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { addHouseholdLead, HouseholdLeadLimitError } from "@/lib/household/leads";
import { reconcileAndWarn } from "@/lib/emergencyContacts/service";
import { isValidPhone, formatPhone, PHONE_ERROR } from "@/lib/phone";
import { HOUSEHOLD_PEER_SELECT } from "@/lib/household/participantProjection";
import { householdLeadship } from "@/lib/household/leads";

export const PATCH = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            const body = await req.json();
            const { participantId, name, email, dob, phone, isLead, over25 } = body;

            if (!participantId) {
                return NextResponse.json({ error: "Participant ID is required" }, { status: 400 });
            }

            // Phone is optional for a member, but if supplied it must be valid.
            if (phone !== undefined && phone !== "" && !isValidPhone(phone)) {
                return NextResponse.json({ error: PHONE_ERROR }, { status: 400 });
            }

            const hh = await householdLeadship(userId);

            if (!hh) {
                return NextResponse.json({ error: "You must create a household first" }, { status: 400 });
            }
            const householdId = hh.householdId;

            // Leads/sysadmins edit anyone; anyone may edit their own record.
            if (!hh.canManage && participantId !== userId) {
                return NextResponse.json({ error: "Only household leads can edit household members" }, { status: 403 });
            }

            const targetHouseholdMember = await prisma.person.findUnique({ where: { id: participantId } });
            if (!targetHouseholdMember || targetHouseholdMember.householdId !== householdId) {
                return NextResponse.json({ error: "That household member was not found" }, { status: 404 });
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
                    },
                    select: HOUSEHOLD_PEER_SELECT,
                });

                // Set when the field edits saved but the requested promotion to lead
                // was declined by the per-household cap (#269). We report this back
                // rather than 400 the whole edit, so the form can say the member's
                // details were saved even though they weren't made a lead.
                let leadRejection: string | null = null;

                if (isLead !== undefined && participantId !== userId) {
                    const currentLead = await tx.householdLead.findUnique({
                        where: {
                            householdId_personId: { householdId: householdId, personId: participantId }
                        }
                    });

                    if (isLead && !currentLead) {
                        try {
                            await addHouseholdLead(tx, householdId, participantId);
                            await tx.auditLog.create({
                                data: {
                                    actorId: userId,
                                    action: "CREATE",
                                    tableName: "HouseholdLead",
                                    affectedEntityId: householdId,
                                    secondaryAffectedEntity: participantId
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
                        const leadCount = await tx.householdLead.count({ where: { householdId: householdId } });
                        if (leadCount > 1) {
                            await tx.householdLead.delete({
                                 where: {
                                     householdId_personId: { householdId: householdId, personId: participantId }
                                 }
                            });

                            await tx.auditLog.create({
                                data: {
                                    actorId: userId,
                                    action: "DELETE",
                                    tableName: "HouseholdLead",
                                    affectedEntityId: householdId,
                                    secondaryAffectedEntity: participantId
                                }
                            });
                        }
                    }
                }

                await tx.auditLog.create({
                    data: {
                        actorId: userId,
                        action: "EDIT",
                        tableName: "Participant",
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
                return NextResponse.json({ error: error.message }, { status: 400 });
            }
            console.error("Household Member PATCH Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
