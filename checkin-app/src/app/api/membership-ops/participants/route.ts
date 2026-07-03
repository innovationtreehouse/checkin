import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";
import { addHouseholdLead, HouseholdLeadLimitError } from "@/lib/household/leads";
import { isValidEmail } from "@/lib/emergencyContacts/identity";
import { apiError } from "@/lib/api-response";

export const POST = withAuth({ roles: ['isSysadmin', 'isBoardMember'] }, async (req, auth) => {
    if (auth.type !== 'session') {
        return apiError("Unauthorized", 401);
    }

    try {
        const body = await req.json();
        // `alreadyMember` lets an admin confirm a newly-created household is already
        // a paid member (defaults false — new participants are visitors, not members).
        const { name, email, parentEmail, dob, householdId, alreadyMember = false } = body;

        if (!email && !parentEmail && !householdId) {
            return apiError("Email, Parent Email, or Household assignment is required", 400);
        }

        if (email && !isValidEmail(email)) {
             return apiError("Invalid email format", 400);
        }

        if (parentEmail && !isValidEmail(parentEmail)) {
             return apiError("Invalid parent email format", 400);
        }

        if (email) {
            const existingUser = await prisma.person.findUnique({
                where: { email }
            });

            if (existingUser) {
                return apiError("A participant with this email already exists", 409);
            }
        }

        // Every participant must belong to a household, so resolve it before
        // creating: parent's household > explicitly provided household > a new
        // household of their own.
        let householdIdToAssign: number | null = null;

        if (parentEmail) {
            let parent = await prisma.person.findUnique({
                where: { email: parentEmail }
            });

            if (!parent) {
                parent = await prisma.person.create({
                    data: {
                        email: parentEmail,
                        household: {
                            create: { name: "Household" }
                        }
                    }
                });
                await addHouseholdLead(prisma, parent.householdId, parent.id);
                if (alreadyMember) {
                    await prisma.orgMembership.create({
                        data: {
                            householdId: parent.householdId,
                            status: 'ACTIVE',
                        }
                    });
                }
            }

            householdIdToAssign = parent.householdId;
        } else if (householdId) {
            householdIdToAssign = householdId;
        }

        let newParticipant;
        if (householdIdToAssign) {
            newParticipant = await prisma.person.create({
                data: {
                    name,
                    ...(email && { email }),
                    dateOfBirth: dob ? new Date(dob).toISOString() : null,
                    householdId: householdIdToAssign
                }
            });
        } else {
            const lastName = (name || "").trim().split(/\s+/).pop() || "";
            newParticipant = await prisma.person.create({
                data: {
                    name,
                    ...(email && { email }),
                    dateOfBirth: dob ? new Date(dob).toISOString() : null,
                    household: {
                        create: { name: lastName ? `${lastName} Household` : "Household" }
                    }
                }
            });

            await addHouseholdLead(prisma, newParticipant.householdId, newParticipant.id);

            if (alreadyMember) {
                await prisma.orgMembership.create({
                    data: {
                        householdId: newParticipant.householdId,
                        status: 'ACTIVE',
                    }
                });
            }
        }

        return NextResponse.json({ success: true, participant: newParticipant });
    } catch (error: unknown) {
        if (error instanceof HouseholdLeadLimitError) {
            return apiError(error.message, 400);
        }
        await logBackendError(error, "POST /api/membership-ops/participants");
        return apiError(`Failed to create participant`, 500);
    }
});
