import { Prisma, type OrgMembershipProcessStatus } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { emailHouseholdLeads } from "@/lib/emailRecipients";
import { logger } from "@/lib/logger";
import { sendCongrats } from "@/lib/membership/payment";
import { notifyBoardPaidReject } from "@/lib/membership/boardAlerts";
import { config } from "@/lib/config";
import { canonicalizeEmail } from "@/lib/emailNormalize";
import { type DbClient, type TxClient } from "@/lib/db-client";

/**
 * Background-check review — now a PARALLEL track, not a blocking phase.
 *
 * After intake the application advances to PENDING_PAYMENT regardless of the
 * check; the review happens while the applicant pays. Exception: a household
 * intake note (#900) holds the application at PENDING_BG_REVIEW until the review
 * completes, so a note like "treat us as a volunteer household" can settle dues
 * before payment opens (#907). Two DISTINCT eligible
 * reviewers (role isBackgroundCheckReviewer) must each attest independently. A
 * reviewer may not share a household with the applicant or the other reviewer,
 * and may not attest twice.
 *   - 2 APPROVE  -> clear the check (stamp parents' lastBackgroundCheck + sticky
 *                  volunteer status), then ACTIVATE if already paid, else leave
 *                  at PENDING_PAYMENT for the applicant to pay.
 *   - any REJECT -> BLOCKED (membership never activates without a valid check).
 *                  If the household already paid, the board is notified so a
 *                  refund can be handled manually.
 *
 * The system never sees the check itself — only the attestations.
 */

const SYSTEM_ACTOR = 0;
const REQUIRED_APPROVALS = 2;

/**
 * Board members are implicit background-check reviewers (small-org policy):
 * anywhere an explicit reviewer is required — the queue, PII visibility, the
 * attestation, and the reviewer notification — a board member qualifies too.
 * Single source of truth so the API gate, the service, and the UI can't drift.
 */
export function canReviewBackgroundChecks(u: {
    isBackgroundCheckReviewer?: boolean | null;
    isBoardMember?: boolean | null;
}): boolean {
    return Boolean(u.isBackgroundCheckReviewer || u.isBoardMember);
}

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
 * Whether a process is currently awaiting background-check review. The check is
 * a parallel track keyed off bgClearedAt (not status): a process needs review
 * when it hasn't cleared and is past consent —
 *   - PENDING_BG_REVIEW / RENEWAL_PENDING_BG: the (legacy/renewal) review states.
 *   - PENDING_PAYMENT / PENDING_BG_CLEARANCE: the INITIAL parallel states, once
 *     consent has been recorded (bgConsentAt set).
 */
function isAwaitingBgReview(p: { status: OrgMembershipProcessStatus; bgConsentAt: Date | null; bgClearedAt: Date | null }): boolean {
    if (p.bgClearedAt) return false;
    if (p.status === "PENDING_BG_REVIEW" || p.status === "RENEWAL_PENDING_BG") return true;
    if ((p.status === "PENDING_PAYMENT" || p.status === "PENDING_BG_CLEARANCE") && p.bgConsentAt) return true;
    return false;
}

/** Prisma `where` matching the same predicate as isAwaitingBgReview, for queue queries. */
export const AWAITING_BG_WHERE: Prisma.OrgMembershipProcessWhereInput = {
    bgClearedAt: null,
    OR: [
        { status: { in: ["PENDING_BG_REVIEW", "RENEWAL_PENDING_BG"] } },
        { status: { in: ["PENDING_PAYMENT", "PENDING_BG_CLEARANCE"] }, bgConsentAt: { not: null } },
    ],
};

/** Email every background-check reviewer that an application awaits review. */
export async function notifyReviewers(): Promise<void> {
    try {
        const reviewers = await prisma.person.findMany({
            where: { email: { not: null }, OR: [{ isBackgroundCheckReviewer: true }, { isBoardMember: true }] },
            select: { email: true },
        });
        const base = config.baseUrl();
        await Promise.all(
            reviewers.map((r) =>
                r.email
                    ? sendEmail(
                          r.email,
                          "Membership: a background-check review is needed",
                          `<p>An application is ready for your background-check review. Please sign in to review it: <a href="${base}/membership-ops/review">${base}/membership-ops/review</a></p>`,
                      ).catch((e) => logger.error("Reviewer ping failed:", e))
                    : Promise.resolve(),
            ),
        );
    } catch (e) {
        logger.error("notifyReviewers failed:", e);
    }
}

async function loadReviewer(reviewerId: number) {
    return prisma.person.findUnique({ where: { id: reviewerId }, select: { id: true, householdId: true, isBackgroundCheckReviewer: true, isBoardMember: true } });
}

/**
 * IDs of the applications this reviewer may currently attest (eligibility
 * filtered: not their own household, not already attested, no household-mate
 * already on it). The route turns these into model rows for the stripper; the
 * notifications endpoint just counts them. A process awaiting review only ever
 * holds APPROVE attestations (any REJECT moves it to BLOCKED), so a row's
 * attestation _count equals its approval count.
 */
export async function eligibleReviewProcessIds(reviewerId: number): Promise<number[]> {
    const reviewer = await loadReviewer(reviewerId);
    if (!reviewer || !canReviewBackgroundChecks(reviewer)) return [];

    const processes = await prisma.orgMembershipProcess.findMany({
        where: AWAITING_BG_WHERE,
        orderBy: { stageEnteredAt: "asc" },
        select: {
            id: true,
            orgMembership: { select: { householdId: true } },
            attestations: { select: { reviewerId: true, reviewer: { select: { householdId: true } } } },
        },
    });

    return processes
        .filter((p) => {
            if (p.orgMembership.householdId === reviewer.householdId) return false; // own household
            if (p.attestations.some((a) => a.reviewerId === reviewer.id)) return false; // already attested
            if (p.attestations.some((a) => a.reviewer.householdId === reviewer.householdId)) return false; // shares household with other reviewer
            return true;
        })
        .map((p) => p.id);
}

/**
 * Reviewer-scoped badge counts for the Review tab / nav:
 *   - canActOn: applications this reviewer may attest right now (green).
 *   - approvedAwaitingSecond: applications this reviewer already approved that
 *     still await a second reviewer (gray). An awaiting process only ever holds
 *     APPROVE attestations and needs 2 to clear, so "this reviewer has an
 *     attestation on it" == "approved by me, not yet done".
 */
export async function reviewQueueCounts(reviewerId: number): Promise<{ canActOn: number; approvedAwaitingSecond: number }> {
    const reviewer = await loadReviewer(reviewerId);
    if (!reviewer || !canReviewBackgroundChecks(reviewer)) return { canActOn: 0, approvedAwaitingSecond: 0 };
    const [canActOnIds, approvedAwaitingSecond] = await Promise.all([
        eligibleReviewProcessIds(reviewerId),
        prisma.orgMembershipProcess.count({ where: { ...AWAITING_BG_WHERE, attestations: { some: { reviewerId } } } }),
    ]);
    return { canActOn: canActOnIds.length, approvedAwaitingSecond };
}

/**
 * Record a reviewer's attestation. Validates eligibility, then on REJECT blocks
 * the application and on the 2nd APPROVE clears the check — activating the
 * membership if dues are already paid, else leaving it at PENDING_PAYMENT.
 */
export async function attest(
    reviewerId: number,
    processId: number,
    input: { result: "APPROVE" | "REJECT"; isMarkedVolunteer?: boolean },
) {
    const reviewer = await loadReviewer(reviewerId);
    if (!reviewer || !canReviewBackgroundChecks(reviewer)) throw new ReviewError("not_reviewer", "You are not a background-check reviewer.");

    // Re-check eligibility, create the attestation, recompute approvals, and converge
    // all inside one transaction. FOR UPDATE on the OrgMembershipProcess row serializes
    // concurrent attestations AND the payment path (payment.ts › activate takes the
    // same lock) — so the payment/clearance race can't lose an update: whoever commits
    // second sees the other's field set and flips ACTIVE. Mirrors leads.ts.
    type AttestOutcome =
        | { status: "BLOCKED"; notifyPaidReject: boolean }
        | { status: OrgMembershipProcessStatus; activated: boolean; householdId: number }
        | { status: OrgMembershipProcessStatus; approvals: number };
    const result = await prisma.$transaction<AttestOutcome>(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OrgMembershipProcess" WHERE id = ${processId} FOR UPDATE`;

        const process = await tx.orgMembershipProcess.findUnique({
            where: { id: processId },
            include: { attestations: { include: { reviewer: { select: { householdId: true } } } } },
        });
        if (!process) throw new ReviewError("not_found", "Application not found.");
        if (!isAwaitingBgReview(process)) throw new ReviewError("wrong_phase", "This application is not awaiting background-check review.");
        const membership = await tx.orgMembership.findUnique({ where: { id: process.orgMembershipId }, select: { householdId: true } });
        if (membership?.householdId === reviewer.householdId) throw new ReviewError("same_household_applicant", "You cannot review an applicant in your own household.");
        if (process.attestations.some((a) => a.reviewerId === reviewerId)) throw new ReviewError("already_attested", "You have already reviewed this application.");
        if (process.attestations.some((a) => a.reviewer.householdId === reviewer.householdId)) throw new ReviewError("same_household_reviewer", "Another reviewer from your household has already reviewed this application.");

        await tx.backgroundCheckAttestation.create({
            data: { processId, reviewerId, result: input.result, isMarkedVolunteer: !!input.isMarkedVolunteer },
        });

        if (input.result === "REJECT") {
            await tx.orgMembershipProcess.update({ where: { id: processId }, data: { status: "BLOCKED", stageEnteredAt: new Date() } });
            await audit(tx, reviewerId, processId, { status: process.status }, { status: "BLOCKED", reason: "reviewer reject" });
            // A paid household that fails review needs a manual refund — flag the board (post-tx).
            return { status: "BLOCKED" as const, notifyPaidReject: !!process.paidAt };
        }

        const approvals = process.attestations.filter((a) => a.result === "APPROVE").length + 1;
        if (approvals >= REQUIRED_APPROVALS) {
            const { activated, householdId } = await clearBackgroundCheck(tx, processId, reviewerId);
            const status: OrgMembershipProcessStatus = activated ? "ACTIVE" : "PENDING_PAYMENT";
            return { status, activated, householdId };
        }
        return { status: process.status, approvals };
    });

    // Side effects outside the transaction (a slow/failed send must not roll it back).
    if ("activated" in result) {
        if (result.activated) await sendCongrats(result.householdId);
        else await notifyPaymentOpen(result.householdId);
    }
    if ("notifyPaidReject" in result && result.notifyPaidReject) await notifyBoardPaidReject(processId);

    if ("approvals" in result) return { status: result.status, approvals: result.approvals };
    return { status: result.status };
}

/**
 * The background check is satisfied (2 approvals or a board override). Stamp the
 * guardians' lastBackgroundCheck + sticky volunteer status + bgClearedAt, then
 * converge on the two-track gate:
 *   - already paid -> ACTIVE (payment finished first)
 *   - not yet paid -> PENDING_PAYMENT (applicant still needs to pay)
 * Returns whether it activated + householdId so the caller can send congrats.
 * Must run inside a tx holding a FOR UPDATE lock on the process row.
 */
async function clearBackgroundCheck(tx: TxClient, processId: number, actorId: number): Promise<{ activated: boolean; householdId: number }> {
    const process = await tx.orgMembershipProcess.findUnique({
        where: { id: processId },
        include: { attestations: true },
    });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    const membership = await tx.orgMembership.findUnique({ where: { id: process.orgMembershipId }, select: { householdId: true } });
    if (!membership) throw new ReviewError("not_found", "Membership not found.");
    const householdId = membership.householdId;
    const now = new Date();
    const paid = !!process.paidAt;

    // Stamp the guardians' (household leads') lastBackgroundCheck. Expiry is derived from this
    // plus BoardSettings.bgRecheckMonths at read time (see householdBgIsFresh) — not stored.
    await tx.person.updateMany({ where: { householdId, householdLeads: { some: { householdId } } }, data: { lastBackgroundCheck: now } });
    await applyVolunteerStatus(tx, process.orgMembershipId, householdId, process.attestations.some((a) => a.isMarkedVolunteer));

    await tx.orgMembershipProcess.update({
        where: { id: processId },
        data: { bgClearedAt: now, status: paid ? "ACTIVE" : "PENDING_PAYMENT", stageEnteredAt: now },
    });
    if (paid) {
        await tx.orgMembership.update({ where: { id: process.orgMembershipId }, data: { status: "ACTIVE" } });
    }

    await audit(tx, actorId, processId, { status: process.status }, { status: paid ? "ACTIVE" : "PENDING_PAYMENT", bgCleared: true });
    return { activated: paid, householdId };
}

/**
 * True if any household-lead email matches any volunteer-designation email, under
 * the shared Gmail/+tag-aware canonicalization. Extracted (pure) so the money-path
 * match rule is unit-testable without a DB. DRIVES DUES via isVolunteer.
 */
export function matchesVolunteerDesignation(parentEmails: string[], designationEmails: string[]): boolean {
    const parents = new Set(parentEmails.map(canonicalizeEmail));
    if (!parents.size) return false;
    return designationEmails.some((d) => parents.has(canonicalizeEmail(d)));
}

/**
 * Sticky/additive volunteer status: set Membership.isVolunteer = true if ANY
 * reviewer marked the family volunteer-only OR a household parent's email is pre-
 * designated. Never clears it here. Runs at every PENDING_PAYMENT transition
 * (external advance, fresh-check intake shortcut, fresh-check renewal) so the
 * allowlist drives dues BEFORE the check clears (#874), and again at clearance
 * with the reviewers' volunteer marks.
 */
export async function applyVolunteerStatus(db: DbClient, orgMembershipId: number, householdId: number, markedByReviewer: boolean) {
    let isVolunteer = markedByReviewer;
    if (!isVolunteer) {
        const parents = await db.person.findMany({ where: { householdId, householdLeads: { some: { householdId } }, email: { not: null } }, select: { email: true } });
        const designations = await db.volunteerDesignation.findMany({ select: { email: true } });
        isVolunteer = matchesVolunteerDesignation(parents.map((p) => p.email!), designations.map((d) => d.email));
    }
    if (isVolunteer) {
        await db.orgMembership.update({ where: { id: orgMembershipId }, data: { isVolunteer: true } });
    }
}

/** Board override on a BLOCKED application: reset for re-review, or force-clear the check. */
export async function overrideBlocked(processId: number, actorId: number, action: "reset" | "approve") {
    const process = await prisma.orgMembershipProcess.findUnique({
        where: { id: processId },
        include: { orgMembership: { select: { household: { select: { intakeNotes: true } } } } },
    });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    if (process.status !== "BLOCKED") throw new ReviewError("wrong_phase", "This application is not blocked.");

    if (action === "reset") {
        // Restore the review state that matches the cycle. The check runs in parallel,
        // so an initial application returns to PENDING_BG_CLEARANCE if it had already
        // paid, else PENDING_PAYMENT; renewals go back to RENEWAL_PENDING_BG. An
        // unpaid initial with a household intake note re-holds at PENDING_BG_REVIEW —
        // the reset restarts review, and a note keeps payment gated on it (#907).
        const reviewStatus: OrgMembershipProcessStatus =
            process.kind === "RENEWAL" ? "RENEWAL_PENDING_BG"
            : process.paidAt ? "PENDING_BG_CLEARANCE"
            : process.orgMembership.household.intakeNotes?.trim() ? "PENDING_BG_REVIEW"
            : "PENDING_PAYMENT";
        await prisma.backgroundCheckAttestation.deleteMany({ where: { processId } });
        await prisma.orgMembershipProcess.update({ where: { id: processId }, data: { status: reviewStatus, bgClearedAt: null, stageEnteredAt: new Date() } });
        await audit(prisma, actorId, processId, { status: "BLOCKED" }, { status: reviewStatus, action: "board reset" });
        await notifyReviewers();
        return { status: reviewStatus };
    }

    // FOR UPDATE per clearBackgroundCheck's contract: serializes a board approve
    // against a late payment webhook (activate also locks), so the override reads
    // a fresh paidAt and converges to ACTIVE rather than parking it at PENDING_PAYMENT.
    const { activated, householdId } = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OrgMembershipProcess" WHERE id = ${processId} FOR UPDATE`;
        return clearBackgroundCheck(tx, processId, actorId);
    });
    if (activated) await sendCongrats(householdId);
    else await notifyPaymentOpen(householdId);
    const status: OrgMembershipProcessStatus = activated ? "ACTIVE" : "PENDING_PAYMENT";
    return { status };
}

/**
 * The check cleared but dues aren't paid — the process just (re)entered
 * PENDING_PAYMENT. For an application that was held for review (intake note,
 * renewal re-check) this is the moment payment first opens, and the status
 * cards/banner promise an email at clearance. Best-effort (send failures log).
 */
async function notifyPaymentOpen(householdId: number) {
    const base = config.baseUrl();
    await emailHouseholdLeads(
        householdId,
        "Background check complete — you can now pay your membership dues",
        `<p>Good news — your household's background-check review is complete. The last step is paying your membership dues: <a href="${base}/membership">${base}/membership</a></p>`,
        "Payment-open notice failed:",
    );
}

function audit(db: DbClient, actorId: number, processId: number, oldData: object, newData: object) {
    return db.auditLog.create({
        data: {
            actorId: actorId || SYSTEM_ACTOR,
            action: "EDIT",
            tableName: "OrgMembershipProcess",
            affectedEntityId: processId,
            oldData,
            newData,
        },
    });
}
