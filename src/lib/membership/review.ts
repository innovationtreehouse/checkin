import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

/**
 * Background-check review (PENDING_BG_REVIEW phase).
 *
 * Two DISTINCT eligible reviewers (role backgroundCheckReviewer) must each
 * attest the check independently. A reviewer may not share a household with the
 * applicant or with the other reviewer, and may not attest twice.
 *   - 2 APPROVE  -> advance to PENDING_PAYMENT; stamp parents' lastBackgroundCheck;
 *                   apply (sticky) volunteer status.
 *   - any REJECT -> BLOCKED (board override/reset; applicant is NOT told why).
 *
 * The system never sees the check itself — only the attestations.
 */

const SYSTEM_ACTOR = 0;
const REQUIRED_APPROVALS = 2;

export class ReviewError extends Error {
    constructor(
        public readonly code:
            | "not_reviewer"
            | "not_found"
            | "wrong_phase"
            | "same_household_applicant"
            | "same_household_reviewer"
            | "already_attested",
        message: string,
    ) {
        super(message);
        this.name = "ReviewError";
    }
}

/**
 * Normalize an email for volunteer-designation matching: lowercase, and strip
 * dots from the local part (Gmail-style). "Foo.Bar@Gmail.com" -> "foobar@gmail.com".
 */
export function normalizeEmail(email: string): string {
    const lower = email.trim().toLowerCase();
    const at = lower.indexOf("@");
    if (at < 0) return lower;
    return lower.slice(0, at).replace(/\./g, "") + lower.slice(at);
}

/** Email every background-check reviewer that an application awaits review. */
export async function notifyReviewers(): Promise<void> {
    try {
        const reviewers = await prisma.participant.findMany({
            where: { backgroundCheckReviewer: true, email: { not: null } },
            select: { email: true },
        });
        const base = process.env.NEXTAUTH_URL ?? "";
        await Promise.all(
            reviewers.map((r) =>
                r.email
                    ? sendEmail(
                          r.email,
                          "Membership: a background-check review is needed",
                          `<p>An application is ready for your background-check review. Please sign in to review it: <a href="${base}/membership/review">${base}/membership/review</a></p>`,
                      ).catch((e) => logger.error("Reviewer ping failed:", e))
                    : Promise.resolve(),
            ),
        );
    } catch (e) {
        logger.error("notifyReviewers failed:", e);
    }
}

async function loadReviewer(reviewerId: number) {
    return prisma.participant.findUnique({ where: { id: reviewerId }, select: { id: true, householdId: true, backgroundCheckReviewer: true } });
}

/** Applications this reviewer may currently attest (eligibility filtered). */
export async function listReviewQueue(reviewerId: number) {
    const reviewer = await loadReviewer(reviewerId);
    if (!reviewer?.backgroundCheckReviewer) return [];

    const processes = await prisma.membershipProcess.findMany({
        where: { status: { in: ["PENDING_BG_REVIEW", "RENEWAL_PENDING_BG"] } },
        orderBy: { stageEnteredAt: "asc" },
        select: {
            id: true,
            createdAt: true,
            membership: {
                select: {
                    householdId: true,
                    household: { select: { name: true, participants: { select: { id: true, name: true, email: true } }, leads: { select: { participantId: true } } } },
                },
            },
            attestations: { select: { reviewerId: true, result: true, reviewer: { select: { householdId: true } } } },
        },
    });

    return processes
        .filter((p) => {
            if (p.membership.householdId === reviewer.householdId) return false; // own household
            if (p.attestations.some((a) => a.reviewerId === reviewer.id)) return false; // already attested
            if (p.attestations.some((a) => a.reviewer.householdId === reviewer.householdId)) return false; // shares household with other reviewer
            return true;
        })
        .map((p) => {
            // Parents are the household leads.
            const leadIds = new Set((p.membership.household?.leads ?? []).map((l) => l.participantId));
            return {
                processId: p.id,
                householdName: p.membership.household?.name ?? null,
                parents: (p.membership.household?.participants ?? [])
                    .filter((x) => leadIds.has(x.id))
                    .map((x) => ({ name: x.name, email: x.email })),
                approvals: p.attestations.filter((a) => a.result === "APPROVE").length,
            };
        });
}

/**
 * Record a reviewer's attestation. Validates eligibility, then on REJECT blocks
 * the application and on the 2nd APPROVE advances it to PENDING_PAYMENT.
 */
export async function attest(
    reviewerId: number,
    processId: number,
    input: { result: "APPROVE" | "REJECT"; markedVolunteer?: boolean },
) {
    const reviewer = await loadReviewer(reviewerId);
    if (!reviewer?.backgroundCheckReviewer) throw new ReviewError("not_reviewer", "You are not a background-check reviewer.");

    const process = await prisma.membershipProcess.findUnique({
        where: { id: processId },
        include: { attestations: { include: { reviewer: { select: { householdId: true } } } } },
    });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    if (process.status !== "PENDING_BG_REVIEW" && process.status !== "RENEWAL_PENDING_BG") throw new ReviewError("wrong_phase", "This application is not awaiting background-check review.");
    const membership = await prisma.membership.findUnique({ where: { id: process.membershipId }, select: { householdId: true } });
    if (membership?.householdId === reviewer.householdId) throw new ReviewError("same_household_applicant", "You cannot review an applicant in your own household.");
    if (process.attestations.some((a) => a.reviewerId === reviewerId)) throw new ReviewError("already_attested", "You have already reviewed this application.");
    if (process.attestations.some((a) => a.reviewer.householdId === reviewer.householdId)) throw new ReviewError("same_household_reviewer", "Another reviewer from your household has already reviewed this application.");

    await prisma.backgroundCheckAttestation.create({
        data: { processId, reviewerId, result: input.result, markedVolunteer: !!input.markedVolunteer },
    });

    if (input.result === "REJECT") {
        await prisma.membershipProcess.update({ where: { id: processId }, data: { status: "BLOCKED", stageEnteredAt: new Date() } });
        await audit(reviewerId, processId, { status: process.status }, { status: "BLOCKED", reason: "reviewer reject" });
        return { status: "BLOCKED" as const };
    }

    const approvals = process.attestations.filter((a) => a.result === "APPROVE").length + 1;
    if (approvals >= REQUIRED_APPROVALS) {
        await advanceToPayment(processId, reviewerId);
        return { status: "PENDING_PAYMENT" as const };
    }
    return { status: "PENDING_BG_REVIEW" as const, approvals };
}

/** Advance a reviewed/overridden application to payment: stamp BG dates + volunteer status. */
async function advanceToPayment(processId: number, actorId: number) {
    const process = await prisma.membershipProcess.findUnique({
        where: { id: processId },
        include: { attestations: true },
    });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    const membership = await prisma.membership.findUnique({ where: { id: process.membershipId }, select: { householdId: true } });
    if (!membership) throw new ReviewError("not_found", "Membership not found.");
    const householdId = membership.householdId;

    await prisma.membershipProcess.update({ where: { id: processId }, data: { status: "PENDING_PAYMENT", stageEnteredAt: new Date() } });

    // Stamp the guardians' (household leads') lastBackgroundCheck (drives the 3-year renewal rule).
    await prisma.participant.updateMany({ where: { householdId, householdLeads: { some: { householdId } } }, data: { lastBackgroundCheck: new Date() } });

    await applyVolunteerStatus(process.membershipId, householdId, process.attestations.some((a) => a.markedVolunteer));

    await audit(actorId, processId, { status: process.status }, { status: "PENDING_PAYMENT" });
}

/**
 * Sticky/additive volunteer status: set Membership.isVolunteer = true if ANY
 * reviewer marked the family volunteer OR a household parent's email is pre-
 * designated. Never clears it here.
 */
export async function applyVolunteerStatus(membershipId: number, householdId: number, markedByReviewer: boolean) {
    let isVolunteer = markedByReviewer;
    if (!isVolunteer) {
        const parents = await prisma.participant.findMany({ where: { householdId, householdLeads: { some: { householdId } }, email: { not: null } }, select: { email: true } });
        const parentEmails = new Set(parents.map((p) => normalizeEmail(p.email!)));
        if (parentEmails.size) {
            const designations = await prisma.volunteerDesignation.findMany({ select: { email: true } });
            isVolunteer = designations.some((d) => parentEmails.has(normalizeEmail(d.email)));
        }
    }
    if (isVolunteer) {
        await prisma.membership.update({ where: { id: membershipId }, data: { isVolunteer: true } });
    }
}

/** Board override on a BLOCKED application: reset for re-review, or force-approve to payment. */
export async function overrideBlocked(processId: number, actorId: number, action: "reset" | "approve") {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    if (process.status !== "BLOCKED") throw new ReviewError("wrong_phase", "This application is not blocked.");

    if (action === "reset") {
        // Restore the review state that matches the cycle (initial vs renewal).
        const reviewStatus = process.kind === "RENEWAL" ? "RENEWAL_PENDING_BG" : "PENDING_BG_REVIEW";
        await prisma.backgroundCheckAttestation.deleteMany({ where: { processId } });
        await prisma.membershipProcess.update({ where: { id: processId }, data: { status: reviewStatus, stageEnteredAt: new Date() } });
        await audit(actorId, processId, { status: "BLOCKED" }, { status: reviewStatus, action: "board reset" });
        await notifyReviewers();
        return { status: reviewStatus as "PENDING_BG_REVIEW" | "RENEWAL_PENDING_BG" };
    }
    await advanceToPayment(processId, actorId);
    return { status: "PENDING_PAYMENT" as const };
}

function audit(actorId: number, processId: number, oldData: object, newData: object) {
    return prisma.auditLog.create({
        data: {
            actorId: actorId || SYSTEM_ACTOR,
            action: "EDIT",
            tableName: "MembershipProcess",
            affectedEntityId: processId,
            oldData: JSON.stringify(oldData),
            newData: JSON.stringify(newData),
        },
    });
}
