import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { logBackendError, logger } from "@/lib/logger";
import { addHouseholdLead, HouseholdLeadLimitError } from "@/lib/household/leads";
import { lockProgramAndCheckCapacity, ProgramCapacityError } from "@/lib/program/capacity";
import { createContact, EmergencyContactError } from "@/lib/emergencyContacts/service";
import { rateLimit } from "@/lib/rate-limit";
import { decodeRegistrationToken } from "@/lib/registrationToken";
import { apiError } from "@/lib/api-response";

interface ParentInput {
    name: string;
    email?: string | null;
    phone?: string | null;
}

interface RegistrationPayload {
    programId: number;
    parents: ParentInput[];
    emergencyContact: { name: string; phone: string; email?: string | null };
    participants: { name: string; dob?: string | null }[];
}

// Double opt-in, step 2 of 2. The recipient clicked the tokenized link, proving
// they control the email, so we now do the actual writes. Everything here was
// already shape/age-validated at request time and the token is tamper-proof, so
// we re-check only the time-sensitive things: enrollment status, capacity (under
// a row lock), and the email-already-exists / household-member rules.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const limited = rateLimit(req, { name: "public-register-confirm", limit: 10, windowMs: 60_000 });
    if (limited) return limited;

    try {
        const programId = parseInt(id, 10);
        const { token } = await req.json();
        const payload = decodeRegistrationToken<RegistrationPayload>(token);

        if (!payload || payload.programId !== programId) {
            return apiError("This confirmation link is invalid or has expired.", 400);
        }

        const { parents, emergencyContact, participants } = payload;

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return apiError("Program not found", 404);
        }
        if (currentProgram.enrollmentStatus === 'CLOSED') {
            return apiError("Program enrollment is currently closed.", 400);
        }

        // Now safe to check existence: the caller proved control of the email by
        // clicking the link, so this is not an enumeration oracle. Also makes a
        // replayed confirm link idempotent (second click → "already exists").
        const emailsToCheck = parents.map((p) => p.email).filter(Boolean) as string[];
        if (emailsToCheck.length > 0) {
            const existingUsers = await prisma.person.findMany({
                where: { email: { in: emailsToCheck } }
            });
            if (existingUsers.length > 0) {
                return apiError("An account with that email already exists. Please log in to enroll.", 400);
            }
        }

        const isFree = currentProgram.orgMemberPriceCents === null && currentProgram.nonOrgMemberPriceCents === null;
        const initialStatus = isFree ? 'ACTIVE' : 'PENDING';

        // Transactionally create everything
        const result = await prisma.$transaction(async (tx) => {
            // 0. Lock the program and re-check capacity against the committed
            //    enrollment count, serializing concurrent registrations.
            await lockProgramAndCheckCapacity(tx, programId, participants.length, currentProgram.maxParticipants);

            // 1. Create Household
            const household = await tx.household.create({
                data: {
                    name: `${parents[0].name.split(' ').pop() || parents[0].name}'s Household`,
                }
            });

            // 2. Create Parents
            const createdParents = [];
            for (const parent of parents) {
                if (!parent.name) continue;
                const newParent = await tx.person.create({
                    data: {
                        name: parent.name,
                        email: parent.email || null,
                        phone: parent.phone || null,
                        householdId: household.id,
                    }
                });
                createdParents.push(newParent);

                // Make them lead
                await addHouseholdLead(tx, household.id, newParent.id);
            }

            // 3. Create Participants & Enrollments
            const enrolledParticipantIds: number[] = [];

            for (const p of participants) {
                let participantId: number;

                const matchedParent = createdParents.find(cp => cp.name && cp.name.toLowerCase().trim() === p.name.toLowerCase().trim());

                if (matchedParent) {
                    participantId = matchedParent.id;
                } else {
                    const newParticipant = await tx.person.create({
                        data: {
                            name: p.name,
                            dateOfBirth: p.dob ? new Date(p.dob) : null,
                            householdId: household.id,
                        }
                    });
                    participantId = newParticipant.id;
                }

                enrolledParticipantIds.push(participantId);

                const enrollment = await tx.programParticipant.create({
                    data: {
                        programId,
                        personId: participantId,
                        status: initialStatus
                    }
                });

                await tx.auditLog.create({
                    data: {
                        actorId: createdParents[0].id, // Self-serve
                        action: 'CREATE',
                        tableName: 'ProgramParticipant',
                        affectedEntityId: participantId,
                        secondaryAffectedEntity: programId,
                        newData: enrollment
                    }
                });
            }

            // 4. Create the emergency contact now that members exist, so the
            //    not-a-household-member check runs against the full household.
            await createContact(tx, household.id, {
                name: emergencyContact.name,
                phone: emergencyContact.phone,
                email: emergencyContact.email ?? null,
            });

            return { householdId: household.id, enrolledParticipantIds, primaryParent: createdParents[0] };
        });

        // 5. Send Notifications
        for (const participantId of result.enrolledParticipantIds) {
            await sendNotification(participantId, 'PROGRAM_ENROLLMENT', { programName: currentProgram.name }).catch(e => logger.error(e));
        }

        // 6. Build Checkout URL if not free
        let checkoutUrl = null;
        if (!isFree && currentProgram.shopifyNonOrgMemberVariantId) {
            const storeDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
            const accountIdsStr = result.enrolledParticipantIds.join(',');
            const quantity = result.enrolledParticipantIds.length;
            checkoutUrl = `https://${storeDomain}/cart/${currentProgram.shopifyNonOrgMemberVariantId}:${quantity}?attributes[CheckMeIn_Account_ID]=${accountIdsStr}&attributes[Program_ID]=${programId}`;
        }

        return NextResponse.json({
            success: true,
            isFree,
            checkoutUrl,
            message: isFree ? "Enrollment complete." : "Redirecting to Shopify for payment."
        });

    } catch (error) {
        if (error instanceof ProgramCapacityError) {
            return apiError(`Not enough open spots. Only ${error.spotsLeft} spots left.`, 400);
        }
        if (error instanceof HouseholdLeadLimitError || error instanceof EmergencyContactError) {
            return apiError(error.message, 400);
        }
        await logBackendError(error, "POST /api/programs/[id]/public-register/confirm");
        return apiError("An error occurred during registration.", 500);
    }
}
