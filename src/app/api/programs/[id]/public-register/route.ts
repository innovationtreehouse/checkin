import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return NextResponse.json({ error: "Invalid program ID" }, { status: 400 });
        }

        const currentProgram = await prisma.program.findUnique({
            where: { id: programId },
            include: {
                _count: { select: { participants: true } }
            }
        });

        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const body = await req.json();
        const { parents, emergencyContact, participants } = body;

        if (!parents || parents.length === 0 || !parents[0].name || !parents[0].email || !parents[0].phone) {
            return NextResponse.json({ error: "Primary parent/guardian information is required." }, { status: 400 });
        }
        if (!emergencyContact || !emergencyContact.name || !emergencyContact.phone) {
            return NextResponse.json({ error: "Emergency contact is required." }, { status: 400 });
        }
        if (!participants || participants.length === 0) {
            return NextResponse.json({ error: "At least one participant is required." }, { status: 400 });
        }

        // Validate Emergency Contact phone doesn't match parents
        const parentPhones = parents.map((p: any) => p.phone && p.phone.replace(/\D/g, '')).filter(Boolean);
        const emergencyPhone = emergencyContact.phone.replace(/\D/g, '');
        if (parentPhones.includes(emergencyPhone)) {
             return NextResponse.json({ error: "Emergency contact phone must be different from parent/guardian phone numbers." }, { status: 400 });
        }

        // Check for existing emails to prevent Unique Constraint violations
        const emailsToCheck = parents.map((p: any) => p.email).filter(Boolean);
        if (emailsToCheck.length > 0) {
            const existingUsers = await prisma.participant.findMany({
                where: { email: { in: emailsToCheck } }
            });
            if (existingUsers.length > 0) {
                return NextResponse.json({ error: "An account with that email already exists. Please log in to enroll." }, { status: 400 });
            }
        }

        // Check Capacity
        if (currentProgram.maxParticipants !== null && currentProgram._count.participants + participants.length > currentProgram.maxParticipants) {
            return NextResponse.json({ error: `Not enough open spots. Only ${currentProgram.maxParticipants - currentProgram._count.participants} spots left.` }, { status: 400 });
        }

        // Check Enrollment Status
        if (currentProgram.enrollmentStatus === 'CLOSED') {
            return NextResponse.json({ error: "Program enrollment is currently closed." }, { status: 400 });
        }

        // Check Age constraints
        if (currentProgram.minAge !== null || currentProgram.maxAge !== null) {
            for (const p of participants) {
                const isMatchingParent = parents.some((parent: any) => parent.name.toLowerCase().trim() === p.name.toLowerCase().trim());
                if (isMatchingParent) {
                    // It's an adult parent. Assume they are over 18.
                    const age = 30; 
                    if (currentProgram.minAge !== null && age < currentProgram.minAge) {
                        return NextResponse.json({ error: `Participant ${p.name} does not meet minimum age restriction.` }, { status: 400 });
                    }
                    if (currentProgram.maxAge !== null && age > currentProgram.maxAge) {
                        return NextResponse.json({ error: `Participant ${p.name} exceeds maximum age restriction.` }, { status: 400 });
                    }
                } else {
                    if (!p.dob) {
                        return NextResponse.json({ error: `Date of Birth is required for participant ${p.name} to verify age constraints.` }, { status: 400 });
                    }
                    const ageDifMs = Date.now() - new Date(p.dob).getTime();
                    const ageDate = new Date(ageDifMs);
                    const age = Math.abs(ageDate.getUTCFullYear() - 1970);
                    if (currentProgram.minAge !== null && age < currentProgram.minAge) {
                        return NextResponse.json({ error: `Participant ${p.name} must be at least ${currentProgram.minAge} years old.` }, { status: 400 });
                    }
                    if (currentProgram.maxAge !== null && age > currentProgram.maxAge) {
                        return NextResponse.json({ error: `Participant maximum age is ${currentProgram.maxAge} years old for ${p.name}.` }, { status: 400 });
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

    } catch (error: any) {
        console.error("Public registration error:", error);
        return NextResponse.json({ error: error.message || "An error occurred during registration." }, { status: 500 });
    }
}
