import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";
import { sendEmail } from "@/lib/email";
import { config } from "@/lib/config";
import { rateLimit, rateLimitEmail } from "@/lib/rate-limit";
import { calculateAge } from "@/lib/time";
import { isValidPhone, PHONE_ERROR } from "@/lib/phone";
import { apiError } from "@/lib/api-response";
import { encodeRegistrationToken } from "@/lib/registrationToken";
import { registrationConfirmTemplate } from "@/lib/email-templates/registration-confirm";

interface ParentInput {
    name: string;
    email?: string | null;
    phone?: string | null;
}

interface ParticipantInput {
    name: string;
    dob?: string | null;
}

// Double opt-in, step 1 of 2 (see confirm/route.ts for step 2).
//
// This endpoint is fully unauthenticated. To avoid being used to spam the DB or
// bomb a third party's inbox, it writes NOTHING and sends only ONE confirmation
// email to the entered address. The household/participants/enrollments are
// created only when the recipient clicks the tokenized link, proving they
// control the address. It also returns the SAME neutral response whether or not
// the email already has an account, so it can't be used to enumerate accounts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // Unauthenticated and emails a caller-supplied address: the email-bomb target.
    // Cap per source IP before any work.
    const ipLimited = rateLimit(req, { name: "public-register", limit: 5, windowMs: 60_000 });
    if (ipLimited) return ipLimited;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return apiError("Invalid program ID", 400);
        }

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

        // NOTE: we deliberately do NOT check whether the email already exists here.
        // Branching the response on existence would leak which emails have accounts
        // to an anonymous caller. That check (and the household-member rule for the
        // emergency contact, and capacity) runs at confirm time, after the address
        // is proven and a row lock is held.

        if (currentProgram.enrollmentStatus === 'CLOSED') {
            return apiError("Program enrollment is currently closed.", 400);
        }

        // Age constraints — validated now so we don't email a confirmation for an
        // ineligible registration. The token is tamper-proof, so confirm trusts it.
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

        // Stash the validated registration in a tamper-proof, self-expiring token
        // and email it. No DB writes happen until confirm.
        const token = encodeRegistrationToken({ programId, parents, emergencyContact, participants });
        const confirmUrl = `${config.baseUrl()}/programs/${programId}/register/confirm?token=${encodeURIComponent(token)}`;
        await sendEmail(
            parents[0].email,
            "Confirm your registration",
            registrationConfirmTemplate({ programName: currentProgram.name, confirmUrl })
        );

        // Neutral response — identical regardless of whether the email exists.
        return NextResponse.json({
            success: true,
            pending: true,
            message: "Almost done! Check your email for a link to confirm your registration."
        });

    } catch (error) {
        await logBackendError(error, "POST /api/programs/[id]/public-register");
        return apiError("An error occurred during registration.", 500);
    }
}
