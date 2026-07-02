import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { logBackendError, logger } from "@/lib/logger";
import { addHouseholdLead, HouseholdLeadLimitError } from "@/lib/household/leads";
import { lockProgramAndCheckCapacity, ProgramCapacityError } from "@/lib/program/capacity";
import { createContact, EmergencyContactError } from "@/lib/emergencyContacts/service";
import { rateLimit, rateLimitEmail } from "@/lib/rate-limit";
import { calculateAge } from "@/lib/time";
import { isValidPhone, formatPhone, PHONE_ERROR } from "@/lib/phone";
import { apiError } from "@/lib/api-response";

interface ParentInput {
    name: string;
    email?: string | null;
    phone?: string | null;
}

interface ParticipantInput {
    name: string;
    dob?: string | null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // Unauthenticated + writes to the DB and emails a caller-supplied address:
    // the email-bomb / DB-spam target. Cap per source IP before any work.
    const ipLimited = rateLimit(req, { name: "public-register", limit: 5, windowMs: 60_000 });
    if (ipLimited) return ipLimited;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return apiError("Invalid program ID", 400);
        }

        // Capacity is counted under a row lock inside the registration
        // transaction below, so no _count is fetched here.
        const currentProgram = await prisma.program.findUnique({
            where: { id: programId }
        });

        if (!currentProgram) {
            return apiError("Program not found", 404);
        }

        const body = await req.json();
        const { parents, emergencyContact, participants } = body;

        if (!parents || parents.length === 0 || !parents[0].name || !parents[0].email || !parents[0].phone) {
            return apiError("Primary parent/guardian information is required.", 400);
        }
        if (!isValidPhone(parents[0].phone)) {
            return apiError(PHONE_ERROR, 400);
        }
        if (!emergencyContact || !emergencyContact.name || !emergencyContact.phone) {
            return apiError("Emergency contact is required.", 400);
        }
        // Emergency-contact phone format is enforced in createContact below.
        if (!participants || participants.length === 0) {
            return apiError("At least one participant is required.", 400);
        }

        // Second limit keyed on the normalized primary email so an attacker can't
        // bomb one victim by rotating plus-tag / dotted variants of their address.
        const emailLimited = rateLimitEmail(parents[0].email, { name: "public-register", limit: 3, windowMs: 3_600_000 });
        if (emailLimited) return emailLimited;

        // The not-a-household-member rule (phone/email/name) is enforced when the
        // contact is created inside the transaction, against every household
        // member — see createContact below.

        // Check for existing emails to prevent Unique Constraint violations
        const emailsToCheck = parents.map((p: ParentInput) => p.email).filter(Boolean);
        if (emailsToCheck.length > 0) {
            const existingUsers = await prisma.person.findMany({
                where: { email: { in: emailsToCheck } }
            });
            if (existingUsers.length > 0) {
                return apiError("An account with that email already exists. Please log in to enroll.", 400);
            }
        }

        // Capacity is re-checked under a row lock INSIDE the transaction below
        // (this endpoint is public/unauthenticated, so it is trivially raced).
        // The _count read above is stale by the time we write.

        // Check Enrollment Status
        if (currentProgram.enrollmentStatus === 'CLOSED') {
            return apiError("Program enrollment is currently closed.", 400);
        }

        // Check Age constraints
        if (currentProgram.minAge !== null || currentProgram.maxAge !== null) {
            for (const p of participants as ParticipantInput[]) {
                const isMatchingParent = parents.some((parent: ParentInput) => parent.name.toLowerCase().trim() === p.name.toLowerCase().trim());
                if (isMatchingParent) {
                    // It's an adult parent. Assume they are over 18.
                    const age = 30; 
                    if (currentProgram.minAge !== null && age < currentProgram.minAge) {
                        return apiError(`Participant ${p.name} does not meet minimum age restriction.`, 400);
                    }
                    if (currentProgram.maxAge !== null && age > currentProgram.maxAge) {
                        return apiError(`Participant ${p.name} exceeds maximum age restriction.`, 400);
                    }
                } else {
                    if (!p.dob) {
                        return apiError(`Date of Birth is required for participant ${p.name} to verify age constraints.`, 400);
                    }
                    // Judge age as of the program's start date; fall back to now
                    // for dateless ("TBD") programs.
                    const age = calculateAge(p.dob, currentProgram.startAt ?? undefined);
                    if (currentProgram.minAge !== null && age < currentProgram.minAge) {
                        return apiError(`Participant ${p.name} must be at least ${currentProgram.minAge} years old.`, 400);
                    }
                    if (currentProgram.maxAge !== null && age > currentProgram.maxAge) {
                        return apiError(`Participant maximum age is ${currentProgram.maxAge} years old for ${p.name}.`, 400);
                    }
                }
            }
        }

        const isFree = currentProgram.memberPriceCents === null && currentProgram.nonMemberPriceCents === null;
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
                        phone: parent.phone ? formatPhone(parent.phone) : null,
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

        // 4. Send Notifications
        for (const participantId of result.enrolledParticipantIds) {
            await sendNotification(participantId, 'PROGRAM_ENROLLMENT', { programName: currentProgram.name }).catch(e => logger.error(e));
        }

        // 5. Build Checkout URL if not free
        let checkoutUrl = null;
        if (!isFree && currentProgram.shopifyNonMemberVariantId) {
            const storeDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
            const accountIdsStr = result.enrolledParticipantIds.join(',');
            const quantity = result.enrolledParticipantIds.length;
            checkoutUrl = `https://${storeDomain}/cart/${currentProgram.shopifyNonMemberVariantId}:${quantity}?attributes[CheckMeIn_Account_ID]=${accountIdsStr}&attributes[Program_ID]=${programId}`;
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
        await logBackendError(error, "POST /api/programs/[id]/public-register");
        return apiError("An error occurred during registration.", 500);
    }
}
