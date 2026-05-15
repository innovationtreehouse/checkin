import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { logBackendError } from "@/lib/logger";
import { buildShopifyCheckoutUrl } from "@/lib/shopify";
import { ApiResponseError, badRequest, handler, notFound } from "@/security/handler";

export const POST = handler<{ id: string }>('POST /api/programs/[id]/public-register', async ({ req, params }) => {
    const { id } = params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            throw badRequest("Invalid program ID");
        }

        const currentProgram = await prisma.program.findUnique({
            where: { id: programId },
            include: {
                _count: { select: { participants: true } }
            }
        });

        if (!currentProgram) {
            throw notFound("Program not found");
        }

        const body = await req.json();
        const { parents, emergencyContact, participants } = body;

        if (!parents || parents.length === 0 || !parents[0].name || !parents[0].email || !parents[0].phone) {
            throw badRequest("Primary parent/guardian information is required.");
        }
        if (!emergencyContact || !emergencyContact.name || !emergencyContact.phone) {
            throw badRequest("Emergency contact is required.");
        }
        if (!participants || participants.length === 0) {
            throw badRequest("At least one participant is required.");
        }

        // Validate Emergency Contact phone doesn't match parents
        const parentPhones = parents.map((p: { phone?: string }) => p.phone && p.phone.replace(/\D/g, '')).filter(Boolean);
        const emergencyPhone = emergencyContact.phone.replace(/\D/g, '');
        if (parentPhones.includes(emergencyPhone)) {
            throw badRequest("Emergency contact phone must be different from parent/guardian phone numbers.");
        }

        // Check for existing emails to prevent Unique Constraint violations
        const emailsToCheck = parents.map((p: { email?: string }) => p.email).filter(Boolean);
        if (emailsToCheck.length > 0) {
            const existingUsers = await prisma.participant.findMany({
                where: { email: { in: emailsToCheck } }
            });
            if (existingUsers.length > 0) {
                throw badRequest("An account with that email already exists. Please log in to enroll.");
            }
        }

        // Check Capacity
        if (currentProgram.maxParticipants !== null && currentProgram._count.participants + participants.length > currentProgram.maxParticipants) {
            throw badRequest(`Not enough open spots. Only ${currentProgram.maxParticipants - currentProgram._count.participants} spots left.`);
        }

        // Check Enrollment Status
        if (currentProgram.enrollmentStatus === 'CLOSED') {
            throw badRequest("Program enrollment is currently closed.");
        }

        // Check Age constraints
        if (currentProgram.minAge !== null || currentProgram.maxAge !== null) {
            for (const p of participants) {
                const isMatchingParent = parents.some((parent: { name: string }) => parent.name.toLowerCase().trim() === p.name.toLowerCase().trim());
                if (isMatchingParent) {
                    // It's an adult parent. Assume they are over 18.
                    const age = 30;
                    if (currentProgram.minAge !== null && age < currentProgram.minAge) {
                        throw badRequest(`Participant ${p.name} does not meet minimum age restriction.`);
                    }
                    if (currentProgram.maxAge !== null && age > currentProgram.maxAge) {
                        throw badRequest(`Participant ${p.name} exceeds maximum age restriction.`);
                    }
                } else {
                    if (!p.dob) {
                        throw badRequest(`Date of Birth is required for participant ${p.name} to verify age constraints.`);
                    }
                    const ageDifMs = Date.now() - new Date(p.dob).getTime();
                    const ageDate = new Date(ageDifMs);
                    const age = Math.abs(ageDate.getUTCFullYear() - 1970);
                    if (currentProgram.minAge !== null && age < currentProgram.minAge) {
                        throw badRequest(`Participant ${p.name} must be at least ${currentProgram.minAge} years old.`);
                    }
                    if (currentProgram.maxAge !== null && age > currentProgram.maxAge) {
                        throw badRequest(`Participant maximum age is ${currentProgram.maxAge} years old for ${p.name}.`);
                    }
                }
            }
        }

        const isFree = currentProgram.memberPrice === null && currentProgram.nonMemberPrice === null;
        const initialStatus = isFree ? 'ACTIVE' : 'PENDING';

        // Transactionally create everything
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Household
            const household = await tx.household.create({
                data: {
                    name: `${parents[0].name.split(' ').pop() || parents[0].name}'s Household`,
                    emergencyContactName: emergencyContact.name,
                    emergencyContactPhone: emergencyContact.phone,
                }
            });

            // 2. Create Parents
            const createdParents = [];
            for (const parent of parents) {
                if (!parent.name) continue;
                const newParent = await tx.participant.create({
                    data: {
                        name: parent.name,
                        email: parent.email || null,
                        phone: parent.phone || null,
                        householdId: household.id,
                    }
                });
                createdParents.push(newParent);

                // Make them lead
                await tx.householdLead.create({
                    data: {
                        householdId: household.id,
                        participantId: newParent.id
                    }
                });
            }

            // 3. Create Participants & Enrollments
            const enrolledParticipantIds: number[] = [];

            for (const p of participants) {
                let participantId: number;

                const matchedParent = createdParents.find(cp => cp.name && cp.name.toLowerCase().trim() === p.name.toLowerCase().trim());

                if (matchedParent) {
                    participantId = matchedParent.id;
                } else {
                    const newParticipant = await tx.participant.create({
                        data: {
                            name: p.name,
                            dob: p.dob ? new Date(p.dob) : null,
                            householdId: household.id,
                        }
                    });
                    participantId = newParticipant.id;
                }

                enrolledParticipantIds.push(participantId);

                const enrollment = await tx.programParticipant.create({
                    data: {
                        programId,
                        participantId,
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
                        newData: JSON.stringify(enrollment)
                    }
                });
            }

            return { householdId: household.id, enrolledParticipantIds, primaryParent: createdParents[0] };
        });

        // 4. Send Notifications
        for (const participantId of result.enrolledParticipantIds) {
            await sendNotification(participantId, 'PROGRAM_ENROLLMENT', { programName: currentProgram.name }).catch(e => console.error(e));
        }

        // 5. Build Checkout URL if not free (via gateway → src/lib/shopify.ts)
        let checkoutUrl: string | null = null;
        if (!isFree && currentProgram.shopifyNonMemberVariantId) {
            checkoutUrl = await buildShopifyCheckoutUrl({
                variantId: currentProgram.shopifyNonMemberVariantId,
                quantity: result.enrolledParticipantIds.length,
                participantIds: result.enrolledParticipantIds,
                programId,
            });
        }

        return {
            success: true,
            isFree,
            checkoutUrl,
            message: isFree ? "Enrollment complete." : "Redirecting to Shopify for payment.",
        };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "POST /api/programs/[id]/public-register");
        throw err;
    }
});
